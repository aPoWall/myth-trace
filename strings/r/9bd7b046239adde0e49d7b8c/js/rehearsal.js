import { CONFIG } from './config.js';

const steps = [
  {name:'DRAW', diagram:'A FIXED / PULL B', instruction:'DRAW (S): pinch thumb and index to place fixed anchor A, then move the same hand to pull end B.', tip:'Open your fingers to lock. Press S again or use LOCK if release is uncertain. Play the draft with your middle fingertip or the other hand while the builder keeps holding.'},
  {name:'LOCK', diagram:'RELEASE / LOCK ENDS', instruction:'Opening the pinch locks both ends. S again or LOCK also commits the draft; losing the hand cancels an unfinished draft.', tip:'Mouse or touch: drag from empty space and release. Shift + drag works in any mode.'},
  {name:'PLAY', diagram:'INDEX CROSSES WIRE', instruction:'PLAY (G) never edits: brush an index finger across a wire or click it to sound. TUNE (T) grabs an existing anchor; moving it changes length and pitch, release locks it.', tip:'NOTE (N) places a single retained note by click or pinch. ERASE (D) removes a touched string or note.'},
];

export function frequencyForPreviewLength(length) {
  const c = CONFIG.strings;
  const value = Number.isFinite(length) && length > 0 ? length : c.referenceLength;
  const midi = Math.max(c.minMidi, Math.min(c.maxMidi, c.referenceMidi + 12 * Math.log2(c.referenceLength / value)));
  return 440 * 2 ** ((midi - 69) / 12);
}

