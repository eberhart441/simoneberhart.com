// Dragging, pinching and zooming an SVG that sits in a frame, by moving its view-box (so it stays sharp at any zoom).
// Used by the PCB viewer (pcb.mjs) and the schematic viewer (schematic.mjs). The frame holds the SVG and a `.pcb-zoom` group
// of +, - and fit buttons. A plain scroll still scrolls the panel: ctrl + scroll (or a pinch) zooms.
const MAX = 48;                                                       // how far in: times the fitted view

export function panzoom(frame) {
  let svg = null, vb = null, box = null, pad = null, cx = 0, cy = 0, zoom = 1;

  const render = () => {
    if (!svg) return;
    const w = box[2] / zoom, h = box[3] / zoom;
    svg.setAttribute('viewBox', `${cx - w / 2} ${cy - h / 2} ${w} ${h}`);
  };
  // the view's centre stays over the drawing, so it cannot be dragged out of sight
  const clamp = () => { cx = Math.min(pad[0] + pad[2], Math.max(pad[0], cx)); cy = Math.min(pad[1] + pad[3], Math.max(pad[1], cy)); };
  const fitBox = () => {                                              // the view-box that fits the drawing in the frame, whatever the frame's shape
    const [x, y, w, h] = vb, m = Math.max(w, h) * .03;
    pad = [x - m, y - m, w + 2 * m, h + 2 * m];
    const r = frame.clientWidth / Math.max(1, frame.clientHeight);
    box = pad[2] / pad[3] > r ? [pad[0], pad[1], pad[2], pad[2] / r] : [pad[0], pad[1], pad[3] * r, pad[3]];
  };
  const fit = () => { zoom = 1; [cx, cy] = [pad[0] + pad[2] / 2, pad[1] + pad[3] / 2]; render(); };
  const zoomAt = (factor, px, py) => {                                // px, py: a point in the frame (px): it stays where it is
    if (!svg) return;
    const r = frame.getBoundingClientRect(), z = Math.min(MAX, Math.max(1, zoom * factor));
    const u = (px - r.left) / r.width - .5, v = (py - r.top) / r.height - .5, f = z / zoom;
    cx += (box[2] / zoom) * u * (1 - 1 / f); cy += (box[3] / zoom) * v * (1 - 1 / f);
    zoom = z; clamp(); render();
  };
  const centre = () => { const r = frame.getBoundingClientRect(); return [r.left + r.width / 2, r.top + r.height / 2]; };

  const pointers = new Map(); let pinch = 0;
  const dist = () => { const [a, b] = [...pointers.values()]; return Math.hypot(a[0] - b[0], a[1] - b[1]); };
  frame.addEventListener('pointerdown', e => {
    if (e.target.closest('.pcb-zoom') || !svg) return;
    frame.setPointerCapture(e.pointerId); pointers.set(e.pointerId, [e.clientX, e.clientY]);
    pinch = pointers.size === 2 ? dist() : 0;
    frame.classList.add('grabbing'); frame.focus({preventScroll: true});
  });
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
  // a finger on the drawing moves the drawing, not the panel (which would scroll, or on a phone be swiped shut)
  for (const t of ['touchstart', 'touchmove']) frame.addEventListener(t, e => e.stopPropagation(), {passive: true});
  frame.addEventListener('wheel', e => {
    if (!e.ctrlKey && !e.metaKey) return;                            // a plain scroll still scrolls the panel
    e.preventDefault(); zoomAt(Math.exp(-e.deltaY * (e.deltaMode ? .05 : .01)), e.clientX, e.clientY);
  }, {passive: false});
  frame.addEventListener('dblclick', e => { if (!e.target.closest('.pcb-zoom')) zoomAt(2, e.clientX, e.clientY); });
  frame.querySelector('.pcb-zoom')?.addEventListener('click', e => {
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
    e.preventDefault(); e.stopPropagation();                         // (the arrow keys would also turn the photo gallery)
  });
  new ResizeObserver(() => { if (svg) { fitBox(); render(); } }).observe(frame);

  return {
    // start showing an SVG whose full extent is `viewBox` ([x, y, w, h])
    set(el, viewBox) { svg = el; vb = viewBox; if (svg) { fitBox(); fit(); } },
    fit,
  };
}
