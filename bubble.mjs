// Project bubbles. Clicking a row in the glass card opens a panel on the right half, over the drawing, with that
// item's details and photo gallery. With liquid glass (liquid.mjs) the panel buds off the card's edge beside the row
// and merges back when closed; without it (phones: a sheet; wide screens: a fade) the panel has the Hyalite/CSS glass.
// Content: projects/items.json (from Simon's résumé). Photos: projects/<id>/, indexed by projects/build-gallery.mjs.
const card = document.querySelector('main');
const bubble = document.getElementById('bubble');
const body = bubble?.querySelector('.bubble-body');
const closeBtn = bubble?.querySelector('.bubble-close');
const wideQuery = matchMedia('(min-width: 1040px)');
const reduceQuery = matchMedia('(prefers-reduced-motion: reduce)');
const $ = sel => bubble.querySelector(sel);

let items = {}, gallery = {};
let openId = null, busy = null, pushed = false, photo = 0, closing = false, replace = false, dragY = 0;
// the sheet (narrow layout) dims the page behind it and stops it scrolling; the page keeps its place
const lockPage = on => document.documentElement.classList.toggle('sheet-open', on && !wideQuery.matches);
// one open, switch or close at a time: run it once the one before has finished (however many are waiting)
async function turn(run) {
  while (busy) await busy.catch(() => {});
  busy = run(); try { await busy; } finally { busy = null; }
  if (replace) { replace = false; place(); }                      // the window was resized meanwhile
}
// liquid.mjs, when it is on, draws the panel's glass: it buds the panel off the card and merges it back (liquidPanel)
const liquid = () => window.Liquid?.active;
let liquidPanel = null;

let loaded = null;                                                // rows wait for the content (a click before it arrived)
async function load() {
  const get = async url => { try { const r = await fetch(url); return r.ok ? r.json() : null; } catch { return null; } };
  const [list, pics] = await Promise.all([get('projects/items.json'), get('projects/gallery.json')]);
  for (const it of list || []) items[it.id] = it;
  gallery = pics || {};
}

// ---- content --------------------------------------------------------------------------------------------------
function fill(id) {
  const it = items[id];
  $('.bubble-kind').textContent = it.kind;
  $('#bubble-title').textContent = it.title;
  $('.bubble-meta').textContent = [it.role, it.dates].filter(Boolean).join(' · ');
  $('.bubble-meta').hidden = !it.role && !it.dates;
  $('.bubble-summary').textContent = it.summary || '';
  const ul = $('.bubble-points'); ul.replaceChildren(...(it.points || []).map(t => Object.assign(document.createElement('li'), {textContent: t})));
  const tools = $('.bubble-tools');
  tools.hidden = !it.tools?.length;
  tools.replaceChildren(...(it.tools || []).map(t => Object.assign(document.createElement('span'), {textContent: t})));
  const links = $('.bubble-links');
  links.hidden = !it.links?.length;
  links.replaceChildren(...(it.links || []).map(l => Object.assign(document.createElement('a'), {href: l.href, textContent: l.label + ' ↗', target: '_blank', rel: 'noopener'})));
  photo = 0; showGallery(id);
  body.scrollTop = 0; scrolled();
}

function showGallery(id) {
  const pics = gallery[id] || [], fig = $('.gallery');
  fig.hidden = !pics.length;
  if (!pics.length) return;
  const many = pics.length > 1;
  $('.gallery-prev').hidden = $('.gallery-next').hidden = !many;
  const thumbs = $('.gallery-thumbs');
  $('.gallery-strip').hidden = !many;
  thumbs.replaceChildren(...pics.map((p, i) => {
    const b = document.createElement('button');
    b.type = 'button'; b.setAttribute('aria-label', `Photo ${i + 1}`);
    b.append(Object.assign(document.createElement('img'), {src: p.src, alt: '', loading: 'lazy', decoding: 'async'}));
    b.addEventListener('click', () => setPhoto(i));
    return b;
  }));
  setPhoto(photo);
}
function setPhoto(i) {
  const pics = gallery[openId] || [];
  if (!pics.length) return;
  photo = (i + pics.length) % pics.length;
  const img = $('.gallery-frame img'), p = pics[photo];
  img.src = p.src; img.alt = p.caption || `${items[openId].title}, photo ${photo + 1}`;
  $('.gallery-caption').textContent = p.caption || '';
  $('.gallery-count').textContent = pics.length > 1 ? `${photo + 1} / ${pics.length}` : '';
  [...$('.gallery-thumbs').children].forEach((b, k) => b.classList.toggle('on', k === photo));
  requestAnimationFrame(scrolled);                                 // a caption can change the content height
}

