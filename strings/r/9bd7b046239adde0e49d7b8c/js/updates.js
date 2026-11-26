const BUILD_PATH = /\/r\/([0-9a-f]{24})(?:\/index\.html|\/)?$/;
const BUILD_ID = /^[0-9a-f]{24}$/;
const SNAPSHOT_KEY = 'constellation.pending-update.v1';
const POLL_MS = 3000;
const TIMEOUT_MS = 2400;

function localBuild() {
  return location.pathname.match(BUILD_PATH)?.[1] ?? null;
}

function buildPath(build) {
  return new URL(`../../../r/${build}/index.html`, import.meta.url).pathname;
}

export function takePendingSnapshot() {
  try {
    const saved = JSON.parse(sessionStorage.getItem(SNAPSHOT_KEY));
    if (!saved || !BUILD_ID.test(saved.toBuild) || saved.toBuild !== localBuild()) return null;
    sessionStorage.removeItem(SNAPSHOT_KEY);
    return saved.snapshot;
  } catch {
    return null;
  }
}

export function initUpdates({
  getSnapshot = () => null,
  isBusy = () => false,
  onBeforeReload = () => {},
  onStatus = () => {},
  onError = () => {},
} = {}) {
  const currentBuild = localBuild();
  let pendingBuild = null;
  let online = Boolean(currentBuild);
  let applying = false;
  let disposed = false;
  let request = null;
  let lastStatus = '';

  function getState() {
    const busy = Boolean(isBusy());
    const state = applying ? 'applying' : !online ? 'offline'
      : pendingBuild ? (busy ? 'held' : 'ready') : 'idle';
    return { state, currentBuild, pendingBuild, busy };
  }

  function publish() {
    const status = getState();
    const key = JSON.stringify(status);
    if (key === lastStatus) return;
    lastStatus = key;
    onStatus(status);
  }

  async function check() {
    if (disposed || !currentBuild || applying || request || document.hidden) return false;
    const controller = new AbortController();
    request = controller;
    const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const response = await fetch(new URL('../../../current.json', import.meta.url), { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`Release status unavailable (HTTP ${response.status})`);
      const release = await response.json();
      if (release.status !== 'ok' || release.verified !== true || !BUILD_ID.test(release.build)
          || release.path !== buildPath(release.build)) {
        throw new Error('Release status did not identify a verified build');
      }
      if (disposed) return false;
      pendingBuild = release.build === currentBuild ? null : release.build;
      online = true;
      return true;
    } catch (error) {
      if (!disposed) {
        if (online) onError(error);
        online = false;
      }
      return false;
    } finally {
      clearTimeout(timeout);
      request = null;
      if (!disposed) publish();
    }
  }

  async function apply() {
    if (disposed || !online || !pendingBuild || applying || isBusy()) {
      if (!disposed) publish();
      return false;
    }
    const toBuild = pendingBuild;
    applying = true;
    publish();
    let saved = null;
    let navigating = false;
    try {
      const snapshot = await getSnapshot();
      if (disposed || isBusy()) return false;
      saved = JSON.stringify({ fromBuild: currentBuild, toBuild, snapshot });
      sessionStorage.setItem(SNAPSHOT_KEY, saved);
      await onBeforeReload({ fromBuild: currentBuild, toBuild });
      if (disposed) return false;
      location.assign(buildPath(toBuild) + location.search + location.hash);
      navigating = true;
      return true;
    } catch (error) {
      onError(error);
      return false;
    } finally {
      if (!navigating) {
        try {
          if (saved && sessionStorage.getItem(SNAPSHOT_KEY) === saved) sessionStorage.removeItem(SNAPSHOT_KEY);
        } catch {
          // Storage can be disabled by the browser for this tab.
        }
        applying = false;
        if (!disposed) publish();
      }
    }
  }

  function visible() {
    if (!document.hidden) void check();
  }

  function pageHide(event) {
    if (event.persisted) request?.abort();
    else dispose();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    if (poll) clearInterval(poll);
    request?.abort();
    document.removeEventListener('visibilitychange', visible);
    window.removeEventListener('pagehide', pageHide);
  }

  const poll = currentBuild ? setInterval(visible, POLL_MS) : null;
  document.addEventListener('visibilitychange', visible);
  window.addEventListener('pagehide', pageHide);
  publish();
  visible();
  return { getState, check, apply, dispose };
}
