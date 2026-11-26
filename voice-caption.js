function normalizeLanguage(value) {
  const language = String(value || '').trim();
  return language === 'en-US' ? 'en-US' : 'ru-RU';
}

function freezeState(state) {
  return Object.freeze({ ...state });
}

export function createVoiceCaptionEngine({
  Recognition,
  language = 'ru-RU',
  onText = () => {},
  onStatus = () => {},
} = {}) {
  let recognizer = null;
  let destroyed = false;
  let finalText = '';
  let state = freezeState({
    supported: Boolean(Recognition),
    localOnly: false,
    browserFallback: false,
    availability: Recognition ? 'unchecked' : 'unsupported',
    active: false,
    installing: false,
    language: normalizeLanguage(language),
    interim: '',
    final: '',
    text: '',
    lastEvent: Recognition ? 'local speech unchecked' : 'local speech unsupported',
  });

  function publish(patch = {}, message = patch.lastEvent) {
    state = freezeState({ ...state, ...patch });
    try { onStatus(state, String(message || state.lastEvent)); } catch { /* UI cannot break recognition */ }
    return state;
  }

  function publishText(interim = '') {
    const joined = `${finalText}${finalText && interim ? ' ' : ''}${interim}`.trim();
    publish({ interim, final: finalText, text: joined });
    try { onText({ text: joined, interim, final: finalText, language: state.language }); } catch { /* UI cannot break recognition */ }
  }

  function createRecognizer({ localOnly = state.localOnly } = {}) {
    if (!Recognition) return null;
    const next = new Recognition();
    if (localOnly && !('processLocally' in next)) return null;
    if ('processLocally' in next) next.processLocally = Boolean(localOnly);
    next.lang = state.language;
    next.continuous = true;
    next.interimResults = true;
    next.maxAlternatives = 1;
    next.onresult = (event) => {
      let interim = '';
      for (let index = Number(event?.resultIndex) || 0; index < (event?.results?.length || 0); index += 1) {
        const result = event.results[index];
        const transcript = String(result?.[0]?.transcript || '').trim();
        if (!transcript) continue;
        if (result.isFinal) {
          finalText = `${finalText}${finalText ? ' ' : ''}${transcript}`.trim().slice(-1200);
        } else interim = `${interim}${interim ? ' ' : ''}${transcript}`;
      }
      publishText(interim);
    };
    next.onerror = (event) => {
      const error = String(event?.error || 'recognition error');
      recognizer = null;
      publish({ active: false, interim: '', lastEvent: `voice text stopped · ${error}` });
    };
    next.onend = () => {
      recognizer = null;
      if (state.active) publish({ active: false, interim: '', lastEvent: 'voice text ended · press start to continue' });
    };
    return next;
  }

  async function checkAvailability() {
    if (destroyed || !Recognition) return publish({ supported: false, availability: 'unsupported', lastEvent: 'local speech unsupported' });
    const probe = new Recognition();
    if (!('processLocally' in probe) || typeof Recognition.available !== 'function') {
      return publish({ localOnly: false, browserFallback: true, availability: 'browser', lastEvent: 'browser speech available · may use Chrome speech service' });
    }
    let availability = 'unavailable';
    try {
      availability = String(await Recognition.available({ langs: [state.language], processLocally: true }));
    } catch {
      availability = 'unavailable';
    }
    return publish({ localOnly: true, browserFallback: false, availability, lastEvent: `local speech · ${availability}` });
  }

  async function installLanguage() {
    const checked = await checkAvailability();
    if (checked.availability === 'available') return checked;
    if (!['downloadable', 'downloading'].includes(checked.availability) || typeof Recognition?.install !== 'function') {
      return publish({ lastEvent: `local ${state.language} pack unavailable · no cloud fallback` });
    }
    publish({ installing: true, lastEvent: `installing local ${state.language} speech pack` });
    try {
      await Recognition.install({ langs: [state.language] });
    } catch {
      return publish({ installing: false, availability: 'unavailable', lastEvent: `local ${state.language} pack install failed` });
    }
    publish({ installing: false });
    return checkAvailability();
  }

  async function start({ install = true, allowBrowserFallback = true } = {}) {
    if (destroyed || state.active) return state;
    let checked = await checkAvailability();
    if (install && !['available', 'browser'].includes(checked.availability)) checked = await installLanguage();
    const localReady = checked.availability === 'available';
    if (!localReady && !allowBrowserFallback) return checked;
    const next = createRecognizer({ localOnly: localReady });
    if (!next) return publish({ localOnly: false, browserFallback: false, lastEvent: 'speech recognition unavailable' });
    recognizer = next;
    finalText = '';
    publishText('');
    try {
      recognizer.start();
      return publish({
        active: true,
        localOnly: localReady,
        browserFallback: !localReady,
        availability: localReady ? 'available' : 'browser',
        lastEvent: localReady
          ? `voice text live · ${state.language} · on-device`
          : `voice text live · ${state.language} · Chrome speech service`,
      });
    } catch {
      recognizer = null;
      return publish({ active: false, lastEvent: 'voice text could not start' });
    }
  }

  function stop(reason = 'voice text stopped') {
    const current = recognizer;
    recognizer = null;
    try { current?.abort?.(); } catch { /* already stopped */ }
    return publish({ active: false, interim: '', lastEvent: reason });
  }

  function setLanguage(value) {
    const next = normalizeLanguage(value);
    if (next === state.language) return state;
    if (state.active) stop('voice text stopped · language changed');
    finalText = '';
    publishText('');
    return publish({ language: next, availability: 'unchecked', browserFallback: false, lastEvent: `voice text language · ${next}` });
  }

  function clear() {
    finalText = '';
    publishText('');
    return publish({ lastEvent: 'voice text cleared' });
  }

  function panic() {
    stop('panic · voice text stopped');
    finalText = '';
    publishText('');
    return state;
  }

  function getState() {
    return state;
  }

  function destroy() {
    if (destroyed) return;
    stop('voice text destroyed');
    destroyed = true;
  }

  return Object.freeze({ checkAvailability, installLanguage, start, stop, setLanguage, clear, panic, getState, destroy });
}
