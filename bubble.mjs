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
let openId = null, busy = null, pushed = false, photo = 0;
// liquid.mjs, when it is on, draws the panel's glass: it buds the panel off the card and merges it back (liquidPanel)
const liquid = () => window.Liquid?.active;
let liquidPanel = null;

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
function finalRect() {
  const vw = innerWidth, vh = innerHeight;
  if (!wideQuery.matches) return {left: 8, top: Math.round(vh * .08), width: vw - 16, height: Math.round(vh * .92) + 30};
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
  if (!items[id]) return;
  if (busy) await busy;
  if (openId === id) return;
  if (openId) return swap(id, push);
  openId = id;
  fill(id);
  markRow(id);
  bubble.classList.add('moving');
  bubble.classList.remove('shadowed', 'lit');
  const F = finalRect();
  Object.assign(bubble.style, px(F));
  // the bubble's history entry must not carry a scroll position: closing goes back one entry, and the browser would
  // restore where the page was when the bubble opened, undoing any scrolling done since (manual until it is closed)
  history.scrollRestoration = 'manual';
  if (push) { history.pushState({bubble: id}, '', '#' + id); pushed = true; }
  const run = async () => {
    if (reduceQuery.matches) {
      bubble.hidden = false;
      await bubble.animate([{opacity: 0}, {opacity: 1}], {duration: 200, easing: 'ease-out'}).finished;
    } else if (!wideQuery.matches) {                               // phones: a sheet sliding up
      bubble.hidden = false;
      await bubble.animate([{transform: 'translateY(100%)'}, {transform: 'none'}], {duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)'}).finished;
    } else if (liquid()) {                                          // a blob of the card's glass buds off and inflates
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
    } else {                                                        // wide, without liquid glass: it fades in
      bubble.hidden = false;
      await bubble.animate([{opacity: 0, transform: 'translateY(10px)'}, {opacity: 1, transform: 'none'}], {duration: 320, easing: 'cubic-bezier(.2,.7,.3,1)'}).finished;
    }
    bubble.classList.remove('moving');
    glass(true);
    $('#bubble-title').focus({preventScroll: true});
  };
  busy = run(); await busy; busy = null;
}

async function swap(id, push) {                                   // already open: cross-fade and morph the size
  const run = async () => {
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
  };
  busy = run(); await busy; busy = null;
}

async function close({fromHistory = false} = {}) {
  if (!openId) return;
  if (busy) await busy;
  if (!openId) return;
  if (!fromHistory && pushed && history.state?.bubble) { history.back(); return; }   // popstate finishes the close
  if (!fromHistory && location.hash) history.replaceState(null, '', location.pathname + location.search);
  const id = openId;
  const run = async () => {
    const r = bubble.getBoundingClientRect(), F = {left: r.left, top: r.top, width: r.width, height: r.height};
    const settle = () => { glass(false); bubble.classList.add('moving'); };
    if (reduceQuery.matches) { settle(); await bubble.animate([{opacity: 1}, {opacity: 0}], {duration: 180}).finished; }
    else if (!wideQuery.matches) {
      settle();
      await bubble.animate([{transform: 'none'}, {transform: 'translateY(100%)'}], {duration: 340, easing: 'cubic-bezier(.5,0,.8,.4)'}).finished;
    } else if (liquid() && liquidPanel) {                           // the text fades, the glass merges back into the card
      const fade = {duration: 110, easing: 'ease-in', fill: 'forwards'};
      body.animate([{opacity: 1}, {opacity: 0}], fade);
      await closeBtn.animate([{opacity: 1}, {opacity: 0}], fade).finished;
      const merging = liquidPanel.close(rowPoint(id)); liquidPanel = null;
      bubble.hidden = true;
      await merging;
      closeBtn.getAnimations().forEach(a => a.cancel());
    } else {                                                        // wide, without liquid glass: it fades out
      settle();
      await bubble.animate([{opacity: 1, transform: 'none'}, {opacity: 0, transform: 'translateY(10px)'}], {duration: 220, easing: 'ease-in'}).finished;
    }
    bubble.hidden = true; bubble.classList.remove('moving', 'shadowed');
    body.getAnimations().forEach(a => a.cancel()); closeBtn.style.opacity = '';
    openId = null; pushed = false; markRow(null);
    requestAnimationFrame(() => { if (!openId) history.scrollRestoration = 'auto'; });
    card.querySelector(`[data-item="${id}"] .open`)?.focus({preventScroll: true});
  };
  busy = run(); await busy; busy = null;
}

// ---- wiring -----------------------------------------------------------------------------------------------------
async function init() {
  if (!card || !bubble) return;
  await load();
  card.querySelectorAll('article[data-item] .open').forEach(btn => btn.addEventListener('click', () => {
    const id = btn.closest('article').dataset.item;
    openId === id ? close() : open(id);
  }));
  closeBtn.addEventListener('click', () => close());
  body.addEventListener('scroll', scrolled, {passive: true});
  new ResizeObserver(() => scrolled()).observe(body);               // the bubble resizing or morphing
  $('.gallery-prev').addEventListener('click', () => setPhoto(photo - 1));
  $('.gallery-next').addEventListener('click', () => setPhoto(photo + 1));
  addEventListener('keydown', e => {
    if (!openId) return;
    if (e.key === 'Escape') { e.preventDefault(); close(); }
    else if ((e.key === 'ArrowLeft' || e.key === 'ArrowRight') && !e.target.closest?.('input,textarea')) {
      if (!$('.gallery').hidden) { e.preventDefault(); setPhoto(photo + (e.key === 'ArrowRight' ? 1 : -1)); }
    }
  });
  // a click on empty space closes the bubble (and, while it is open, does nothing else)
  addEventListener('pointerdown', e => {
    if (!openId || bubble.contains(e.target) || e.target.closest?.('main')) return;
    e.stopImmediatePropagation();
    close();
  }, {capture: true});
  addEventListener('popstate', e => {
    const id = e.state?.bubble ?? location.hash.slice(1);           // typed or linked #id carries no state
    if (id && items[id]) { pushed = true; open(id, {history: false}); }
    else close({fromHistory: true});
  });
  addEventListener('resize', () => { if (openId && !busy) { glass(false); const F = finalRect(); Object.assign(bubble.style, px(F)); liquidPanel?.place(F); glass(true); } });
  wideQuery.addEventListener('change', () => { if (openId) { glass(false); Object.assign(bubble.style, px(finalRect())); glass(true); } });
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