// ---- scrolling: soft edges where content continues, and a slim indicator in place of the native bar -------------
const bar = bubble?.querySelector('.bubble-bar i');
let quiet = 0;
function scrolled(e) {
  const max = body.scrollHeight - body.clientHeight, top = body.scrollTop;
  bubble.classList.toggle('scrollable', max > 1);
  body.style.setProperty('--fade-top', Math.min(56, top) + 'px');
  body.style.setProperty('--fade-bottom', Math.min(40, Math.max(0, max - top)) + 'px');
  if (max > 1) {
    const track = bar.parentElement.clientHeight, h = Math.max(28, track * body.clientHeight / body.scrollHeight);
    bar.style.height = h + 'px';
    bar.style.transform = `translateY(${(track - h) * top / max}px)`;
  }
  if (e) { bubble.classList.add('scrolling'); clearTimeout(quiet); quiet = setTimeout(() => bubble.classList.remove('scrolling'), 700); }
}

// ---- geometry -------------------------------------------------------------------------------------------------
// The safe-area insets (a notch, rounded corners) in px. CSS env() can only be read through a measured element.
let insetProbe = null;
function sideInsets() {
  if (!insetProbe) {
    insetProbe = document.createElement('div'); insetProbe.setAttribute('aria-hidden', 'true');
    insetProbe.style.cssText = 'position:fixed;visibility:hidden;pointer-events:none;padding:0 env(safe-area-inset-right) 0 env(safe-area-inset-left)';
    document.body.append(insetProbe);
  }
  const s = getComputedStyle(insetProbe);
  return {left: parseFloat(s.paddingLeft) || 0, right: parseFloat(s.paddingRight) || 0};
}
function finalRect() {
  const vw = innerWidth, vh = innerHeight;
  if (!wideQuery.matches) {                                       // a sheet: on tablets no wider than the card, centred, clear of any notch
    // The page's width is the root element's box: innerWidth and clientWidth both count the scrollbar space the page keeps
    // reserved (scrollbar-gutter), which a fixed element cannot reach.
    const {left, right} = sideInsets(), room = document.documentElement.getBoundingClientRect().width - left - right, width = Math.min(room - 16, 676);
    return {left: Math.round(left + (room - width) / 2), top: Math.round(vh * .08), width, height: Math.round(vh * .92) + 30};
  }
  // the card's mirror image in the right half: same size, same top and bottom, same outer margin
  const cr = card.getBoundingClientRect(), visible = document.documentElement.clientWidth;
  return {left: Math.round(visible - cr.right), top: Math.round(cr.top), width: Math.round(cr.width), height: Math.round(cr.height)};
}
function rowPoint(id) {                                           // where on the card's edge the bubble buds from
  const btn = card.querySelector(`[data-item="${id}"] .open`), cr = card.getBoundingClientRect();
  const r = btn.getBoundingClientRect();
  const y = Math.min(cr.bottom - 30, Math.max(cr.top + 30, r.top + r.height / 2));
  return {x: wideQuery.matches ? cr.right : Math.min(cr.right - 24, r.right + 24), y};
}
const px = r => ({left: r.left + 'px', top: r.top + 'px', width: r.width + 'px', height: r.height + 'px', borderRadius: (r.radius ?? 22) + 'px'});

