// The existing drawing-player behaviour check (ported from studies/verify-site-player.mjs): runs study-player.mjs against fake DOM objects.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';

export default async function ({root}) {
const { createStudyPlayer } = await import(pathToFileURL(path.join(root, 'study-player.mjs')).href);
const manifest = JSON.parse(await readFile(path.join(root, 'studies/assets/manifest.json'), 'utf8'));
const media = new Map();
function fakeElement() {
  const events = new Map();
  return {
    hidden: false, dataset: {}, classList: {
      values: new Set(), add(value) { this.values.add(value); }, remove(...values) { values.forEach(v => this.values.delete(v)); },
      toggle(value, on) { on ? this.values.add(value) : this.values.delete(value); },
    }, attrs: {}, listeners: events,
    addEventListener(name, fn, options) { const list = events.get(name) || []; list.push({ fn, once: options?.once }); events.set(name, list); },
    removeEventListener(name, fn) { events.set(name, (events.get(name) || []).filter(e => e.fn !== fn)); },
    dispatch(name) { for (const item of [...(events.get(name) || [])]) { item.fn(); if (item.once) events.set(name, events.get(name).filter(e => e !== item)); } },
    setAttribute(name, value) { this.attrs[name] = value; }, removeAttribute(name) { delete this.attrs[name]; if (name === 'src') this.src = ''; },
    pause() { this.paused = true; }, load() { this.loads = (this.loads || 0) + 1; },
    play() { this.paused = false; this.plays = (this.plays || 0) + 1; return Promise.resolve(); },
    closest(selector) { return this.parents?.includes(selector) ? {} : null; },
  };
}
function setup({ isWide = true, reduced = false, calm = false } = {}) {
  const host = fakeElement(), video = fakeElement(), still = fakeElement();
  video.paused = true; video.currentTime = 0;
  const listeners = new Map();
  const win = {
    innerHeight: 1000, scrollY: 0,
    matchMedia(query) {
      if (!media.has(query)) media.set(query, { matches: query.includes('1040') ? isWide : reduced, addEventListener(name, fn) { this.listener = fn; } });
      return media.get(query);
    },
    addEventListener(name, fn) { listeners.set(name, fn); }, removeEventListener(name) { listeners.delete(name); },
  };
  const doc = { hidden: false, documentElement: { scrollHeight: 4000 }, listeners: new Map(),
    addEventListener(name, fn) { this.listeners.set(name, fn); }, removeEventListener(name) { this.listeners.delete(name); } };
  const player = createStudyPlayer({ host, video, still, manifest, win, doc, calm });
  return { host, video, still, win, doc, player, listeners };
}

// Initial state and scene ordering. The picker switches scene only after a margin (hysteresis), so the video does not flicker at a boundary.
media.clear();
{
  const { host, video, still, win, listeners } = setup();
  assert.equal(video.src, 'studies/assets/pendulum.webm');
  assert.equal(still.src, 'studies/assets/pendulum-opening.webp');
  assert.equal(host.dataset.studyState, 'loading');
  assert.equal(video.muted, true); assert.equal(video.playsInline, true);
  video.dispatch('canplay');
  assert.equal(video.hidden, false); assert.equal(still.hidden, true);
  assert.equal(host.dataset.studyState, 'playing');
  win.scrollY = 700; listeners.get('scroll')();
  assert.equal(video.src, 'studies/assets/pendulum.webm'); // inside the 0.6 hysteresis band
  win.scrollY = 1000; listeners.get('scroll')();
  assert.equal(video.src, 'studies/assets/strandbeest.webm');
  video.dispatch('canplay');
  assert.equal(host.dataset.studyState, 'playing');
  win.scrollY = 1800; listeners.get('scroll')();
  assert.equal(video.src, 'studies/assets/fivebar.webm');
  win.scrollY = 2600; listeners.get('scroll')();
  assert.equal(video.src, 'studies/assets/planar-arm.webm');
}

// End, rejected playback, and stale readiness all settle on the correct static image.
media.clear();
{
  const { video, still, host, player } = setup();
  const oldReady = video.listeners.get('canplay')[0].fn;
  player.select(1);
  oldReady();
  assert.equal(video.plays || 0, 0);
  video.dispatch('canplay');
  video.dispatch('ended');
  video.dispatch('ended'); // replay must not consume the end handler
  assert.equal(still.src, 'studies/assets/strandbeest-poster.webp');
  assert.equal(video.hidden, true);
  assert.equal(host.dataset.studyState, 'still');
}
media.clear();
{
  const { video, still, host } = setup();
  video.play = () => Promise.reject(new Error('autoplay unavailable'));
  video.dispatch('canplay');
  await Promise.resolve();
  assert.equal(still.src, 'studies/assets/pendulum-poster.webp');
  assert.equal(host.dataset.studyState, 'still');
}

// Backgrounding pauses at the existing time and resuming continues that same stream.
media.clear();
{
  const { video, doc } = setup();
  video.dispatch('canplay');
  video.currentTime = 4.25;
  doc.hidden = true; doc.listeners.get('visibilitychange')();
  assert.equal(video.paused, true);
  doc.hidden = false; doc.listeners.get('visibilitychange')();
  assert.equal(video.currentTime, 4.25);
  assert.equal(video.paused, false);
}
media.clear();
{
  const { video, doc, host } = setup();
  doc.hidden = true; doc.listeners.get('visibilitychange')();
  video.dispatch('canplay');
  assert.equal(host.dataset.studyState, 'still');
  doc.hidden = false; doc.listeners.get('visibilitychange')();
  assert.equal(host.dataset.studyState, 'playing');
  assert.equal(video.paused, false);
}

// Clicks never restart the drawing (the site's clicks are for the glass and the text).
media.clear();
{
  const { video, listeners } = setup();
  video.dispatch('canplay');
  video.currentTime = 7;
  assert.equal(listeners.has('pointerdown'), false);
  assert.equal(video.currentTime, 7);
}
media.clear();
{
  const { video, still } = setup({ reduced: true });
  assert.equal(video.src || '', '');
  assert.equal(still.src, 'studies/assets/pendulum-poster.webp');
}
media.clear();
{
  const { video, still, host } = setup();
  const reduceQuery = media.get('(prefers-reduced-motion: reduce)');
  video.dispatch('canplay');
  reduceQuery.matches = true; reduceQuery.listener({ matches: true });
  assert.equal(video.src, '');
  assert.equal(video.paused, true);
  assert.equal(still.src, 'studies/assets/pendulum-poster.webp');
  assert.equal(host.dataset.studyState, 'still');
  reduceQuery.matches = false; reduceQuery.listener({ matches: false });
  assert.equal(video.src, 'studies/assets/pendulum.webm');
  video.dispatch('canplay');
  assert.equal(host.dataset.studyState, 'playing');
}
media.clear();
{
  const { video, still, player, host } = setup();
  let rejectOld;
  video.play = () => new Promise((_, reject) => { rejectOld = reject; });
  video.dispatch('canplay');
  player.select(1);
  rejectOld(new Error('stale playback rejection'));
  await Promise.resolve();
  assert.equal(host.dataset.studyState, 'loading');
  assert.equal(still.src, 'studies/assets/strandbeest-opening.webp');
}

// Narrow layouts never retain a video source; returning wide chooses the current scroll segment.
media.clear();
{
  const { video, still, win, host } = setup();
  const query = media.get('(min-width: 1040px)');
  query.matches = false; query.listener({ matches: false });
  assert.equal(video.src, '');
  assert.equal(host.dataset.studyState, 'inactive');
  assert.equal(still.hidden, false);
  win.scrollY = 2600;
  query.matches = true; query.listener({ matches: true });
  assert.equal(video.src, 'studies/assets/planar-arm.webm');
}

// Fast scrolling veils the drawings (nothing switches underneath), then switches once, straight to where it lands.
media.clear();
{
  const { video, host, win, listeners } = setup({ calm: true });
  video.dispatch('canplay');
  const loads = video.loads;
  for (const y of [400, 900, 1500, 2100, 2600]) { win.scrollY = y; listeners.get('scroll')(); }   // one burst, no time between
  assert.ok(host.classList.values.has('veiled'));
  assert.equal(video.src, 'studies/assets/pendulum.webm');
  assert.equal(video.loads, loads);
  await new Promise(resolve => setTimeout(resolve, 400));
  assert.ok(!host.classList.values.has('veiled'));
  assert.equal(video.src, 'studies/assets/planar-arm.webm');
  assert.equal(video.loads, loads + 1);
}

}
