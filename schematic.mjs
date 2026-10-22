// The schematic viewer in a project report: the board's KiCad sheets drawn as SVG (projects/schematics/<sheet>.svg, built by
// projects/schematics/build-schematic.mjs) that can be panned and zoomed. Point at a wire, a pin or a net label and everything
// on that net lights up (with what it connects); click to hold it. Click a part to see what it is.
// bubble.mjs calls mount(slot, sheets) for a report that has a [data-schematic] slot.
import {panzoom} from './panzoom.mjs?v=pz1';

const cache = new Map();                                              // sheet id -> its SVG text
const el = (tag, attrs = {}, ...kids) => { const e = Object.assign(document.createElement(tag), attrs); e.append(...kids); return e; };

export function mount(slot, sheets) {
  const frame = el('div', {className: 'pcb-frame sch-frame', tabIndex: 0});
  frame.setAttribute('role', 'group'); frame.setAttribute('aria-label', 'Circuit schematic: drag to move, plus and minus to zoom, point at a wire to see what it connects');
  const stage = el('div', {className: 'pcb-stage'});
  const zoom = el('div', {className: 'pcb-zoom'}, ...[['in', '+', 'Zoom in'], ['out', '−', 'Zoom out'], ['fit', '⤢', 'Show the whole sheet']].map(([z, t, label]) => { const b = el('button', {type: 'button', textContent: t}); b.dataset.z = z; b.setAttribute('aria-label', label); return b; }));
  frame.append(stage, zoom);
  const tabs = el('div', {className: 'sch-sheets'}), places = el('div', {className: 'sch-places'});
  const bar = el('div', {className: 'pcb-bar'}, tabs, places);
  const info = el('div', {className: 'sch-info'}); info.setAttribute('aria-live', 'polite');
  const caption = el('figcaption', {className: 'pcb-caption', textContent: 'Point at a wire to light up its net · click a part to see what it is · drag to move · ctrl + scroll to zoom'});
  slot.replaceChildren(el('figure', {className: 'sch-fig'}, frame, bar, info, caption));

  const view = panzoom(frame);
  let sheet = null, svg = null, byNet = new Map(), hot = null, pinned = null, picked = null;

  // ---- what is shown under the drawing ----------------------------------------------------------------------------------
  const pinLabel = (ref, number) => { const p = sheet.parts[ref]?.pins[number]; return p && p.name && p.name !== '~' && !/^\d+$/.test(p.name) ? `${ref} ${p.name}` : `${ref}.${number}`; };
  const netLine = id => {
    const n = sheet.nets[id]; if (!n) return null;
    const pins = n.pins.map(p => { const [ref, number] = p.split('.'); return pinLabel(ref, number); });
    return [el('b', {textContent: n.name}), pins.length ? el('span', {textContent: ' · ' + pins.slice(0, 14).join(' · ') + (pins.length > 14 ? ` · +${pins.length - 14} more` : '')}) : ''];
  };
  const partLine = ref => {
    const p = sheet.parts[ref]; if (!p) return null;
    // the pins that go somewhere with a name: a label, or a power rail (not a stub to nowhere, or two parts joined directly)
    const named = n => sheet.nets[n]?.name && sheet.nets[n].pins.join('') !== sheet.nets[n].name.split(' – ').join('') && !/^net d+$/.test(sheet.nets[n].name) && !/^[A-Z]+d+.d+/.test(sheet.nets[n].name);
    const pins = Object.values(p.pins).filter(v => v.name && v.name !== '~' && !/^d+$/.test(v.name) && named(v.net)).slice(0, 10);
    return [el('b', {textContent: `${ref} · ${p.value}`}), el('span', {textContent: p.desc ? ' · ' + p.desc : ''}), pins.length > 1 ? el('span', {className: 'sch-pins', textContent: pins.map(v => `${v.name} → ${sheet.nets[v.net].name}`).join(' · ')}) : ''];
  };
  const refresh = () => {
    const show = hot ?? pinned;
    svg?.classList.toggle('hot', show != null);
    svg?.querySelectorAll('.on').forEach(e => e.classList.remove('on'));
    if (show != null) for (const e of byNet.get(show) || []) e.classList.add('on');
    svg?.querySelectorAll('.sel').forEach(e => e.classList.remove('sel'));
    if (picked) svg?.querySelector(`[data-ref="${CSS.escape(picked)}"]`)?.classList.add('sel');
    const line = show != null ? netLine(show) : picked ? partLine(picked) : null;
    info.replaceChildren(...(line || [el('span', {className: 'sch-hint', textContent: 'Nothing selected'})]));
  };

  // ---- pointing and clicking -------------------------------------------------------------------------------------------
  const target = (x, y) => document.elementFromPoint(x, y)?.closest?.('[data-net], [data-ref]');
  const netOf = t => t?.dataset.net != null ? +t.dataset.net : null;
  stage.addEventListener('pointerover', e => {
    if (e.pointerType !== 'mouse' || e.buttons) return;
    const id = netOf(e.target.closest('[data-net]')); if (id !== hot) { hot = id; refresh(); }
  });
  stage.addEventListener('pointerleave', () => { if (hot != null) { hot = null; refresh(); } });
  let down = null;
  frame.addEventListener('pointerdown', e => { down = [e.clientX, e.clientY]; });
  frame.addEventListener('pointerup', e => {
    if (!down || e.target.closest('.pcb-zoom')) return;
    const moved = Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 5; down = null;
    if (moved || view.moved()) return;                                // that was a drag
    const t = target(e.clientX, e.clientY), id = netOf(t);
    if (id != null && !t.dataset.ref) { pinned = pinned === id ? null : id; picked = null; }
    else if (t?.dataset.ref) { picked = picked === t.dataset.ref ? null : t.dataset.ref; pinned = null; }
    else { pinned = null; picked = null; }
    if (e.pointerType !== 'mouse') hot = null;
    refresh();
  });

  // ---- sheets and places ---------------------------------------------------------------------------------------------------
  async function choose(s) {
    sheet = s; hot = pinned = picked = null;
    tabs.hidden = sheets.length < 2;
    tabs.replaceChildren(...sheets.map(x => { const b = el('button', {type: 'button', textContent: x.title}); b.setAttribute('aria-pressed', String(x === s)); b.addEventListener('click', () => choose(x)); return b; }));
    frame.style.setProperty('--ar', String(Math.min(1.4, Math.max(1, s.viewBox[2] / s.viewBox[3]))));
    let text = cache.get(s.id);
    if (!text) { frame.classList.add('loading'); try { text = await (await fetch(s.src)).text(); cache.set(s.id, text); } catch { frame.classList.remove('loading'); return; } }
    if (sheet !== s) return;
    frame.classList.remove('loading');
    stage.innerHTML = text; svg = stage.firstElementChild; svg.setAttribute('aria-hidden', 'true');
    byNet = new Map(); for (const e of svg.querySelectorAll('[data-net]')) { const id = +e.dataset.net; (byNet.get(id) || byNet.set(id, []).get(id)).push(e); }
    view.set(svg, s.viewBox);
    places.replaceChildren(...[{label: 'Whole sheet', box: null}, ...s.regions].map(r => { const b = el('button', {type: 'button', textContent: r.label}); b.addEventListener('click', () => r.box ? view.show(r.box) : view.fit()); return b; }));
    refresh();
  }
  choose(sheets[0]);
}