// ---- open / switch / close --------------------------------------------------------------------------------------
// without liquid glass: the panel's refracting Hyalite glass, whose edge and lighting fade in (.lit) instead of popping on
const glass = on => {
  if (liquid()) return;                                             // the canvas draws this glass
  if (on) bubble.classList.add('shadowed'); else bubble.classList.remove('lit');
  if (!window.Hyalite) return;
  if (on && wideQuery.matches && window.SimonGlass) {
    Hyalite.attach(bubble, window.SimonGlass);
    requestAnimationFrame(() => requestAnimationFrame(() => { if (openId && !bubble.classList.contains('moving')) bubble.classList.add('lit'); }));
  } else Hyalite.detach(bubble);
};
function markRow(id) {
  card.querySelectorAll('article[data-item]').forEach(a => {
    const on = a.dataset.item === id;
    a.classList.toggle('active', on);
    a.querySelector('.open')?.setAttribute('aria-expanded', String(on));
  });
}

async function open(id, {history: push = true} = {}) {
  await loaded;
  if (!items[id]) return;
  return turn(() => openId === id ? null : openId ? swap(id, push) : show(id, push));
}
async function show(id, push) {
  openId = id;
  fill(id);
  markRow(id);
  bubble.classList.add('moving');
  bubble.classList.remove('shadowed', 'lit');
  const F = finalRect();
  dragY = 0; bubble.style.transition = '';
  Object.assign(bubble.style, px(F));
  lockPage(true);
  // the bubble's history entry must not carry a scroll position: closing goes back one entry, and the browser would
  // restore where the page was when the bubble opened, undoing any scrolling done since (manual until it is closed)
  history.scrollRestoration = 'manual';
  if (push) { history.pushState({bubble: id}, '', '#' + id); pushed = true; }
  if (wideQuery.matches && liquid()) {                            // a blob of the card's glass buds off and inflates
    // (with reduced motion too: the glass is drawn by the canvas, which then sets it in place without the journey)
    bubble.classList.remove('moving');
    const fade = {duration: 220, easing: 'cubic-bezier(.2,.7,.3,1)', fill: 'both'};
    // hidden from the first frame (an animation *to* 0 starts from the current, visible value: a one-frame flash)
    body.getAnimations().forEach(a => a.cancel()); closeBtn.getAnimations().forEach(a => a.cancel());
    body.style.opacity = closeBtn.style.opacity = '0';
    bubble.hidden = false;
    liquidPanel = await window.Liquid.bud(rowPoint(id), F);
    body.animate([{opacity: 0, transform: 'translateY(6px)'}, {opacity: 1, transform: 'none'}], fade);
    const shown = closeBtn.animate([{opacity: 0}, {opacity: 1}], fade);
    body.style.opacity = closeBtn.style.opacity = '';                 // the fade (fill: both) holds it from here
    await shown.finished;
  } else if (reduceQuery.matches) {
    bubble.hidden = false;
    await bubble.animate([{opacity: 0}, {opacity: 1}], {duration: 200, easing: 'ease-out'}).finished;
  } else if (!wideQuery.matches) {                               // phones: a sheet sliding up
    bubble.hidden = false;
    await bubble.animate([{transform: 'translateY(100%)'}, {transform: 'none'}], {duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)'}).finished;
  } else {                                                        // wide, without liquid glass: it fades in
    bubble.hidden = false;
    await bubble.animate([{opacity: 0, transform: 'translateY(10px)'}, {opacity: 1, transform: 'none'}], {duration: 320, easing: 'cubic-bezier(.2,.7,.3,1)'}).finished;
  }
  bubble.classList.remove('moving');
  glass(true);
  $('#bubble-title').focus({preventScroll: true});
}

async function swap(id, push) {                                   // already open: cross-fade and morph the size
  glass(false); bubble.classList.add('moving');
  const from = bubble.getBoundingClientRect();
  await body.animate([{opacity: 1}, {opacity: 0}], {duration: 140, fill: 'forwards'}).finished;
  openId = id; fill(id); markRow(id);
  const F = finalRect();
  Object.assign(bubble.style, px(F));
  if (!reduceQuery.matches) await bubble.animate([px({left: from.left, top: from.top, width: from.width, height: from.height}), px(F)],
    {duration: 380, easing: 'cubic-bezier(.3,.7,.2,1)'}).finished;
  body.getAnimations().forEach(a => a.cancel());
  await body.animate([{opacity: 0}, {opacity: 1}], {duration: 200}).finished;
  // switching replaces the history entry, so Back (or ×) closes the bubble instead of stepping through rows
  if (push) history.replaceState({bubble: id}, '', '#' + id);
  bubble.classList.remove('moving'); glass(true);
  $('#bubble-title').focus({preventScroll: true});
}

async function close({fromHistory = false} = {}) {
  if (!openId || (closing && !fromHistory)) return;
  while (busy) await busy.catch(() => {});
  if (!openId || (closing && !fromHistory)) return;                 // (another close got in first while this one waited)
  // popstate finishes the close; until then a second close (Esc twice) must not step back again, off the site
  if (!fromHistory && pushed && history.state?.bubble) { closing = true; history.back(); return; }
  closing = false;
  if (!fromHistory && location.hash) history.replaceState(null, '', location.pathname + location.search);
  const id = openId;
  return turn(async () => {
    if (openId !== id) return;
    lockPage(false);
    const settle = () => { glass(false); bubble.classList.add('moving'); };
    if (liquid() && liquidPanel) {                                  // the text fades, the glass merges back into the card
      const fade = {duration: reduceQuery.matches ? 0 : 110, easing: 'ease-in', fill: 'forwards'};
      body.animate([{opacity: 1}, {opacity: 0}], fade);
      await closeBtn.animate([{opacity: 1}, {opacity: 0}], fade).finished;
      const merging = liquidPanel.close(rowPoint(id)); liquidPanel = null;
      bubble.hidden = true;
      await merging;
      closeBtn.getAnimations().forEach(a => a.cancel());
    } else if (reduceQuery.matches) { settle(); await bubble.animate([{opacity: 1}, {opacity: 0}], {duration: 180}).finished; }
    else if (!wideQuery.matches) {
      settle();
      const from = dragY ? `translateY(${dragY}px)` : 'none';
      await bubble.animate([{transform: from}, {transform: 'translateY(100%)'}], {duration: dragY ? 240 : 340, easing: 'cubic-bezier(.5,0,.8,.4)'}).finished;
    } else {                                                        // wide, without liquid glass: it fades out
      settle();
      await bubble.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'translateY(10px)'}], {duration: 220, easing: 'ease-in'}).finished;
    }
    bubble.hidden = true; bubble.classList.remove('moving', 'shadowed');
    dragY = 0; bubble.style.transform = ''; bubble.style.transition = '';
    body.getAnimations().forEach(a => a.cancel()); closeBtn.style.opacity = '';
    openId = null; pushed = false; markRow(null);
    requestAnimationFrame(() => { if (!openId) history.scrollRestoration = 'auto'; });
    card.querySelector(`[data-item="${id}"] .open`)?.focus({preventScroll: true});
  });
}

