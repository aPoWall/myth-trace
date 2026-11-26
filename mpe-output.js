const SIDE_NAMES = Object.freeze(['left', 'right']);
const FINGER_NAMES = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);
const MIDI_CENTER = 8192;
const MIDI_MAX = 16383;

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value, min = 0, max = 1) {
  return Math.min(max, Math.max(min, finite(value, min)));
}

function midi7(value) {
  return Math.round(clamp(value, 0, 127));
}

function outputLabel(output) {
  return String(output?.name || output?.manufacturer || output?.id || 'MIDI output');
}

function readConfig(config) {
  const music = config?.music;
  const mpe = music?.mpeOutput;
  if (!music || !mpe) throw new TypeError('MPE output requires config.music.mpeOutput');
  const memberChannels = Array.from(mpe.memberChannels || [], (value) => Number(value));
  if (memberChannels.length !== SIDE_NAMES.length * FINGER_NAMES.length
    || new Set(memberChannels).size !== memberChannels.length
    || memberChannels.some((value) => !Number.isInteger(value) || value < 0 || value > 15)) {
    throw new TypeError('MPE output requires ten unique member channels');
  }
  const masterChannel = Number(mpe.masterChannel);
  if (!Number.isInteger(masterChannel) || masterChannel < 0 || masterChannel > 15
    || memberChannels.includes(masterChannel)) {
    throw new TypeError('MPE output requires a distinct master channel');
  }
  const bendRangeSemitones = clamp(mpe.bendRangeSemitones, 0.01, 12);
  const pitchDeadband = clamp(mpe.pitchDeadband, 0, 0.25);
  const pitchTravel = clamp(mpe.pitchTravel, pitchDeadband + 0.001, 1);
  const timbreMin = midi7(mpe.timbreMin);
  const timbreMax = midi7(mpe.timbreMax);
  if (timbreMax < timbreMin) throw new TypeError('MPE output timbre range is inverted');
  return Object.freeze({
    masterChannel,
    memberChannels: Object.freeze(memberChannels),
    bendRangeSemitones,
    pitchDeadband,
    pitchTravel,
    expressionIntervalMs: Math.max(1000 / 60, finite(mpe.expressionIntervalMs, 1000 / 30)),
    timbreMin,
    timbreMax,
    timbreNeutral: midi7(mpe.timbreNeutral),
    bendThreshold: Math.max(1, Math.round(finite(mpe.bendThreshold, 64))),
    valueThreshold: Math.max(1, Math.round(finite(mpe.valueThreshold, 2))),
    fingerGainMax: Math.max(Number.EPSILON, finite(music.fingerGainMax, 1)),
  });
}

function makeVoice(channel, side, finger) {
  return {
    channel,
    side,
    finger,
    active: false,
    note: -1,
    anchorX: 0.5,
    bend: MIDI_CENTER,
    timbre: 64,
    pressure: 0,
  };
}

