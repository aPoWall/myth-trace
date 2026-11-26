import { CONFIG, clamp } from './config.js';
import { createBassDeck } from './bass-deck.js';
import { ORCHESTRA_KEYS } from './particles-orchestra.js';

// All sources here belong to the demo alone and share the instrument's local output.
export function createDemoAccompaniment(session) {
  let deck, drumBus, context, output, spoken, origin = 0, lifetime = 0, revision = 0, lastFilter, lastWobble;
  const buffers = new Map();
  let guestKey = null, baseKey = 'dm';

  function stopVoice() {
    revision++;
    if (spoken) {
      spoken.source.onended = null;
      spoken.source.stop();
      spoken.source.disconnect();
      spoken.gain.disconnect();
      spoken = null;
    }
  }

  function stop() {
    lifetime++;
    stopVoice();
    deck?.stop();
    drumBus?.disconnect();
    deck = drumBus = context = output = null;
    lastFilter = lastWobble = undefined;
  }

  async function start(scene) {
    stop();
    const ticket = lifetime;
    baseKey = scene.key;
    const ctx = await session.getAudioContext();
    const destination = await session.getOutputDestination();
    if (lifetime !== ticket) return;
    context = ctx;
    output = destination;
    origin = ctx.currentTime + CONFIG.bassDeck.entrySeconds;
    if (scene.deck) {
      drumBus = ctx.createGain();
      drumBus.gain.value = CONFIG.shaperDemo.drumGain;
      drumBus.connect(output);
      deck = createBassDeck(ctx, drumBus, {...scene.deck, root: ORCHESTRA_KEYS[guestKey || baseKey]});
    }
  }

  function modulate(scene, hands) {
    if (!deck || !scene.deck) return;
    const right = hands.find(h => h.handedness === 'Right');
    const left = hands.find(h => h.handedness === 'Left');
    const filter = right ? clamp(1-right.palm.y) : scene.deck.filter;
    const wobble = left ? clamp(left.openness) : scene.deck.wobble;
    if (filter === lastFilter && wobble === lastWobble) return;
    deck.configure({filter, wobble});
    lastFilter = filter;
    lastWobble = wobble;
  }

  async function speak(line) {
    if (!context) return false;
    stopVoice();
    const ticket = revision, ctx = context;
    let pending = buffers.get(line.source);
    if (!pending) {
      pending = fetch(line.source).then(response => {
        if (!response.ok) throw new Error('Voice sample unavailable');
        return response.arrayBuffer();
      }).then(data => ctx.decodeAudioData(data));
      buffers.set(line.source, pending);
    }
    let buffer;
    try { buffer = await pending; } catch { buffers.delete(line.source); return false; }
    if (ticket !== revision || ctx !== context) return false;
    const source = ctx.createBufferSource(), gain = ctx.createGain();
    gain.gain.value = CONFIG.shaperDemo.voiceGain;
    source.buffer = buffer;
    source.connect(gain).connect(output);
    spoken = {source,gain};
    source.onended = () => { source.disconnect(); gain.disconnect(); if (spoken?.source === source) spoken = null; };
    source.start();
    return true;
  }
  return { start, stop, modulate, speak, stopVoice,
    setBaseKey(key) {
      baseKey = key;
      deck?.configure({root: ORCHESTRA_KEYS[guestKey || baseKey]});
    },
    setGuestKey(key) {
      guestKey = key;
      deck?.configure({root: ORCHESTRA_KEYS[guestKey || baseKey]});
    },
    nextBeatDelay: () => deck?.nextBeatDelay() ?? null,
    beatTime: () => deck ? Math.max(0, (context.currentTime - origin) * 1000) : null,
  };
}