// Narrow layout: drag the sheet down from the top of its content to close it. It follows the finger, closes on a long or quick
// drag (the close continues from where the finger left it) and springs back otherwise.
function sheetSwipe(scrim) {
  let y0 = 0, dy = 0, t0 = 0, dragging = false;
  const ready = () => !wideQuery.matches && openId && !busy;
  bubble.addEventListener('touchstart', e => { y0 = ready() && e.touches.length === 1 ? e.touches[0].clientY : 0; dy = 0; dragging = false; t0 = e.timeStamp; }, {passive: true});
  bubble.addEventListener('touchmove', e => {
    if (!y0 || !ready()) return;
    const d = e.touches[0].clientY - y0;
    if (!dragging) { if (d > 8 && body.scrollTop <= 0) dragging = true; else return; }
    e.preventDefault();
    dy = Math.max(0, d); bubble.style.transition = 'none'; bubble.style.transform = `translateY(${dy}px)`;
    scrim.style.opacity = String(Math.max(.2, 1 - dy / 500));
  }, {passive: false});
  const springBack = () => {
    bubble.style.transition = 'transform .25s ease'; bubble.style.transform = '';
    setTimeout(() => { bubble.style.transition = ''; }, 280);
  };
  const finish = e => {
    scrim.style.opacity = '';
    if (!dragging) { y0 = 0; return; }
    dragging = false; y0 = 0;
    const released = e.type === 'touchend';                           // a cancelled touch (the system took it) never closes
    if (released && !closing && (dy > 110 || dy / Math.max(1, e.timeStamp - t0) > .6)) { dragY = dy; close(); return; }
    springBack();
  };
  bubble.addEventListener('touchend', finish); bubble.addEventListener('touchcancel', finish);
}

