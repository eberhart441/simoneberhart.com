// bad_apple.avi: a black-and-white shadow animation in the spirit of the "Bad Apple!!" shadow-art PV, made only
// from this site's own shapes (the wireframe girl's silhouette and an apple). No frames, audio or footage from the
// original are used; the window links out to the original song. Scenes loop:
//   0  white: an apple falls, spins and bounces
//   1  black: she turns, a white shadow
//   2  white: she turns the other way, a black shadow, apples raining behind her
//   3  circle wipe: an apple grows until it fills the frame, and the colours swap
(() => {
  const win = document.getElementById('badapple');
  const cv = win && win.querySelector('canvas');
  if (!cv || !window.Simon95Girl) return;
  const ctx = cv.getContext('2d');
  const playBtn = win.querySelector('[data-media="play"]'), pauseBtn = win.querySelector('[data-media="pause"]');
  const stopBtn = win.querySelector('[data-media="stop"]'), thumb = win.querySelector('.seek i'), clock = win.querySelector('.mtime');
  const state = win.querySelector('.mstate');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const SCENES = [6, 8, 8, 2.5], LOOP = SCENES.reduce((a, b) => a + b);
  const B = '#000', Wt = '#fff';
  let W = 0, H = 0, dpr = 1, t = 0, playing = !reduce, last = 0;

  function size() {
    const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
    if (!r.width) return;
    W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr;
  }

  // an apple silhouette: two lobes, a stem and a leaf
  function apple(x, y, r, rot, ink) {
    ctx.save(); ctx.translate(x, y); ctx.rotate(rot); ctx.fillStyle = ink; ctx.strokeStyle = ink;
    ctx.beginPath();
    ctx.moveTo(0, -r * .62);
    ctx.bezierCurveTo(r * .55, -r * 1.05, r * 1.25, -r * .35, r * .82, r * .45);
    ctx.bezierCurveTo(r * .55, r * 1.05, r * .2, r * 1.0, 0, r * .82);
    ctx.bezierCurveTo(-r * .2, r * 1.0, -r * .55, r * 1.05, -r * .82, r * .45);
    ctx.bezierCurveTo(-r * 1.25, -r * .35, -r * .55, -r * 1.05, 0, -r * .62);
    ctx.fill();
    ctx.lineWidth = r * .1; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(0, -r * .6); ctx.quadraticCurveTo(r * .05, -r * .95, r * .2, -r * 1.15); ctx.stroke();
    ctx.beginPath(); ctx.ellipse(r * .42, -r * .95, r * .32, r * .14, -.5, 0, Math.PI * 2); ctx.fill();
    ctx.restore();
  }
  function girl(time, ink, spin) {
    const path = Simon95Girl.silhouette(time, W, H * .95, spin);
    ctx.save(); ctx.translate(0, H * .03);
    ctx.strokeStyle = ink; ctx.lineWidth = Math.max(5, H * .05); ctx.lineJoin = ctx.lineCap = 'round';
    ctx.stroke(path); ctx.restore();
  }

  function frame() {
    if (!W) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    let s = 0, u = t % LOOP;
    while (u > SCENES[s]) u -= SCENES[s++];
    const k = u / SCENES[s];
    if (s === 0) {                                   // a falling, bouncing apple on white
      ctx.fillStyle = Wt; ctx.fillRect(0, 0, W, H);
      const fall = Math.min(1, k * 1.6), y = H * (-.2 + .75 * fall * fall) - Math.abs(Math.sin(Math.max(0, k - .62) * 14)) * H * .12 * (1 - k);
      apple(W / 2, y, H * .2, k * 6, B);
    } else if (s === 1) {                            // she turns: a white shadow on black
      ctx.fillStyle = B; ctx.fillRect(0, 0, W, H);
      girl(u + 1, Wt, .9);
    } else if (s === 2) {                            // the other way: black on white, apples falling behind
      ctx.fillStyle = Wt; ctx.fillRect(0, 0, W, H);
      for (let i = 0; i < 7; i++) {
        const x = ((i * 53) % 100) / 100 * W, y = ((u * (.25 + i * .04) + i * .17) % 1.3 - .15) * H;
        apple(x, y, H * (.04 + (i % 3) * .015), u * (1 + i * .3), B);
      }
      girl(-u - 1, B, .9);
    } else {                                         // an apple swells to fill the frame
      ctx.fillStyle = B; ctx.fillRect(0, 0, W, H);
      apple(W / 2, H / 2, H * (.2 + k * k * 2.2), k * 2, Wt);
    }
    thumb.style.left = (t % LOOP) / LOOP * 100 + '%';
    const sec = Math.floor(t % LOOP);
    clock.textContent = `00:${String(sec).padStart(2, '0')} / 00:${String(Math.ceil(LOOP)).padStart(2, '0')}`;
  }

  function setPlaying(p) {
    playing = p;
    state.textContent = p ? '再生中 Playing' : t ? '一時停止 Paused' : '停止 Stopped';
    playBtn.setAttribute('aria-pressed', String(p)); pauseBtn.setAttribute('aria-pressed', String(!p && t > 0));
  }
  playBtn.addEventListener('click', () => setPlaying(true));
  pauseBtn.addEventListener('click', () => setPlaying(false));
  stopBtn.addEventListener('click', () => { t = 0; setPlaying(false); frame(); });

  new ResizeObserver(() => { size(); frame(); }).observe(cv);
  size(); setPlaying(playing); t = reduce ? 9 : 0; frame();
  (function tick(now) {
    requestAnimationFrame(tick);
    const dt = Math.min(.1, (now - (last || now)) / 1000); last = now;
    if (!playing || win.hidden) return;                // nothing runs while paused, minimised or closed
    t += dt; frame();
  })(0);
})();
