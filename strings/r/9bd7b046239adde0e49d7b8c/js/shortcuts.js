// Use physical key codes only after leaving browser/system and editable input alone.
export function allowsInstrumentShortcut(event) {
  if (!event || event.metaKey || event.ctrlKey || event.altKey || event.isComposing || event.keyCode === 229) return false;
  const target=event.target;
  if (!target) return true;
  if (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/i.test(target.tagName || '')) return false;
  if (typeof target.closest === 'function' && target.closest('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return false;
  return true;
}