// the panel's place for the window as it is now (the liquid glass body too)
function place() {
  if (!openId) return;
  if (busy) { replace = true; return; }
  glass(false); const F = finalRect(); Object.assign(bubble.style, px(F)); liquidPanel?.place(F); glass(true);
}

// ---- wiring -----------------------------------------------------------------------------------------------------
async function init() {
  if (!card || !bubble) return;
  loaded = load();
  const toggle = id => openId === id ? close() : open(id);
  card.querySelectorAll('article[data-item] .open').forEach(btn => btn.addEventListener('click', () => toggle(btn.closest('article').dataset.item)));
  // narrow layout: a tap anywhere on a row opens it (the links inside keep working; desktop keeps the title only)
  card.querySelectorAll('article[data-item]').forEach(row => row.addEventListener('click', e => {
    if (wideQuery.matches || e.target.closest('a, button')) return;
    toggle(row.dataset.item);
  }));
  const scrim = document.createElement('div'); scrim.className = 'sheet-scrim'; scrim.setAttribute('aria-hidden', 'true'); document.body.append(scrim);
  scrim.addEventListener('click', () => close());                   // on click, not on press: the click then ends on the scrim itself
  sheetSwipe(scrim);
  closeBtn.addEventListener('click', () => close());
  body.addEventListener('scroll', scrolled, {passive: true});
  new ResizeObserver(() => scrolled()).observe(body);               // the bubble resizing or morphing
  $('.gallery-prev').addEventListener('click', () => setPhoto(photo - 1));
  $('.gallery-next').addEventListener('click', () => setPhoto(photo + 1));
  addEventListener('keydown', e => {
    if (!openId) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.altKey && !e.ctrlKey && !e.metaKey && !e.target.closest?.('input,textarea')) {
      if (!$('.gallery').hidden) { e.preventDefault(); setPhoto(photo + (e.key === 'ArrowRight' ? 1 : -1)); }
    }
  });
  // a click on empty space closes the bubble (and, while it is open, does nothing else)
  addEventListener('pointerdown', e => {
    if (!wideQuery.matches) return;                                 // narrow layout: the scrim closes the sheet (above)
    if (!openId || bubble.contains(e.target) || e.target.closest?.('main')) return;
    e.stopImmediatePropagation();
    close();
  }, {capture: true});
  addEventListener('popstate', e => {
    const id = e.state?.bubble ?? location.hash.slice(1);           // typed or linked #id carries no state
    if (id && items[id]) { closing = false; pushed = true; open(id, {history: false}); }
    else close({fromHistory: true});
  });
  addEventListener('resize', place);
  // liquid glass switches with the width (liquid.mjs has already switched by now): a panel left open gets the glass of
  // the mode it is in — the liquid engine buds it a new body, or drops the old one along with its other glass
  wideQuery.addEventListener('change', () => {
    lockPage(!!openId);
    if (!liquid()) liquidPanel = null;
    if (!openId) return;
    turn(async () => {
      if (!openId) return;
      Object.assign(bubble.style, px(finalRect()));
      if (liquid() && !liquidPanel) liquidPanel = await window.Liquid.bud(rowPoint(openId), finalRect());
    });
  });
  await loaded;
  const start = location.hash.slice(1);
  if (items[start]) { history.replaceState({bubble: start}, '', '#' + start); pushed = false; open(start, {history: false}); }
  else (window.requestIdleCallback || setTimeout)(warm, {timeout: 2500});
}

// Without liquid glass, build Hyalite's refraction map for the panel's size ahead of time (cached by size; every panel
// is the same size), so the first opening does not build it mid-animation.
function warm() {
  if (openId || busy || !wideQuery.matches || liquid()) return;
  if (!window.Hyalite || !window.SimonGlass) return;
  Object.assign(bubble.style, px(finalRect()), {visibility: 'hidden'});
  bubble.hidden = false;
  Hyalite.attach(bubble, window.SimonGlass);
  requestAnimationFrame(() => requestAnimationFrame(() => {
    if (!openId) { Hyalite.detach(bubble); bubble.hidden = true; }
    bubble.style.visibility = '';
  }));
}
init();
