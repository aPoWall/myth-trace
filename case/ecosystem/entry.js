if (new URLSearchParams(location.search).get('view') === 'map') {
  document.title = 'Myth Trace · Ecosystem Map';
  document.querySelectorAll('style, link[rel="stylesheet"]').forEach(node => node.remove());
  const sheet = document.createElement('link');
  sheet.rel = 'stylesheet';
  sheet.href = 'ecosystem/map.css';
  document.head.append(sheet);
  document.body.replaceChildren(document.querySelector('#ecosystem-map').content.cloneNode(true));
  await import('./map.js');
}
