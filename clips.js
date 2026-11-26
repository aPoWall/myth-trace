export function bindClips({ panel, localVideo, session, useLocal, onShown, onEffects }) {
  let blobUrl = '';
  let localSource = '';
  const danceUrl = './assets/dance-4882-stage.mp4';
  let audioRoute;
  const find = selector => panel.querySelector(selector);
  const readout = find('[data-clip-status]');
  const playButton = find('[data-clip-play]');
  const trackButton = find('[data-clip-track]');
  const danceButton = find('[data-clip-dance]');
  const effects = find('[data-clip-effects]');
  const gain = find('[data-clip-gain]');
  void fetch(danceUrl, { method: 'HEAD', cache: 'no-store' }).then(response => {
    danceButton.hidden = !(response.ok && response.headers.get('Content-Type')?.startsWith('video/'));
  }).catch(() => {});
  try {
    const saved = localStorage.getItem('mythtrace.clip-effects');
    if (saved !== null) effects.value = saved;
  } catch {}
  onEffects(Number(effects.value));
  effects.addEventListener('input', () => {
    onEffects(Number(effects.value));
    try { localStorage.setItem('mythtrace.clip-effects', effects.value); } catch {}
  });
  const stopButton = find('[data-clip-stop]');
  function close() {
    localVideo.pause();
    localVideo.hidden = true;
    useLocal(null);
    playButton.disabled = stopButton.disabled = true;
    if (localSource) {
      localSource = '';
      localVideo.removeAttribute('src');
      localVideo.load();
    }
    if (blobUrl) URL.revokeObjectURL(blobUrl);
    blobUrl = '';
    readout.textContent = 'Video off · camera';
    onShown('off');
  }
  stopButton.addEventListener('click', close);
  const updatePlay = () => { playButton.textContent = localVideo.paused ? 'play' : 'pause'; };
  localVideo.addEventListener('play', updatePlay);
  localVideo.addEventListener('pause', updatePlay);
  localVideo.addEventListener('error', () => {
    if (localSource) readout.textContent = 'The browser could not play this file. Try MP4 (H.264) or WebM.';
  });
  playButton.addEventListener('click', () => {
    if (localVideo.paused) void Promise.all([localVideo.play(), connectSound(localSource)]).catch(error => { if (localSource) readout.textContent = error.message; });
    else localVideo.pause();
  });
  trackButton.addEventListener('click', () => {
    const enabled = trackButton.getAttribute('aria-pressed') !== 'true';
    trackButton.setAttribute('aria-pressed', String(enabled));
    if (localSource) useLocal(localVideo, enabled);
  });
  gain.addEventListener('input', () => { if (audioRoute) audioRoute.gain.gain.value = Number(gain.value); });
  let audioRouteRequest;
  async function showFile(url, name) {
    localSource = url;
    localVideo.src = url;
    localVideo.hidden = false;
    localVideo.loop = true;
    playButton.disabled = stopButton.disabled = false;
    useLocal(localVideo, trackButton.getAttribute('aria-pressed') === 'true');
    onShown('local');
    readout.textContent = `Opening ${name}…`;
    try {
      await Promise.all([localVideo.play(), connectSound(url)]);
      if (localSource === url) readout.textContent = `${name} · full-stage video`;
    } catch (error) {
      if (localSource === url) readout.textContent = `Stage video · ${error.message}`;
    }
  }
  async function connectSound(url) {
    audioRouteRequest ||= session.routeMediaElement(localVideo).catch(error => { audioRouteRequest = null; throw error; });
    audioRoute = await audioRouteRequest;
    if (localSource !== url) return;
    audioRoute.gain.gain.value = Number(gain.value);
  }
  danceButton.addEventListener('click', () => {
    close();
    void showFile(danceUrl, 'DSCF4882 · dance');
  });
  find('[data-clip-file]').addEventListener('change', event => {
    const file = event.target.files?.[0];
    if (!file) return;
    close();
    blobUrl = URL.createObjectURL(file);
    void showFile(blobUrl, file.name);
    event.target.value = '';
  });
  return { close, isLocal: () => Boolean(localSource) };
}
