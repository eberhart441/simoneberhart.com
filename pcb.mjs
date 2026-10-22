// The PCB viewer in a project panel: a board's layers as one SVG (projects/pcb/<board>.svg, built from its Gerber files by
// projects/pcb/build-pcb.mjs) that can be panned, zoomed, flipped between top and bottom, and have its layers switched.
// bubble.mjs calls show(boards) when a project has boards (projects/pcb/boards.json) and hide() otherwise.
const root = document.querySelector('.pcb');
const $ = sel => root.querySelector(sel);
const frame = $('.pcb-frame'), stage = $('.pcb-stage');
const MAX = 48;                                                       // how far in: times the fitted view

const LAYERS = [['cu', 'Copper'], ['in1', 'Inner 1'], ['in2', 'Inner 2'], ['silk', 'Silkscreen'], ['holes', 'Holes']];
const cache = new Map();                                              // board id -> its SVG text
let boards = [], board = null, svg = null, flip = null;
let side = 'top', shown = new Set(['cu', 'silk', 'holes']);
let box = null, cx = 0, cy = 0, zoom = 1, pad = null;                // box: the fitted view [x, y, w, h]; cx, cy: its centre now

const render = () => {
  if (!svg) return;
  const w = box[2] / zoom, h = box[3] / zoom;
  svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
};
// the view's centre stays over the board, so it cannot be dragged out of sight
const clamp = () => { cx = Math.min(pad[0] + pad[2], Math.max(pad[0], cx)); cy = Math.min(pad[1] + pad[3], Math.max(pad[1], cy)); };
const fit = () => { zoom = 1; [cx, cy] = [pad[0] + pad[2] / 2, pad[1] + pad[3] / 2]; render(); };
// the view-box that fits the board in the frame, whatever the frame's shape
function fitBox() {
  const [x, y, w, h] = board.viewBox, m = Math.max(w, h) * .03;
  pad = [x - m, y - m, w + 2 * m, h + 2 * m];
  const r = frame.clientWidth / Math.max(1, frame.clientHeight);
  box = pad[2] / pad[3] > r ? [pad[0], pad[1], pad[2], pad[2] / r] : [pad[0], pad[1], pad[3] * r, pad[3]];
}

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
  root.querySelectorAll('.pcb-boards button').forEach(el => el.setAttribute('aria-pressed', String(el.dataset.board === b.id)));
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
  fitBox(); fit(); apply();
  $('.pcb-caption').textContent = [b.width && `${+b.width.toFixed(1)} × ${+b.height.toFixed(1)} mm`, b.layers && `${b.layers} layers`, 'drag to move · ctrl + scroll to zoom'].filter(Boolean).join(' · ');
}

export function show(list) {
  boards = list || [];
  root.hidden = !boards.length;
  if (!boards.length) { svg = null; board = null; stage.replaceChildren(); return; }
  side = 'top'; shown = new Set(['cu', 'silk', 'holes']);
  select(boards[0]);
}
export const hide = () => show(null);

// ---- looking around: drag, pinch, ctrl + scroll, buttons, keys ------------------------------------------------------
const zoomAt = (factor, px, py) => {                                // px, py: a point in the frame (px); it stays where it is
  if (!svg) return;
  const r = frame.getBoundingClientRect(), z = Math.min(MAX, Math.max(1, zoom * factor));
  const u = (px - r.left) / r.width - .5, v = (py - r.top) / r.height - .5;
  const f = z / zoom;                                               // (the view box's size is box / zoom)
  cx += (box[2] / zoom) * u * (1 - 1 / f); cy += (box[3] / zoom) * v * (1 - 1 / f);
  zoom = z; clamp(); render();
};
const centre = () => { const r = frame.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };
const pointers = new Map(); let pinch = 0;
frame.addEventListener('pointerdown', e => {
  if (e.target.closest('.pcb-zoom') || !svg) return;
  frame.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
  pinch = pointers.size === 2 ? dist() : 0;
  frame.classList.add('grabbing'); frame.focus({preventScroll: true});
});
const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
frame.addEventListener('pointermove', e => {
  const p = pointers.get(e.pointerId); if (!p || !svg) return;
  const dx = e.clientX - p[0], dy = e.clientY - p[1]; pointers.set(e.pointerId, [e.clientX, e.clientY]);
  if (pointers.size === 2) {
    const d = dist(), [a, b] = [...pointers.values()];
    if (pinch) zoomAt(d / pinch, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
    pinch = d; return;
  }
  const r = frame.getBoundingClientRect();
  cx -= dx / r.width * (box[2] / zoom); cy -= dy / r.height * (box[3] / zoom); clamp(); render();
});
const release = e => { pointers.delete(e.pointerId); pinch = 0; if (!pointers.size) frame.classList.remove('grabbing'); };
frame.addEventListener('pointerup', release); frame.addEventListener('pointercancel', release);
// a finger on the board moves the board, not the panel (which would scroll, or on a phone be swiped shut)
for (const t of ['touchstart', 'touchmove']) frame.addEventListener(t, e => e.stopPropagation(), {passive: true});
frame.addEventListener('wheel', e => {
  if (!e.ctrlKey && !e.metaKey) return;                              // a plain scroll still scrolls the panel
  e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? .05 : .01)), e.clientX, e.clientY);
}, {passive: false});
frame.addEventListener('dblclick', e => { if (!e.target.closest('.pcb-zoom')) zoomAt(2, e.clientX, e.clientY); });
$('.pcb-zoom').addEventListener('click', e => {
  const z = e.target.closest('button')?.dataset.z; if (!z) return;
  if (z === 'fit') fit(); else zoomAt(z === 'in' ? 1.6 : 1 / 1.6, ...centre());
});
frame.addEventListener('keydown', e => {
  const step = (box?.[2] ?? 0) / zoom * .12;
  const move = {ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step]}[e.key];
  if (move) { cx += move[0]; cy += move[1]; clamp(); render(); }
  else if (e.key === '+' || e.key === '=') zoomAt(1.4, ...centre());
  else if (e.key === '-') zoomAt(1 / 1.4, ...centre());
  else if (e.key === '0') fit();
  else return;
  e.preventDefault(); e.stopPropagation();                           // (the arrow keys would also turn the photo gallery)
});
root.querySelectorAll('.pcb-side button').forEach(b => b.addEventListener('click', () => { side = b.dataset.side; apply(); }));
new ResizeObserver(() => { if (svg) { fitBox(); render(); } }).observe(frame);
