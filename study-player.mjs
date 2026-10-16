const STUDY_IDS = ['pendulum', 'strandbeest', 'fivebar', 'planar-arm'];
const WIDE_QUERY = '(min-width: 1040px)';

export function createStudyPlayer({ host, video, still, manifest, win = window, doc = document, calm = true }) {
  const studies = STUDY_IDS.map(id => manifest.find(study => study.id === id)).filter(Boolean);
  if (!host || !video || !still || studies.length !== STUDY_IDS.length) return null;

  video.muted = true;
  video.playsInline = true;
  video.classList.add('study-motion');
  still.classList.add('study-still');
  still.setAttribute('aria-hidden', 'true');
  let current = -1;
  let generation = 0;
  const wideQuery = win.matchMedia(WIDE_QUERY);
  let wide = wideQuery.matches;
  const reduceQuery = win.matchMedia('(prefers-reduced-motion: reduce)');
  let reduced = reduceQuery.matches;
  let hidden = doc.hidden;
  let ready = false;
  let wasPlaying = false;
  let activeMediaHandlers = [];

  // Transitions (style.css): the outgoing drawing is copied into a canvas that drains away through a closing iris,
  // while the incoming one opens from the centre. Both are CSS animations on registered custom properties.
  // (Skipped where the environment has no real DOM, e.g. the player's own verification harness.)
  const out = typeof doc.createElement === 'function' ? doc.createElement('canvas') : null;
  if (out && typeof host.append === 'function') {
    out.className = 'study-out';
    out.setAttribute('aria-hidden', 'true');
    host.append(out);
  }
  const restart = (el, cls) => {
    if (!el?.classList?.remove || !el.classList.add) return;
    el.classList.remove(cls); void el.offsetWidth; el.classList.add(cls);
  };
  // once a transition has played out, drop its class so nothing (a re-shown element, a layout change) can replay it
  const finish = (el, cls, name) => {
    if (typeof el?.addEventListener !== 'function') return;
    el.addEventListener('animationend', event => {
      if (event.target === el && event.animationName === name) el.classList.remove(cls);
    });
  };
  finish(host, 'entering', 'study-iris');
  finish(out, 'leaving', 'study-drain');
  const transition = () => {
    if (reduced || !out?.getContext || typeof host.getBoundingClientRect !== 'function') return;
    const shown = !video.hidden && video.readyState >= 2 ? video : (!still.hidden && still.complete && still.naturalWidth ? still : null);
    if (shown) {
      const r = host.getBoundingClientRect(), dpr = Math.min(2, win.devicePixelRatio || 1);
      out.width = Math.round(r.width * dpr); out.height = Math.round(r.height * dpr);
      const ctx = out.getContext('2d');
      ctx.clearRect(0, 0, out.width, out.height);
      try { ctx.drawImage(shown, 0, 0, out.width, out.height); restart(out, 'leaving'); } catch { /* not drawable yet */ }
    }
    restart(host, 'entering');
  };

  const setState = state => {
    host.dataset.studyState = state;
    host.classList.toggle('study-is-playing', state === 'playing');
    host.classList.toggle('study-is-still', state === 'still' || state === 'loading');
  };
  // The swap waits until the new image is decoded: switching src and hiding the video in the same frame showed an
  // empty frame (a flash) while the poster decoded. An ended video keeps showing its last frame meanwhile.
  const showStill = (study, final = false) => {
    const token = generation;
    still.src = final ? study.poster : study.opening;
    const swap = () => { video.hidden = true; still.hidden = false; };
    const later = () => { if (token === generation && video.paused !== false) swap(); };   // not if replayed meanwhile
    if (typeof still.decode === 'function' && !video.hidden) still.decode().then(later, later);
    else swap();
    setState('still');
  };
  // decode the poster ahead (once the video can play), so the hand-over at the end of the clip is instant
  const preload = study => {
    if (typeof Image !== 'function') return;
    const img = new Image(); img.src = study.poster; img.decode?.().catch(() => {});
  };
  const unload = () => {
    generation++;
    ready = false;
    wasPlaying = false;
    for (const [name, handler] of activeMediaHandlers) video.removeEventListener(name, handler);
    activeMediaHandlers = [];
    video.pause();
    video.removeAttribute('src');
    video.preload = 'none';
    video.load();
    video.hidden = true;
  };
  const playSelected = token => {
    if (token !== generation || hidden || !wide || current < 0 || !ready) return;
    const attempt = video.play();
    if (attempt && typeof attempt.catch === 'function') attempt.catch(() => {
      if (token === generation) showStill(studies[current], true);
    });
    video.hidden = false;
    still.hidden = true;
    setState('playing');
    wasPlaying = true;
  };
  // quiet: switch without the swirl (behind the scroll veil, which reveals it with the iris instead)
  const select = (index, {quiet = false} = {}) => {
    if (!wide || !studies[index]) return;
    if (index === current) return;
    if (!quiet) transition();
    current = index;
    const study = studies[index];
    if (reduced) {
      unload();
      showStill(study, true);
      return;
    }
    for (const [name, handler] of activeMediaHandlers) video.removeEventListener(name, handler);
    activeMediaHandlers = [];
    const token = ++generation;
    ready = false;
    wasPlaying = false;
    video.pause();
    video.hidden = true;
    still.hidden = false;
    still.src = study.opening;
    setState('loading');
    const onReady = () => {
      if (token !== generation || current !== index) return;
      ready = true;
      preload(study);                                          // after the video, which needs the bandwidth first
      if (hidden) { wasPlaying = true; showStill(study); return; }
      playSelected(token);
    };
    video.addEventListener('canplay', onReady, { once: true });
    const onError = () => {
      if (token === generation && current === index) showStill(study, true);
    };
    const onEnded = () => {
      if (token === generation && current === index) showStill(study, true);
    };
    activeMediaHandlers = [['error', onError], ['ended', onEnded]];
    for (const [name, handler] of activeMediaHandlers) video.addEventListener(name, handler);
    video.removeAttribute('src');
    video.preload = 'auto';
    video.src = study.video;
    video.load();
  };
  // The scroll veil (option `calm`). A quick scroll used to start a swirl and a video load at every stretch it crossed,
  // piling them up. Now fast scrolling dims the drawings out of the way (.veiled) and nothing switches underneath;
  // once the scroll settles the player switches once, straight to the drawing where it landed, and the layer fades
  // back up as that drawing opens through the iris. A switch asked for while a swirl is still playing is veiled too,
  // so swirls never overlap. Slow scrolling switches with the swirl as before.
  const FAST = .9, SETTLE = 220, SWIRL = 1600;                        // px/ms, ms without scrolling, ms a swirl lasts
  let lastY = win.scrollY, lastT = Date.now(), lastSwitch = -Infinity, veiled = false, settle = 0;
  const target = () => {
    const max = doc.documentElement.scrollHeight - win.innerHeight;
    const raw = (max > 0 ? win.scrollY / max : 0) * studies.length;
    return {raw, index: Math.min(studies.length - 1, Math.floor(raw))};
  };
  const unveil = () => {
    veiled = false;
    const {index} = target();
    const switching = index !== current;
    if (switching) { lastSwitch = Date.now(); select(index, {quiet: true}); }
    host.classList?.remove('veiled');
    if (switching && !reduced) restart(host, 'entering');            // the new drawing opens as the layer fades up
  };
  const veil = () => {
    if (!veiled) { veiled = true; host.classList?.add('veiled'); }
    clearTimeout(settle);
    settle = setTimeout(unveil, SETTLE);
  };
  const pick = () => {
    if (!wide || !studies.length) return;
    const {raw, index} = target();
    const now = Date.now(), speed = Math.abs(win.scrollY - lastY) / Math.max(1, now - lastT);
    lastY = win.scrollY; lastT = now;
    if (veiled) { veil(); return; }                                    // keep it veiled until the scroll settles
    if (current >= 0 && Math.abs(raw - (current + .5)) <= .6) return;
    if (current < 0 || !calm) { lastSwitch = now; select(index); return; }
    if (speed > FAST || now - lastSwitch < SWIRL) { veil(); return; }
    lastSwitch = now; select(index);
  };
  const onScroll = () => pick();
  const onVisibility = () => {
    hidden = doc.hidden;
    if (hidden) {
      wasPlaying = !video.paused && ready;
      video.pause();
      if (current >= 0) setState('paused');
    } else if (wide && current >= 0 && ready && wasPlaying) {
      playSelected(generation);
    } else if (wide && current >= 0 && !ready) {
      showStill(studies[current]);
    }
  };
  const onWidth = event => {
    wide = event.matches;
    if (!wide) {
      clearTimeout(settle); veiled = false; host.classList?.remove('veiled');
      unload();
      current = -1;
      showStill(studies[0], true);
      host.dataset.studyState = 'inactive';
      host.classList.remove('study-is-playing', 'study-is-still');
    } else {
      current = -1;
      pick();
    }
  };
  const onReducedMotion = event => {
    reduced = event.matches;
    if (reduced) {
      if (current >= 0) {
        const study = studies[current];
        unload();
        showStill(study, true);
      }
    } else if (wide && current >= 0) {
      const index = current;
      current = -1;
      select(index);
    }
  };

  win.addEventListener('scroll', onScroll, { passive: true });
  win.addEventListener('resize', onScroll, { passive: true });
  doc.addEventListener('visibilitychange', onVisibility);
  wideQuery.addEventListener('change', onWidth);
  reduceQuery.addEventListener('change', onReducedMotion);
  video.hidden = true;
  still.hidden = false;
  showStill(studies[0], true);
  if (wide) pick();
  else host.dataset.studyState = 'inactive';

  return { pick, select, destroy: () => {
    clearTimeout(settle);
    win.removeEventListener('scroll', onScroll);
    win.removeEventListener('resize', onScroll);
    doc.removeEventListener('visibilitychange', onVisibility);
    reduceQuery.removeEventListener('change', onReducedMotion);
    wideQuery.removeEventListener('change', onWidth);
    for (const [name, handler] of activeMediaHandlers) video.removeEventListener(name, handler);
    activeMediaHandlers = [];
    unload();
  } };
}

if (typeof document !== 'undefined') {
  const host = document.querySelector('.visuals');
  const video = host?.querySelector('video.study-motion');
  const still = host?.querySelector('img.study-still');
  if (host && video && still) {
    fetch(new URL('studies/assets/manifest.json', import.meta.url))
      .then(response => { if (!response.ok) throw new Error('Study manifest unavailable'); return response.json(); })
      .then(manifest => createStudyPlayer({ host, video, still, manifest }))
      .catch(() => { host.dataset.studyState = 'inactive'; });
  }
}