export function createRehearsal({ root, scenes, onStart = () => {}, onAudition = () => {}, onStopAudition = () => {}, onScene = () => {}, onMelody=()=>{}, onChanges=()=>{}, onEmpty=()=>{} }) {
  let selected = scenes[0]?.id;
  let step = 0;
  let disposed = false;
  let previousFocus = null;
  root.innerHTML = `<div class="rehearsal-plate" role="dialog" aria-modal="true" aria-labelledby="rehearsal-title">
    <header class="rehearsal-head"><span id="rehearsal-title">HOW TO PLAY STRING FIELD</span><button type="button" data-action="close" aria-label="Close">ESC / ×</button></header>
    <div class="rehearsal-tabs" role="tablist" aria-label="Playing steps">
      ${steps.map(({ name }, i) => `<button id="rehearsal-tab-${i}" type="button" role="tab" data-step="${i}" aria-controls="rehearsal-instruction">0${i + 1} / ${name}</button>`).join('')}
    </div>
    <div class="rehearsal-layout">
      <div id="rehearsal-instruction" class="rehearsal-instruction" role="tabpanel">
        <p class="rehearsal-step"></p>
        <div class="rehearsal-diagram">
          <svg viewBox="0 0 420 128" role="img" aria-label="Gesture and string schematic">
            <text x="12" y="17">GESTURE SCHEMATIC</text>
            <text class="diagram-state" x="408" y="17" text-anchor="end"></text>
            <path class="guide-track" d="M66 69h282 M66 49v40"/>
            <path class="wire-wave"/>
            <line class="wire" x1="66" y1="69" x2="284" y2="69"/>
            <circle class="anchor-ring" cx="66" cy="69" r="8"/>
            <circle class="end-a" cx="66" cy="69" r="3.6"/>
            <text class="point-a" x="66" y="112" text-anchor="middle">A · ANCHOR</text>
            <g class="end-position">
              <g class="end-pull">
                <circle class="anchor-ring end-lock" cy="69" r="8"/>
                <circle class="end-b" cy="69" r="3.6"/>
                <text class="point-b" y="112" text-anchor="middle">B</text>
                <g class="guide-grip">
                  <path class="grip-palm" d="M28 55c12 2 18 12 21 22l2 21M28 83c9 6 11 13 12 22"/>
                  <path class="grip-index" d="M28 55 10 56c-6 0-9 4-9 10"/>
                  <path class="grip-thumb" d="M28 83 12 80c-5-1-10-5-11-9"/>
                  <circle class="grip-index" cx="1" cy="66" r="2"/>
                  <circle class="grip-thumb" cx="1" cy="71" r="2"/>
                </g>
              </g>
            </g>
            <g class="contact-position">
              <path class="brush-guide" d="M0 47v43"/>
              <circle class="contact" cy="69" r="3"/>
              <g class="brush-finger">
                <path d="M0 69c-1-6 0-12 4-18l9-12c3-4 8-1 6 3l-4 8c4-3 10-2 12 2l3 7"/>
                <circle cy="69" r="2.5"/>
              </g>
            </g>
          </svg>
        </div>
        <p class="rehearsal-tip"></p>
        <div class="rehearsal-controls">
          <label class="rehearsal-range">STRING LENGTH <output class="length-output"></output><input data-range="length" type="range" min=".15" max="1.1" step=".01" value=".55"></label>
          <label class="rehearsal-range">CONTACT POINT <output class="contact-output"></output><input data-range="contact" type="range" min=".08" max=".92" step=".01" value=".5"></label>
        </div>
        <p class="rehearsal-note">Longer strings sound lower. Scale snapping selects the nearest scale note. Presets retain fixed MIDI pitches. Center and edge contacts change overtones; speed controls loudness.</p>
      </div>
      <div class="rehearsal-compare">
        <h2 class="rehearsal-label">MATERIAL / SOUND</h2>
        <div class="rehearsal-scenes"></div>
        <p class="scene-info"></p>
        <div class="rehearsal-audition"><button type="button" data-action="audition">AUDITION</button><button type="button" data-action="stop">STOP</button></div>
      </div>
    </div>
    <div class="rehearsal-notes">
      <section>
        <h2 class="rehearsal-label">TEMPLATES / PERFORMANCE</h2>
        <p>PREVIEW opens a diagram and a separate audition before you apply a layout or pluck voicing. Add inserts a template while preserving your instrument, key and material. Replace is explicit. Empty Field clears everything; Undo restores it. Save retains your notes and tuning.</p>
        <dl>
          <div><dt>Harp</dt><dd>six scale notes</dd></div>
          <div><dt>Chords</dt><dd>three triad zones</dd></div>
          <div><dt>Fifths</dt><dd>root and fifth in two octaves</dd></div>
          <div><dt>Crystal</dt><dd>two string figures</dd></div><div><dt>Fan / Rack</dt><dd>eight-wire scale fan or octave rack</dd></div>
        </dl>
      </section>
      <section>
        <h2 class="rehearsal-label">RHYTHM / SAMPLES / IMAGE</h2>
        <p>Sequence loops your stored notes from left to right. CHORD / Space plays together. Rhythm / Samples supplies optional drums and eight audio slices: play pads, map string contact to a slice, or rotate chops over the beat. Setup chooses Filament, Kosmodrom Sector, Lattice or Acoustic Contour, over your camera or a shader. Voice is started separately; its level can drive the image and future pluck noise. Command, Ctrl and Alt shortcuts always remain with your system.</p>
      </section>
    </div>
    <div class="rehearsal-v8"><b>LATEST / COMPOSITIONS + TIMED TEXT</b><p>Try Ode to Joy or Frère Jacques. Add the strings, then watch a labelled demo pull and play them. Captions can show notes or follow your SRT/VTT sample transcript. Semitones and Sample Root transpose audio by changing playback speed. Stages keeps the change log and your instrument checkpoints.</p></div><footer class="rehearsal-actions"><button type="button" data-action="melody">TRY A MELODY</button><button type="button" data-action="empty">BUILD EMPTY FIELD</button><button type="button" data-action="changes">CHANGES / STAGES</button><button type="button" data-action="pointer">START WITH POINTER</button><button type="button" data-action="camera">CAMERA + HANDS</button></footer>
  </div>`;

  const $ = (selector) => root.querySelector(selector);
  const length = $('[data-range="length"]');
  const contact = $('[data-range="contact"]');
  const stepTabs = [...root.querySelectorAll('[data-step]')];
  const sceneBox = $('.rehearsal-scenes');
  for (const scene of scenes) {
    const button = document.createElement('button');
    button.type = 'button';
    button.dataset.scene = scene.id;
    const photo = document.createElement('img');
    photo.src = `./assets/scene-${scene.id}.jpg`;
    photo.alt = '';
    photo.decoding = 'async';
    const name = document.createElement('span');
    name.textContent = scene.preview || scene.name;
    button.append(photo, name);
    sceneBox.append(button);
  }

  function renderStep() {
    for (const [index, button] of stepTabs.entries()) {
      button.setAttribute('aria-selected', String(index === step));
      button.tabIndex = index === step ? 0 : -1;
    }
    const current = steps[step];
    $('.rehearsal-step').textContent = current.instruction;
    $('.rehearsal-tip').textContent = current.tip;
    $('.diagram-state').textContent = current.diagram;
    $('.point-a').textContent = step === 1 ? 'A · LOCKED' : 'A · ANCHOR';
    $('.point-b').textContent = step === 1 ? 'B · LOCKED' : 'B';
    $('#rehearsal-instruction').setAttribute('aria-labelledby', stepTabs[step].id);
    root.dataset.step = String(step);
  }

  function renderScene() {
    const scene = scenes.find((item) => item.id === selected) || scenes[0];
    if (!scene) return;
    selected = scene.id;
    for (const button of sceneBox.children) {
      button.setAttribute('aria-pressed', String(button.dataset.scene === selected));
    }
    $('.scene-info').textContent = [scene.timbre, scene.harmony].filter(Boolean).join(' · ') || scene.description || '';
  }

  function renderRanges() {
    const value = Number(length.value);
    const u = Number(contact.value);
    const a = 66;
    const span = 134 + 138 * (value - .15) / .95;
    const b = a + span;
    const wire = $('.wire');
    wire.setAttribute('x2', b);
    const diagram = $('.rehearsal-diagram');
    diagram.style.setProperty('--wire-start', 38 / span);
    diagram.style.setProperty('--pull-start', `${38 - span}px`);
    $('.end-position').setAttribute('transform', `translate(${b} 0)`);
    $('.contact-position').setAttribute('transform', `translate(${a + span * u} 0)`);
    $('.wire-wave').setAttribute('d', `M${a} 69q${span / 4} -24 ${span / 2} 0t${span / 2} 0`);
    $('.length-output').textContent = `${value.toFixed(2)} / ${frequencyForPreviewLength(value).toFixed(1)} Hz`;
    $('.contact-output').textContent = `${Math.round(u * 100)}%`;
  }

  function close() {
    if (root.hidden || event.metaKey || event.ctrlKey || event.altKey || event.isComposing) return;
    root.hidden = true;
    onStopAudition();
    if (previousFocus?.isConnected) previousFocus.focus();
    previousFocus = null;
  }

  function click(event) {
    const button = event.target.closest('button');
    if (!button || !root.contains(button)) return;
    if (button.dataset.step != null) {
      step = Number(button.dataset.step);
      renderStep();
      return;
    }
    if (button.dataset.scene) {
      selected = button.dataset.scene;
      renderScene();
      onScene(selected);
      return;
    }
    switch (button.dataset.action) {
      case 'close': close(); break;
      case 'audition': onAudition({ scene: selected, frequency: frequencyForPreviewLength(Number(length.value)), u: Number(contact.value) }); break;
      case 'stop': onStopAudition(); break;
      case 'pointer': close(); onStart({ camera: false }); break;
      case 'camera': close(); onStart({ camera: true }); break;
      case 'melody': close(); onMelody(); break;
      case 'changes': close(); onChanges(); break;
      case 'empty': close(); onEmpty(); break;
    }
  }

  function key(event) {
    if (root.hidden) return;
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (stepTabs.includes(event.target)) {
      const destinations = { ArrowLeft: (step - 1 + steps.length) % steps.length, ArrowRight: (step + 1) % steps.length, Home: 0, End: steps.length - 1 };
      if (Object.hasOwn(destinations, event.key)) {
        event.preventDefault();
        step = destinations[event.key];
        renderStep();
        stepTabs[step].focus();
        return;
      }
    }
    if (event.key === 'Tab') {
      const focusable = [...root.querySelectorAll('button:not([disabled]),input:not([disabled])')]
        .filter((item) => item.tabIndex >= 0 && item.getClientRects().length);
      const first = focusable[0];
      const last = focusable.at(-1);
      const outside = !root.contains(document.activeElement);
      if (!first) event.preventDefault();
      else if (event.shiftKey && (document.activeElement === first || outside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || outside)) {
        event.preventDefault();
        first.focus();
      }
    }
  }

  root.addEventListener('click', click);
  root.addEventListener('input', renderRanges);
  root.addEventListener('keydown', key);
  renderStep();
  renderScene();
  renderRanges();
  return {
    open() {
      if (disposed || !root.hidden) return;
      previousFocus = document.activeElement;
      root.hidden = false;
      stepTabs[step].focus({ preventScroll: true });
    },
    close,
    setScene(id) {
      if (!scenes.some((scene) => scene.id === id)) return;
      selected = id;
      renderScene();
    },
    getState() {
      return { open: !root.hidden, scene: selected, step, length: Number(length.value), contact: Number(contact.value) };
    },
    dispose() {
      if (disposed) return;
      close();
      disposed = true;
      root.removeEventListener('click', click);
      root.removeEventListener('input', renderRanges);
      root.removeEventListener('keydown', key);
      root.replaceChildren();
    },
  };
}