export function createMpeOutputBridge({ config, requestAccess, onStatus, clock } = {}) {
  const score = readConfig(config);
  if (typeof requestAccess !== 'function') throw new TypeError('MPE output requires requestAccess');
  const report = typeof onStatus === 'function' ? onStatus : () => {};
  const now = typeof clock === 'function'
    ? clock
    : () => Number(globalThis.performance?.now?.() ?? Date.now());
  const voices = [];
  for (let side = 0; side < SIDE_NAMES.length; side += 1) {
    for (let finger = 0; finger < FINGER_NAMES.length; finger += 1) {
      const index = side * FINGER_NAMES.length + finger;
      voices.push(makeVoice(score.memberChannels[index], SIDE_NAMES[side], FINGER_NAMES[finger]));
    }
  }

  let access = null;
  let output = null;
  let outputId = '';
  let enabled = false;
  let connected = false;
  let destroyed = false;
  let lastExpressionAt = -Infinity;
  let messageCount = 0;
  let lastEvent = 'mpe out standby · explicit enable required';
  let error = '';
  let stateDirty = true;
  let cachedState = null;

  function markDirty() {
    stateDirty = true;
  }

  function sendTo(target, bytes) {
    if (!target || target.state === 'disconnected') return false;
    try {
      target.send(bytes);
      messageCount += 1;
      markDirty();
      return true;
    } catch (sendError) {
      error = String(sendError?.message || sendError || 'MIDI output send failed');
      lastEvent = `mpe out error · ${error}`;
      markDirty();
      return false;
    }
  }

  function cc(target, channel, controller, value) {
    return sendTo(target, [0xb0 | channel, midi7(controller), midi7(value)]);
  }

  function pressure(target, channel, value) {
    return sendTo(target, [0xd0 | channel, midi7(value)]);
  }

  function bend(target, channel, value) {
    const raw = Math.round(clamp(value, 0, MIDI_MAX));
    return sendTo(target, [0xe0 | channel, raw & 0x7f, (raw >> 7) & 0x7f]);
  }

  function rpn(target, channel, msb, lsb, dataMsb, dataLsb = null) {
    cc(target, channel, 101, msb);
    cc(target, channel, 100, lsb);
    cc(target, channel, 6, dataMsb);
    if (dataLsb !== null) cc(target, channel, 38, dataLsb);
    cc(target, channel, 101, 127);
    cc(target, channel, 100, 127);
  }

  function configureZone(target) {
    rpn(target, score.masterChannel, 0, 6, score.memberChannels.length);
    const semitones = Math.floor(score.bendRangeSemitones);
    const cents = Math.round((score.bendRangeSemitones - semitones) * 100);
    for (const voice of voices) {
      rpn(target, voice.channel, 0, 0, semitones, cents);
      bend(target, voice.channel, MIDI_CENTER);
      cc(target, voice.channel, 74, score.timbreNeutral);
      pressure(target, voice.channel, 0);
      voice.bend = MIDI_CENTER;
      voice.timbre = score.timbreNeutral;
      voice.pressure = 0;
    }
    lastEvent = `mpe zone ready · ch 2–11 · bend ±${Math.round(score.bendRangeSemitones * 100)}c`;
    error = '';
    markDirty();
  }

  function releaseVoice(target, voice) {
    if (voice.active) sendTo(target, [0x80 | voice.channel, midi7(voice.note), 0]);
    bend(target, voice.channel, MIDI_CENTER);
    cc(target, voice.channel, 74, score.timbreNeutral);
    pressure(target, voice.channel, 0);
    voice.active = false;
    voice.note = -1;
    voice.anchorX = 0.5;
    voice.bend = MIDI_CENTER;
    voice.timbre = score.timbreNeutral;
    voice.pressure = 0;
  }

  function silenceTarget(target, reason = 'panic') {
    if (target) {
      for (const voice of voices) releaseVoice(target, voice);
      for (const channel of [score.masterChannel, ...score.memberChannels]) {
        cc(target, channel, 120, 0);
        cc(target, channel, 123, 0);
        pressure(target, channel, 0);
        bend(target, channel, MIDI_CENTER);
      }
    } else {
      for (const voice of voices) {
        voice.active = false;
        voice.note = -1;
        voice.anchorX = 0.5;
        voice.bend = MIDI_CENTER;
        voice.timbre = score.timbreNeutral;
        voice.pressure = 0;
      }
    }
    lastEvent = `mpe ${reason} · exact outbound zero`;
    lastExpressionAt = -Infinity;
    markDirty();
  }

  function listOutputs() {
    const devices = [];
    for (const candidate of access?.outputs?.values?.() || []) {
      if (!candidate || candidate.state === 'disconnected') continue;
      devices.push(Object.freeze({
        id: String(candidate.id || outputLabel(candidate)),
        name: outputLabel(candidate),
        manufacturer: String(candidate.manufacturer || ''),
      }));
    }
    return devices;
  }

  function resolveOutput(requestedId = outputId, allowFallback = true) {
    const candidates = [...(access?.outputs?.values?.() || [])]
      .filter((candidate) => candidate && candidate.state !== 'disconnected');
    const requested = String(requestedId || '');
    return candidates.find((candidate) => String(candidate.id || outputLabel(candidate)) === requested)
      || (allowFallback ? candidates[0] : null)
      || null;
  }

  function bindOutput(next, reason = 'selected') {
    if (output === next && connected) return getState();
    if (output) silenceTarget(output, 'switch');
    output = next;
    outputId = next ? String(next.id || outputLabel(next)) : '';
    connected = Boolean(next && next.state !== 'disconnected');
    if (connected) configureZone(next);
    else {
      silenceTarget(null, reason === 'disconnected' ? 'disconnected' : 'waiting');
      error = reason === 'disconnected' ? 'selected MIDI output disconnected' : '';
      lastEvent = reason === 'disconnected'
        ? 'mpe out disconnected · exact outbound zero'
        : 'mpe out waiting · no MIDI destination';
    }
    markDirty();
    report(getState());
    return getState();
  }

  async function enable(requestedId = '') {
    if (destroyed) return getState();
    enabled = true;
    lastEvent = 'mpe out requesting Web MIDI';
    markDirty();
    report(getState());
    try {
      access = await requestAccess();
      if (!access?.outputs) {
        error = 'Web MIDI output access unavailable';
        return bindOutput(null, 'waiting');
      }
      error = '';
      return bindOutput(resolveOutput(requestedId), 'waiting');
    } catch (accessError) {
      access = null;
      error = String(accessError?.message || accessError || 'Web MIDI output access failed');
      connected = false;
      output = null;
      outputId = '';
      silenceTarget(null, 'unavailable');
      lastEvent = `mpe out unavailable · ${error}`;
      markDirty();
      report(getState());
      return getState();
    }
  }

  function selectOutput(requestedId) {
    if (!enabled || !access) {
      outputId = String(requestedId || '');
      markDirty();
      return getState();
    }
    return bindOutput(resolveOutput(requestedId), 'waiting');
  }

  function bendValue(x, anchorX) {
    const delta = clamp(x) - clamp(anchorX);
    const magnitude = Math.abs(delta);
    if (magnitude <= score.pitchDeadband) return MIDI_CENTER;
    const amount = clamp((magnitude - score.pitchDeadband) / (score.pitchTravel - score.pitchDeadband));
    const normalized = Math.sign(delta) * amount;
    return Math.round(MIDI_CENTER + normalized * (normalized < 0 ? MIDI_CENTER : MIDI_MAX - MIDI_CENTER));
  }

  function timbreValue(y) {
    return midi7(score.timbreMin + (score.timbreMax - score.timbreMin) * (1 - clamp(y)));
  }

  function expressionLevel(hand, finger) {
    const level = finite(hand?.levels?.[finger]);
    if (level > 0) return clamp(level / score.fingerGainMax);
    return clamp(hand?.curls?.[finger]);
  }

  function refreshConnection() {
    if (!enabled || !access || !output) return;
    const current = resolveOutput(outputId, false);
    if (current !== output || output.state === 'disconnected') bindOutput(current, 'disconnected');
  }

  function update({ timestamp = now(), music, range } = {}) {
    if (destroyed || !enabled) return getState();
    refreshConnection();
    if (!connected || !output) return getState();
    const musicHands = music?.fingers?.hands || {};
    const rangeHands = range?.hands || {};
    const updateExpression = finite(timestamp) - lastExpressionAt >= score.expressionIntervalMs;
    let activeCount = 0;
    let maxBend = 0;
    let lastTimbre = score.timbreNeutral;

    for (const voice of voices) {
      const hand = musicHands[voice.side] || {};
      const rangeHand = rangeHands[voice.side] || {};
      const gate = String(hand.gates?.[voice.finger] || 'off');
      const note = Number(hand.notes?.[voice.finger]);
      const tip = rangeHand.fingertips?.[voice.finger];
      const x = clamp(tip?.x, 0, 1);
      const y = clamp(tip?.y, 0, 1);
      const level = expressionLevel(hand, voice.finger);

      if (gate !== 'on' || !Number.isFinite(note)) {
        if (voice.active) releaseVoice(output, voice);
        continue;
      }
      if (voice.active && voice.note !== note) releaseVoice(output, voice);
      if (!voice.active) {
        voice.active = true;
        voice.note = Math.round(clamp(note, 0, 127));
        voice.anchorX = Number.isFinite(Number(tip?.x)) ? x : 0.5;
        voice.bend = MIDI_CENTER;
        voice.timbre = timbreValue(y);
        voice.pressure = midi7(level * 127);
        bend(output, voice.channel, voice.bend);
        cc(output, voice.channel, 74, voice.timbre);
        pressure(output, voice.channel, voice.pressure);
        sendTo(output, [0x90 | voice.channel, voice.note, midi7(36 + level * 91)]);
        lastEvent = `mpe note on · ${voice.side} ${voice.finger} · ch ${voice.channel + 1}`;
        markDirty();
      } else if (updateExpression && tip) {
        const nextBend = bendValue(x, voice.anchorX);
        const nextTimbre = timbreValue(y);
        const nextPressure = midi7(level * 127);
        if (Math.abs(nextBend - voice.bend) >= score.bendThreshold) {
          bend(output, voice.channel, nextBend);
          voice.bend = nextBend;
        }
        if (Math.abs(nextTimbre - voice.timbre) >= score.valueThreshold) {
          cc(output, voice.channel, 74, nextTimbre);
          voice.timbre = nextTimbre;
        }
        if (Math.abs(nextPressure - voice.pressure) >= score.valueThreshold) {
          pressure(output, voice.channel, nextPressure);
          voice.pressure = nextPressure;
        }
      }
      activeCount += 1;
      const normalizedBend = voice.bend < MIDI_CENTER
        ? (voice.bend - MIDI_CENTER) / MIDI_CENTER
        : (voice.bend - MIDI_CENTER) / (MIDI_MAX - MIDI_CENTER);
      maxBend = Math.max(maxBend, Math.abs(normalizedBend * score.bendRangeSemitones * 100));
      lastTimbre = voice.timbre;
    }
    if (updateExpression) lastExpressionAt = finite(timestamp);
    if (activeCount) {
      const nextEvent = `mpe live · ${activeCount} note${activeCount === 1 ? '' : 's'} · bend ${Math.round(maxBend)}c · cc74 ${lastTimbre}`;
      if (nextEvent !== lastEvent) {
        lastEvent = nextEvent;
        markDirty();
      }
    }
    return getState();
  }

  function panic(reason = 'panic') {
    silenceTarget(output, reason);
    report(getState());
    return getState();
  }

  function getState() {
    if (!stateDirty && cachedState) return cachedState;
    const activeVoices = voices.filter((voice) => voice.active);
    let bendCents = 0;
    let timbre = score.timbreNeutral;
    for (const voice of activeVoices) {
      const normalized = voice.bend < MIDI_CENTER
        ? (voice.bend - MIDI_CENTER) / MIDI_CENTER
        : (voice.bend - MIDI_CENTER) / (MIDI_MAX - MIDI_CENTER);
      bendCents = Math.max(bendCents, Math.abs(normalized * score.bendRangeSemitones * 100));
      timbre = voice.timbre;
    }
    cachedState = Object.freeze({
      enabled,
      connected,
      outputId,
      outputName: connected ? outputLabel(output) : '',
      outputs: Object.freeze(listOutputs()),
      masterChannel: score.masterChannel + 1,
      memberChannels: Object.freeze(score.memberChannels.map((channel) => channel + 1)),
      bendRangeSemitones: score.bendRangeSemitones,
      activeNotes: activeVoices.length,
      bendCents,
      timbre,
      messageCount,
      lastEvent,
      error,
    });
    stateDirty = false;
    return cachedState;
  }

  function destroy() {
    if (destroyed) return;
    panic('destroy');
    destroyed = true;
    enabled = false;
    connected = false;
    output = null;
    access = null;
    outputId = '';
    lastEvent = 'mpe out destroyed · exact outbound zero';
    markDirty();
  }

  return Object.freeze({ enable, selectOutput, update, panic, getState, destroy });
}
