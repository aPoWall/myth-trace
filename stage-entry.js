// Let users enter while the renderer and optional audio modules finish loading.
const entry = document.getElementById('entry');
const button = document.getElementById('enter');
const demo = document.getElementById('enter-demo');
const plate = entry?.querySelector('.entry__trace');

entry?.addEventListener('pointermove', event => {
  if (!plate) return;
  plate.style.setProperty('--trace-x', `${event.clientX}px`);
  plate.style.setProperty('--trace-y', `${event.clientY}px`);
});

function enter(view) {
  if (entry.dataset.stageReady === 'true') entry.dispatchEvent(new CustomEvent('mythtrace:enter', { detail: view }));
  else {
    entry.dataset.earlyEnter = view;
    document.getElementById('entry-status').textContent = 'Opening Shaper Field…';
  }
}
button?.addEventListener('click', () => enter('pointer'));
demo?.addEventListener('click', () => enter('demo'));
entry?.querySelector('.entry__score')?.addEventListener('click', event => {
  const choice = event.target.closest('[data-entry-study]');
  if (choice) enter('story:' + choice.dataset.entryStudy);
});
