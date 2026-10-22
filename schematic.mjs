// The schematic viewer in a project report: the board's KiCad sheets drawn as SVG (projects/schematics/<sheet>.svg, built by
// projects/schematics/build-schematic.mjs) that can be panned and zoomed, one sheet at a time.
// bubble.mjs calls mount(slot, sheets) for a report that has a [data-schematic] slot.
import {panzoom} from './panzoom.mjs?v=pz2';

const cache = new Map();                                              // sheet id -> its SVG text
const el = (tag, attrs = {}, ...kids) => { const e = Object.assign(document.createElement(tag), attrs); e.append(...kids); return e; };

export function mount(slot, sheets) {
  const frame = el('div', {className: 'pcb-frame sch-frame', tabIndex: 0});
  frame.setAttribute('role', 'group'); frame.setAttribute('aria-label', 'Circuit schematic: drag to move, plus and minus to zoom');
  const stage = el('div', {className: 'pcb-stage'});
  const zoom = el('div', {className: 'pcb-zoom'}, ...[['in', '+', 'Zoom in'], ['out', '−', 'Zoom out'], ['fit', '⤢', 'Show the whole sheet']].map(([z, t, label]) => { const b = el('button', {type: 'button', textContent: t}); b.dataset.z = z; b.setAttribute('aria-label', label); return b; }));
  frame.append(stage, zoom);
  const tabs = el('div', {className: 'sch-sheets'});
  const bar = el('div', {className: 'pcb-bar'}, tabs);
  const caption = el('figcaption', {className: 'pcb-caption', textContent: 'drag to move · ctrl + scroll to zoom'});
  slot.replaceChildren(el('figure', {className: 'sch-fig'}, frame, bar, caption));

  const view = panzoom(frame);
  let sheet = null;

  async function choose(s) {
    sheet = s;
    tabs.hidden = sheets.length < 2;
    tabs.replaceChildren(...sheets.map(x => { const b = el('button', {type: 'button', textContent: x.title}); b.setAttribute('aria-pressed', String(x === s)); b.addEventListener('click', () => choose(x)); return b; }));
    frame.style.setProperty('--ar', String(Math.min(1.4, Math.max(1, s.viewBox[2] / s.viewBox[3]))));
    let text = cache.get(s.id);
    if (!text) { frame.classList.add('loading'); try { text = await (await fetch(s.src)).text(); cache.set(s.id, text); } catch { frame.classList.remove('loading'); return; } }
    if (sheet !== s) return;                                          // another sheet was chosen while this one loaded
    frame.classList.remove('loading');
    stage.innerHTML = text;
    const svg = stage.firstElementChild; svg.setAttribute('aria-hidden', 'true');
    view.set(svg, s.viewBox);
  }
  choose(sheets[0]);
}
