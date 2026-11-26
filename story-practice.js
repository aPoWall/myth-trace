import { CONFIG, clamp } from './config.js';
import { createFocusField } from './focus-field.js';
import { createSacredLayer } from './sacred-layer.js';
import { createSacredPattern } from './sacred-pattern.js';

// Rehearsal has its own renderer state. Only the performer can apply a card to the stage.
export function createStoryPractice(panel) {
  const box = panel.querySelector('[data-story-practice]');
  const canvas = box.querySelector('canvas');
  const ctx = canvas.getContext('2d');
  const readout = box.querySelector('output');
  const focusChoices = box.querySelector('[data-practice-focus]');
  const sacredChoices = box.querySelector('[data-practice-sacred]');
  const sacred = CONFIG.performancePresets.sacred;
  const recognize = createSacredPattern(sacred.detection);
  const drawSacred = createSacredLayer(sacred);
  const focus = createFocusField(CONFIG.focusField);
  const pointer = {x:.5, y:.5, focusActive:true};
  const emptyTracking = {hands:[], poses:[], anchors:[]};
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let story = '', mode = 'auto', pins = [], example = '', frame = 0, last = -Infinity;

  function chooseExample(id) {
    example = id;
    const aspect = canvas.clientWidth / Math.max(1, canvas.clientHeight);
    const halfWidth = Math.min(.25, .26 / aspect);
    pins = [{x:.5-halfWidth, y:.62}, {x:.5+halfWidth, y:.62}];
    if (id !== 'vesica') pins.push({x:.5, y:.62 - halfWidth * aspect * Math.sqrt(3)});
    if (id === 'lattice') pins.push({x:.5 + 2 * halfWidth, y:.62 - halfWidth * aspect * Math.sqrt(3)});
    recognize.reset();
  }

  function render(time) {
    frame = requestAnimationFrame(render);
    if (time - last < 1000 / 24 || document.hidden) return;
    last = time;
    const width = canvas.clientWidth, height = canvas.clientHeight;
    if (!width || !height) return;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
      if (story === 'blue' && example) chooseExample(example);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    let status;
    if (story === 'focus') {
      focus.render(ctx, width, height, time, emptyTracking, null, {
        pointer, focusGeometry:mode, reducedMotion:reduced.matches, hud:true,
      });
      status = canvas.dataset.focusGuide + ' · move or drag to turn';
    } else {
      const result = recognize({time, hands:[], pins, aspect:width/height});
      drawSacred(ctx, width, height, time, emptyTracking, null, {
        sacredLayer:'auto', sacredLiveShape:result.shape, sacredPins:pins,
        sacredStrength:1, sacredFacet:result.facet, reducedMotion:reduced.matches,
      });
      if (canvas.matches(':focus-visible')) {
        ctx.strokeStyle = '#d4e4ee';
        ctx.strokeRect(pointer.x * width - 4, pointer.y * height - 4, 8, 8);
      }
      for (const point of pins) {
        ctx.fillStyle = '#e5b789';
        ctx.fillRect(point.x * width - 2, point.y * height - 2, 4, 4);
      }
      canvas.dataset.formation = result.shape;
      const instruction = pins.length < 2 ? 'Place two points apart to form a lens.'
        : result.shape === 'off' ? 'Separate the first two points, then hold.'
        : sacred.shapes[result.shape] + ' · ' + sacred.principles[result.shape];
      status = pins.length + (pins.length === 1 ? ' pin · ' : ' pins · ') + instruction;
      for (const button of sacredChoices.querySelectorAll('[data-practice-example]')) {
        button.setAttribute('aria-pressed', String(result.shape === button.dataset.practiceExample));
      }
    }
    if (readout.value !== status) readout.value = status;
  }

  function setMode(value) {
    mode = value;
    for (const button of focusChoices.children) {
      button.setAttribute('aria-pressed', String(button.dataset.practiceMode === value));
    }
  }

  function move(x, y) {
    pointer.x = clamp(x);
    pointer.y = clamp(y);
  }
  function locate(event) {
    const rect = canvas.getBoundingClientRect();
    move((event.clientX - rect.left) / rect.width, (event.clientY - rect.top) / rect.height);
  }
  function addPin() {
    example = '';
    if (pins.length < CONFIG.lightScore.lattice.maxPins) pins.push({x:pointer.x, y:pointer.y});
  }

  canvas.addEventListener('pointermove', event => { locate(event); event.stopPropagation(); });
  canvas.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    locate(event);
    if (story === 'blue') addPin();
  });
  canvas.addEventListener('keydown', event => {
    const steps = {ArrowLeft:[-.05,0], ArrowRight:[.05,0], ArrowUp:[0,-.05], ArrowDown:[0,.05]};
    if (steps[event.key]) {
      const [x,y] = steps[event.key];
      move(pointer.x + x, pointer.y + y);
    } else if (story === 'blue' && ['Enter',' '].includes(event.key)) addPin();
    else return;
    event.preventDefault();
    event.stopPropagation();
  });
  box.addEventListener('click', event => {
    const button = event.target.closest('button');
    if (!button) return;
    if (button.dataset.practiceMode) setMode(button.dataset.practiceMode);
    else if (button.dataset.practiceExample) chooseExample(button.dataset.practiceExample);
    else if (button.hasAttribute('data-practice-clear')) { pins = []; example = ''; recognize.reset(); }
  });

  function close() {
    cancelAnimationFrame(frame);
    story = '';
    box.hidden = true;
    panel.classList.remove('is-practice');
  }
  function open(id, focusMode) {
    close();
    if (!ctx || (id !== 'focus' && id !== 'blue')) return;
    story = id;
    last = -Infinity;
    move(.5,.5);
    focus.reset();
    recognize.reset();
    box.hidden = false;
    panel.classList.add('is-practice');
    focusChoices.hidden = id !== 'focus';
    sacredChoices.hidden = id !== 'blue';
    canvas.setAttribute('aria-label', id === 'focus' ? 'Turn the lattice with the pointer or arrow keys' : 'Place pins with a click, or move with arrows and press Enter');
    if (id === 'focus') setMode(['auto','plane','crystal','rosette'].includes(focusMode) ? focusMode : 'auto');
    else chooseExample('vesica');
    frame = requestAnimationFrame(render);
  }
  return {open, close, focusMode:() => mode};
}
