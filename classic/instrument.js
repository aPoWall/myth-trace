// Both instruments use the same permission origin and the same verified hand model.
if (new URLSearchParams(location.search).get('instrument') === 'strings') {
  document.title = 'String Field · Myth Trace';
  const base = document.createElement('base');
  base.href = new URL('./string-field/', import.meta.url).href;
  document.head.prepend(base);
  document.querySelector('link[rel="stylesheet"]').remove();
  for (const name of ['boot', 'styles', 'rehearsal', 'camera-controls']) {
    const link = document.createElement('link');
    link.rel = 'stylesheet';
    link.href = name + '.css';
    document.head.append(link);
  }
  document.body.replaceChildren(document.querySelector('#string-workshop').content.cloneNode(true));
  await import('./string-field/js/boot.js');
} else {
  try {
    await import('./main.js');
    document.querySelector('#enter').disabled = false;
    document.querySelector('#enter-hands').disabled = false;
  } catch (error) {
    document.querySelector('#entry-status').textContent = 'Stage unavailable · ' + error.message;
    throw error;
  }
}
