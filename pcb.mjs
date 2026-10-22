// The PCB viewer in a project panel: a board's layers as one SVG (projects/pcb/<board>.svg, built from its Gerber files by
// projects/pcb/build-pcb.mjs) that can be panned, zoomed, flipped between top and bottom, and have its layers switched.
// bubble.mjs calls show(boards) when a project has boards (projects/pcb/boards.json) and hide() otherwise.
import {panzoom} from './panzoom.mjs?v=pz2';
const root = document.querySelector('.pcb');
const $ = sel => root.querySelector(sel);
const frame = $('.pcb-frame'), stage = $('.pcb-stage');
const view = panzoom(frame);

const LAYERS = [['cu', 'Copper'], ['in1', 'Inner 1'], ['in2', 'Inner 2'], ['silk', 'Silkscreen'], ['holes', 'Holes']];
const cache = new Map();                                              // board id -> its SVG text
let boards = [], board = null, svg = null, flip = null;
let side = 'top', shown = new Set(['cu', 'silk', 'holes']);

// ---- layers and side ------------------------------------------------------------------------------------------
function apply() {
  if (!svg) return;
  svg.dataset.side = side;
  svg.dataset.show = [...shown].join(' ');
  if (flip) flip.setAttribute('transform', side === 'bot' ? `translate(${2 * (board.viewBox[0] + board.viewBox[2] / 2)} 0) scale(-1 1)` : '');
  root.querySelectorAll('.pcb-side button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.side === side)));
  root.querySelectorAll('.pcb-layers button').forEach(b => b.setAttribute('aria-pressed', String(shown.has(b.dataset.layer))));
}
function buildBar() {
  const tabs = $('.pcb-boards');
  tabs.hidden = boards.length < 2;
  tabs.replaceChildren(...boards.map(b => {
    const el = Object.assign(document.createElement('button'), {type: 'button', textContent: b.title});
    el.dataset.board = b.id; el.addEventListener('click', () => select(b));
    return el;
  }));
  const have = new Set(['cu', 'silk', 'holes', ...(board?.parts.includes('cu-in1') ? ['in1'] : []), ...(board?.parts.includes('cu-in2') ? ['in2'] : [])]);
  $('.pcb-layers').replaceChildren(...LAYERS.filter(([k]) => have.has(k)).map(([k, label]) => {
    const el = Object.assign(document.createElement('button'), {type: 'button', textContent: label});
    el.dataset.layer = k;
    el.addEventListener('click', () => { shown.has(k) ? shown.delete(k) : shown.add(k); apply(); });
    return el;
  }));
}

async function select(b) {
  board = b;
  const keep = shown; shown = new Set([...keep].filter(k => !['in1', 'in2'].includes(k) || b.parts.includes('cu-' + k)));
  buildBar();
  root.querySelectorAll('.pcb-boards button').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.board === b.id)));
  frame.style.setProperty('--ar', String(Math.min(2.2, Math.max(4 / 3, b.viewBox[2] / b.viewBox[3]))));
  let text = cache.get(b.id);
  if (!text) { frame.classList.add('loading'); try { text = await (await fetch(b.src)).text(); cache.set(b.id, text); } catch { frame.classList.remove('loading'); return; } }
  if (board !== b) return;                                          // another board was chosen while this one loaded
  frame.classList.remove('loading');
  stage.innerHTML = text;
  svg = stage.firstElementChild;
  flip = document.createElementNS('http://www.w3.org/2000/svg', 'g');
  flip.append(...svg.childNodes); svg.append(flip);
  svg.setAttribute('aria-hidden', 'true');
  view.set(svg, b.viewBox); apply();
  $('.pcb-caption').textContent = [b.width && `${+b.width.toFixed(1)} × ${+b.height.toFixed(1)} mm`, b.layers && `${b.layers} layers`, 'drag to move · ctrl + scroll to zoom'].filter(Boolean).join(' · ');
}

export function show(list) {
  boards = list || [];
  root.hidden = !boards.length;
  if (!boards.length) { svg = null; board = null; view.set(null); stage.replaceChildren(); return; }
  side = 'top'; shown = new Set(['cu', 'silk', 'holes']);
  select(boards[0]);
}
export const hide = () => show(null);

root.querySelectorAll('.pcb-side button').forEach(b => b.addEventListener('click', () => { side = b.dataset.side; apply(); }));
