// Simon95: window manager for the pink desktop. Windows can be focused, dragged by their title bars, minimised,
// maximised, closed and reopened from desktop icons, the start menu or the taskbar. Plus a clock, a hit counter
// (your own visits, kept in your browser) and a sparkle trail.
(() => {
  const desk = document.getElementById('desktop');
  const wins = [...document.querySelectorAll('.win')];
  const tasks = document.querySelector('.tasks');
  const start = document.querySelector('.start'), menu = document.querySelector('.startmenu');
  const floating = matchMedia('(min-width: 900px)');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  let z = 10;

  // ---- taskbar buttons, one per window ----
  const taskOf = new Map();
  for (const w of wins) {
    const b = document.createElement('button');
    b.className = 'task';
    b.textContent = w.querySelector('h2').textContent;
    b.addEventListener('click', () => {
      if (w.hidden || !w.classList.contains('active')) open(w); else minimise(w);
    });
    taskOf.set(w, b);
  }
  function syncTasks() {
    tasks.replaceChildren(...wins.filter(w => !w.hidden || w.dataset.min).map(w => taskOf.get(w)));
    for (const [w, b] of taskOf) b.classList.toggle('on', w.classList.contains('active') && !w.hidden);
  }

  // ---- focus, open, close, minimise, maximise ----
  function focus(w) {
    for (const o of wins) o.classList.remove('active');
    w.classList.add('active');
    w.style.zIndex = ++z;
    syncTasks();
  }
  function open(w) {
    w.hidden = false; delete w.dataset.min;
    focus(w);
    if (!floating.matches) w.scrollIntoView({behavior: reduce ? 'auto' : 'smooth', block: 'start'});
  }
  function close(w) { w.hidden = true; delete w.dataset.min; w.classList.remove('active'); syncTasks(); }
  function minimise(w) { w.hidden = true; w.dataset.min = '1'; w.classList.remove('active'); syncTasks(); }
  function maximise(w) {
    if (!floating.matches) return;
    if (w.dataset.restore) {
      Object.assign(w.style, JSON.parse(w.dataset.restore)); delete w.dataset.restore;
    } else {
      w.dataset.restore = JSON.stringify({left: w.style.left, top: w.style.top, width: w.style.width, height: w.style.height});
      Object.assign(w.style, {left: '0px', top: '0px', width: desk.clientWidth + 'px', height: desk.clientHeight + 'px'});
    }
    focus(w);
  }
  for (const w of wins) {
    w.addEventListener('pointerdown', () => focus(w));
    w.addEventListener('focusin', () => { if (!w.classList.contains('active')) focus(w); });
    w.querySelectorAll('[data-act]').forEach(b => b.addEventListener('click', e => {
      e.stopPropagation();
      ({close, min: minimise, max: maximise})[b.dataset.act](w);
    }));
    w.querySelector('.titlebar').addEventListener('dblclick', () => maximise(w));
  }
  document.querySelectorAll('[data-open]').forEach(b => b.addEventListener('click', () => {
    const w = document.getElementById(b.dataset.open);
    open(w); toggleMenu(false);
    if (b.classList.contains('icon')) { document.querySelectorAll('.icon').forEach(i => i.classList.remove('sel')); b.classList.add('sel'); }
  }));

  // ---- placement: windows start cascaded across the desktop, sized to fit ----
  function place() {
    if (!floating.matches) { for (const w of wins) w.removeAttribute('style'); return; }
    const W = desk.clientWidth, H = desk.clientHeight, left0 = 110;
    for (const w of wins) {
      if (w.dataset.restore) continue;
      const [fx, fy] = (w.dataset.pos || '0.1,0.1').split(',').map(Number);
      const width = Math.min(+w.dataset.w || 480, W - left0 - 20);
      w.style.width = width + 'px';
      w.style.height = w.dataset.h ? Math.round(H * w.dataset.h) + 'px' : '';
      w.style.left = Math.round(Math.min(Math.max(left0, left0 + fx * (W - left0)), W - width - 10)) + 'px';
      w.style.top = Math.round(Math.min(fy * H, H - 160)) + 'px';
    }
    // keep the about window from running off the bottom on short screens
    const a = document.getElementById('about');
    a.style.maxHeight = (H - parseInt(a.style.top) - 12) + 'px';
  }

  // ---- dragging by the title bar ----
  for (const w of wins) {
    const bar = w.querySelector('.titlebar');
    bar.addEventListener('pointerdown', e => {
      if (!floating.matches || e.target.closest('button') || w.dataset.restore) return;
      const sx = e.clientX, sy = e.clientY, x0 = w.offsetLeft, y0 = w.offsetTop;
      bar.setPointerCapture(e.pointerId);
      const move = ev => {
        const x = Math.min(Math.max(x0 + ev.clientX - sx, 60 - w.offsetWidth), desk.clientWidth - 60);
        const y = Math.min(Math.max(y0 + ev.clientY - sy, 0), desk.clientHeight - 30);
        w.style.left = x + 'px'; w.style.top = y + 'px';
      };
      const up = () => { bar.removeEventListener('pointermove', move); bar.removeEventListener('pointerup', up); };
      bar.addEventListener('pointermove', move);
      bar.addEventListener('pointerup', up);
    });
  }

  // ---- start menu ----
  function toggleMenu(show = menu.hidden) {
    menu.hidden = !show;
    start.setAttribute('aria-expanded', String(show));
    if (show) menu.querySelector('button, a').focus();
  }
  start.addEventListener('click', e => { e.stopPropagation(); toggleMenu(); });
  addEventListener('click', e => { if (!menu.hidden && !menu.contains(e.target)) toggleMenu(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && !menu.hidden) { toggleMenu(false); start.focus(); } });

  // ---- clock and hit counter ----
  const clock = document.getElementById('clock');
  const tick = () => { clock.textContent = new Date().toLocaleTimeString([], {hour: 'numeric', minute: '2-digit'}); };
  tick(); setInterval(tick, 15000);
  try {
    const n = (+localStorage.getItem('simon95-visits') || 0) + 1;
    localStorage.setItem('simon95-visits', n);
    document.getElementById('hits').textContent = String(n).padStart(6, '0');
  } catch { /* storage blocked: keep 000001 */ }

  // ---- sparkle trail (mouse only) ----
  if (!reduce) {
    const GLYPHS = ['✦', '♡', '✧', '⋆'], COLOURS = ['#ff3fa0', '#ffffff', '#b98bff', '#ffe36e'];
    let last = 0;
    addEventListener('pointermove', e => {
      if (e.pointerType !== 'mouse' || e.buttons) return;
      const now = performance.now();
      if (now - last < 45) return;
      last = now;
      const s = document.createElement('span');
      s.className = 'spark'; s.setAttribute('aria-hidden', 'true');
      s.textContent = GLYPHS[(Math.random() * GLYPHS.length) | 0];
      s.style.cssText = `left:${e.clientX}px;top:${e.clientY}px;color:${COLOURS[(Math.random() * COLOURS.length) | 0]};--dx:${Math.random() * 24 - 12}px`;
      document.body.append(s);
      s.addEventListener('animationend', () => s.remove());
    }, {passive: true});
  }

  // ---- wallpaper: the wallpaper icon cycles through the loud ones (remembered in your browser) ----
  const WALLS = ['candy', 'hotdog', 'rave', 'sky'];
  let wall = 0;
  try { wall = Math.max(0, WALLS.indexOf(localStorage.getItem('simon95-wall'))); } catch {}
  const setWall = k => {
    WALLS.forEach(w => desk.classList.remove('wp-' + w));
    desk.classList.add('wp-' + WALLS[k]);
    try { localStorage.setItem('simon95-wall', WALLS[k]); } catch {}
  };
  setWall(wall);
  document.getElementById('wallpaper').addEventListener('click', () => setWall(wall = (wall + 1) % WALLS.length));

  // ---- tip of the day ----
  const TIPS = [
    'Windows can be dragged by their title bars. Double-click a title bar to make it big!',
    'Click 壁紙 on the desktop to change the wallpaper. There are four, each louder than the last.',
    "The robot waves with a shoulder and an elbow joint. Simon's real arm has six joints and one motor.",
    'スタート opens the start menu. Esc closes it.',
    'Closed a window by accident? Its desktop icon opens it again.',
  ];
  let tipN = 0;
  document.getElementById('nexttip').addEventListener('click', () => {
    document.getElementById('tiptext').textContent = TIPS[tipN = (tipN + 1) % TIPS.length];
  });

  floating.addEventListener('change', place);
  addEventListener('resize', place);
  place();
  focus(document.getElementById('about'));
})();
