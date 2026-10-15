// A spinning 3D wireframe of a chibi anime girl, built procedurally from lathes and tubes (no model files), drawn
// in perspective like an old 3D screensaver. Behind the windows, ~30 fps, paused when the tab is hidden; a single
// still pose for reduced motion; not drawn on phones.
(() => {
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const COLORS = ['#ff3fa0', '#38f2ff', '#ffffff', '#ffe600', '#ffe600'];   // body, hair, eyes, bow, floor
  const edges = [];                                            // [x1, y1, z1, x2, y2, z2, colour]
  const line = (a, b, c) => edges.push([a[0], a[1], a[2], b[0], b[1], b[2], c]);

  // ---- geometry helpers ----
  const add = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
  const mul = (a, k) => [a[0] * k, a[1] * k, a[2] * k];
  const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
  const norm = a => { const l = Math.hypot(...a) || 1; return mul(a, 1 / l); };

  // a surface of revolution around a vertical axis through (cx, cz); profile = [[radius, y], ...]
  function lathe(profile, n, c, cx = 0, cz = 0, sx = 1, sz = 1) {
    const rings = profile.map(([r, y]) => Array.from({length: n}, (_, k) => {
      const a = k / n * Math.PI * 2;
      return [cx + Math.cos(a) * r * sx, y, cz + Math.sin(a) * r * sz];
    }));
    rings.forEach((ring, i) => ring.forEach((p, k) => {
      if (profile[i][0] > 0.001) line(p, ring[(k + 1) % n], c);
      if (i) line(rings[i - 1][k], p, c);
    }));
  }
  // a tube along a spine, radius per spine point
  function tube(spine, radii, n, c) {
    const rings = spine.map((p, i) => {
      const d = norm(i < spine.length - 1 ? add(spine[i + 1], mul(p, -1)) : add(p, mul(spine[i - 1], -1)));
      let a = cross(d, [0, 0, 1]); if (Math.hypot(...a) < .1) a = cross(d, [1, 0, 0]);
      a = norm(a); const b = norm(cross(d, a));
      return Array.from({length: n}, (_, k) => {
        const t = k / n * Math.PI * 2;
        return add(p, add(mul(a, Math.cos(t) * radii[i]), mul(b, Math.sin(t) * radii[i])));
      });
    });
    rings.forEach((ring, i) => ring.forEach((p, k) => {
      line(p, ring[(k + 1) % n], c);
      if (i) line(rings[i - 1][k], p, c);
    }));
  }
  // a flat ellipse facing +z
  function ellipse(cx, cy, z, rx, ry, n, c) {
    const pts = Array.from({length: n}, (_, k) => { const a = k / n * Math.PI * 2; return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry, z]; });
    pts.forEach((p, k) => line(p, pts[(k + 1) % n], c));
  }

  // ---- the girl (units: about 5 tall, feet at y = -2) ----
  const HY = 2.55, HR = 1.05;                                   // head centre height and radius
  lathe(Array.from({length: 9}, (_, i) => { const a = -Math.PI / 2 + i / 8 * Math.PI; return [Math.cos(a) * HR, HY + Math.sin(a) * HR * .95]; }), 14, 0);
  // hair cap: a slightly larger shell over the top and back
  lathe(Array.from({length: 6}, (_, i) => { const a = .05 + i / 5 * (Math.PI / 2 - .05); return [Math.cos(a) * HR * 1.12, HY + .1 + Math.sin(a) * HR * 1.08]; }), 14, 1, 0, -.05);
  // bangs: spikes over the forehead
  for (let k = -3; k <= 3; k++) {
    const a = k * .2, top = [Math.sin(a) * HR * .9, HY + .95, Math.cos(a) * HR * .55];
    const tip = [Math.sin(a) * HR * 1.02 + k * .03, HY + .25 + (k % 2 ? .12 : 0), Math.cos(a) * HR * 1.0];
    const side = [Math.sin(a + .14) * HR * 1.02, HY + .55, Math.cos(a + .14) * HR * .98];
    line(top, tip, 1); line(tip, side, 1); line(side, top, 1);
  }
  // twin tails curling down from the sides
  for (const s of [-1, 1]) {
    const spine = Array.from({length: 9}, (_, i) => {
      const t = i / 8;
      return [s * (1.05 + Math.sin(t * Math.PI) * .7), HY + .55 - t * 3.1, -.25 - Math.sin(t * Math.PI) * .25];
    });
    tube(spine, spine.map((_, i) => .32 * Math.sin((i + .6) / 9 * Math.PI) + .04), 7, 1);
    // hair tie
    ellipse(s * 1.08, HY + .52, -.2, .14, .14, 8, 3);
  }
  // ahoge: one silly strand on top
  tube(Array.from({length: 6}, (_, i) => { const t = i / 5; return [Math.sin(t * 3) * .25, HY + HR + t * .7, -.1 + Math.cos(t * 3) * .1]; }), [.06, .05, .045, .035, .025, .01], 4, 1);
  // bow on the side of the head
  const B = [.62, HY + .92, .55];
  for (const s of [-1, 1]) { const a = add(B, [s * .45, .22, -.05]), b = add(B, [s * .45, -.22, -.05]); line(B, a, 3); line(a, b, 3); line(b, B, 3); }
  // big anime eyes, with highlights; a little mouth; blush
  for (const s of [-1, 1]) {
    ellipse(s * .38, HY - .05, HR * .93, .2, .3, 12, 2);
    ellipse(s * .38, HY - .1, HR * .95, .09, .14, 8, 2);
    ellipse(s * .32, HY + .08, HR * .96, .04, .04, 5, 3);
    line([s * .2, HY + .32, HR * .9], [s * .55, HY + .38, HR * .84], 1);          // eyebrow-ish lash line
    line([s * .55, HY - .38, HR * .82], [s * .7, HY - .38, HR * .75], 0);         // blush
  }
  line([-.08, HY - .52, HR * .86], [0, HY - .56, HR * .87], 0); line([0, HY - .56, HR * .87], [.08, HY - .52, HR * .86], 0);
  // neck, torso and a flared skirt
  lathe([[.18, 1.5], [.18, 1.25]], 8, 0);
  lathe([[.45, 1.25], [.42, .85], [.36, .45]], 12, 0);
  lathe([[.4, .45], [.75, .0], [1.1, -.45]], 16, 0);
  // arms
  for (const s of [-1, 1]) tube([[s * .45, 1.15, 0], [s * .7, .6, .1], [s * .8, .05, .15]], [.12, .11, .1], 6, 0);
  // legs and shoes
  for (const s of [-1, 1]) {
    tube([[s * .28, -.4, 0], [s * .3, -1.2, 0], [s * .3, -1.85, 0]], [.13, .11, .1], 6, 0);
    lathe([[.0, -1.85], [.16, -1.9], [.17, -2.0]], 8, 3, s * .3, .06, 1, 1.4);
  }
  // the floor: a grid disc she stands on
  for (let r = 1; r <= 3; r++) {
    const pts = Array.from({length: 24}, (_, k) => { const a = k / 24 * Math.PI * 2; return [Math.cos(a) * r * .8, -2.05, Math.sin(a) * r * .8]; });
    pts.forEach((p, k) => line(p, pts[(k + 1) % 24], 4));
  }
  for (let k = 0; k < 12; k++) { const a = k / 12 * Math.PI * 2; line([Math.cos(a) * .8, -2.05, Math.sin(a) * .8], [Math.cos(a) * 2.4, -2.05, Math.sin(a) * 2.4], 4); }

  // a projector for a pose at time t into a W×H box
  function projector(t, W, H, spin = .7) {
    const ay = t * spin, ax = -.18 + Math.sin(t * .5) * .06;
    const cy = Math.cos(ay), sy = Math.sin(ay), cx = Math.cos(ax), sx = Math.sin(ax);
    const S = H / 6.6, D = 9, oy = H * .5 + Math.sin(t * 1.6) * H * .012;      // she bobs gently
    return (x, y, z) => {
      const x1 = x * cy + z * sy, z1 = -x * sy + z * cy;
      const y1 = (y - .4) * cx - z1 * sx, z2 = (y - .4) * sx + z1 * cx;
      const k = D / (D - z2);
      return [W / 2 + x1 * S * k, oy - y1 * S * k, z2];
    };
  }
  // shared with the media player (badapple.js): her silhouette, as one thick-stroked path, without the floor
  window.Simon95Girl = {
    silhouette(t, W, H, spin) {
      const P = projector(t, W, H, spin), path = new Path2D();
      for (const e of edges) {
        if (e[6] === 4) continue;
        const a = P(e[0], e[1], e[2]), b = P(e[3], e[4], e[5]);
        path.moveTo(a[0], a[1]); path.lineTo(b[0], b[1]);
      }
      return path;
    },
  };

  const cv = document.querySelector('canvas.girl');
  if (!cv || !matchMedia('(min-width: 900px)').matches) return;
  const ctx = cv.getContext('2d');

  // ---- render ----
  let W, H, dpr;
  function size() {
    const r = cv.getBoundingClientRect(); dpr = Math.min(2, devicePixelRatio || 1);
    W = r.width; H = r.height; cv.width = W * dpr; cv.height = H * dpr;
  }
  const LEVELS = 4;
  function draw(t) {
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const P = projector(t, W, H);
    const paths = Array.from({length: COLORS.length * LEVELS}, () => new Path2D());
    for (const e of edges) {
      const a = P(e[0], e[1], e[2]), b = P(e[3], e[4], e[5]);
      const depth = Math.min(LEVELS - 1, Math.max(0, Math.floor(((a[2] + b[2]) / 2 + 2.6) / 5.2 * LEVELS)));
      const p = paths[e[6] * LEVELS + depth];
      p.moveTo(a[0], a[1]); p.lineTo(b[0], b[1]);
    }
    ctx.lineCap = 'round';
    for (let c = 0; c < COLORS.length; c++) for (let d = 0; d < LEVELS; d++) {
      const p = paths[c * LEVELS + d], a = .25 + .75 * d / (LEVELS - 1);
      ctx.strokeStyle = '#2a0f28';
      ctx.globalAlpha = a * .55; ctx.lineWidth = 4.5; ctx.stroke(p);      // dark underlay: readable on any wallpaper
      ctx.strokeStyle = COLORS[c];
      ctx.globalAlpha = a; ctx.lineWidth = 1.6; ctx.stroke(p);            // the neon line
    }
    ctx.globalAlpha = 1;
  }

  size(); addEventListener('resize', size);
  if (reduce) { draw(.6); return; }
  let last = 0;
  (function tick(now) {
    requestAnimationFrame(tick);
    if (now - last < 33) return;                                          // ~30 fps is plenty for a screensaver
    last = now; draw(now / 1000);
  })(0);
})();
