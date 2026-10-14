// Liquid glass. Every piece of glass on the page — the card, the project panel, the droplets that bud off, the
// cursor — is one material: shapes whose outlines are blended into a single smooth surface (a smooth minimum of
// signed distances), so pieces that come close neck together and merge, and a piece pulling away stretches its neck
// thin and pinches off. Nothing is hand-animated: bodies move on springs toward targets; merging, budding and
// splitting fall out of the material.
//
// Optically it is the card's glass from before: Hyalite's refraction profile (Snell's law through a squircle bevel,
// with the card's thickness, bevel, slope, shade and rim) computed into a small table the shader reads by depth;
// the same 6px frost applied before the bend; the card's tint, rim lines and drop shadow.
//
// A transparent WebGL2 canvas sits between the drawings and the text. It draws only glass (and shadows); everywhere
// else the page shows through, so the drawing player, its transitions and the text are untouched. Under the glass
// it reads the same video or still the player is showing. Text, links and the panel's content stay HTML.
//
// On only for wide screens with WebGL2 and without a reduced-transparency preference; otherwise the site keeps its
// CSS/Hyalite glass (frame.js, bubble.mjs). Performance: nothing redraws unless something moved or the drawing
// changed; the canvas is capped at 1.5× resolution; the frost (a half-resolution blur) and the drawing upload happen
// at most once per new drawing frame.
//
// API (window.Liquid): active; bud(point, rect) → Promise<handle> once the panel has inflated; handle.place(rect);
// handle.close(point) → Promise once it has merged back into the card.

const wideQuery = matchMedia('(min-width: 1040px)');
const reduceMotion = matchMedia('(prefers-reduced-motion: reduce)');
const reduceTransparency = matchMedia('(prefers-reduced-transparency: reduce)');
const finePointer = matchMedia('(hover: hover) and (pointer: fine)');
const root = document.documentElement;
const cardEl = document.querySelector('main');
const visuals = document.querySelector('.visuals');

// the card's glass (frame.js GLASS, with the Hyalite defaults it relies on)
const P = {bevel: 40, thickness: 70, slope: 2.7, blur: 6, shade: .368, rim: 1.2, edgeW: 8, edge: .36, light: -140, smooth: 34};
const MAX = 12;

const Liquid = window.Liquid = {active: false, bud: null, debug: () => [...bodies].map(b => ({...b.c, frost: b.frost, id: b.id}))};

// ---- Hyalite's refraction profile, as a table by depth from the rim (px) --------------------------------------------
const N_GLASS = 1.5, ABSORB = .5 / .46, GLOW = .4 / 1.76, SHARP = 44, STEP = .25;
const Hc = t => Math.sqrt(Math.max(0, 1 - (1 - t) * (1 - t)));
const Hs = t => Math.pow(Math.max(0, 1 - Math.pow(1 - t, 4)), .25);
const fresnel = a => {
  a = Math.abs(a); const st = Math.sin(a) / N_GLASS;
  if (st >= 1) return 1; if (a < 1e-4) return .04;
  const b = Math.asin(st), rs = Math.sin(a - b) / Math.sin(a + b), rp = Math.tan(a - b) / Math.tan(a + b);
  return Math.min(1, (rs * rs + rp * rp) / 2);
};
function profileTable() {
  const B = P.bevel, T0 = P.thickness, N = Math.ceil(B / STEP);
  const prof = d => {
    const x = Math.min(1, Math.max(0, d / B)), e = 1e-3, x1 = Math.min(1, x + e), x0 = Math.max(0, x - e);
    const alpha = Math.atan((Hs(x1) - Hs(x0)) / (x1 - x0));
    const beta = Math.sign(alpha) * Math.asin(Math.min(1, Math.sin(Math.abs(alpha)) / N_GLASS));
    return {disp: (T0 + B * Hc(x)) * Math.tan(alpha - beta), alpha};
  };
  const tab = new Float32Array(N + 1);
  for (let i = N - 1; i >= 0; i--) tab[i] = Math.min(prof(i * STEP).disp, tab[i + 1] + P.slope * STEP);
  const data = new Float32Array((N + 1) * 2);
  for (let i = 0; i <= N; i++) {
    const d = i * STEP, p = prof(d);
    const gain = Math.max(.02, 1 + (tab[Math.min(N, i + 1)] - tab[i]) / STEP), gainS = Math.pow(gain, 1 / 2.2);
    const win = Math.exp(-2.5 * d / P.edgeW), t = Math.max(0, Math.sin(p.alpha));
    data[i * 2] = tab[i];
    data[i * 2 + 1] = ((fresnel(p.alpha) * P.rim * GLOW + Math.pow(t, SHARP) * P.rim) - ((1 - gainS) * P.shade + fresnel(p.alpha) * P.shade * ABSORB)) * win;
  }
  return {data, n: N + 1, depth: N * STEP};
}

// ---- shaders ------------------------------------------------------------------------------------------------------
const VERT = `#version 300 es
in vec2 a; void main() { gl_Position = vec4(a, 0., 1.); }`;
const COMMON = `#version 300 es
precision highp float;
uniform sampler2D uPaper, uInk;
uniform vec2 uView;        // css px
uniform vec4 uInkRect;     // css px: x, y, w, h
uniform float uInkAlpha;   // the drawing layer's opacity (the scroll veil)
uniform vec2 uRes;         // target pixels
vec2 cssAt(vec2 fc) { return vec2(fc.x, uRes.y - fc.y) / uRes * uView; }
vec3 sceneAt(vec2 p) {
  vec3 c = vec3(.9647, .9608, .9451);                                  // --paper
  vec4 grain = texture(uPaper, p / 256.);
  c = mix(c, grain.rgb, grain.a);
  vec2 q = (p - uInkRect.xy) / uInkRect.zw;
  if (q.x >= 0. && q.y >= 0. && q.x <= 1. && q.y <= 1.) { vec4 ink = texture(uInk, q); c = mix(c, ink.rgb, ink.a * uInkAlpha); }
  return c;
}
out vec4 o;
`;
const SCENE = COMMON + `void main() { o = vec4(sceneAt(cssAt(gl_FragCoord.xy)), 1.); }`;
const BLUR = `#version 300 es
precision highp float;
uniform sampler2D uSrc; uniform vec2 uStep; out vec4 o;
void main() {                                                          // 9-tap gaussian in 5 linear fetches
  vec2 uv = gl_FragCoord.xy / vec2(textureSize(uSrc, 0));
  vec3 c = texture(uSrc, uv).rgb * .227027;
  c += (texture(uSrc, uv + uStep * 1.384615).rgb + texture(uSrc, uv - uStep * 1.384615).rgb) * .316216;
  c += (texture(uSrc, uv + uStep * 3.230769).rgb + texture(uSrc, uv - uStep * 3.230769).rgb) * .070270;
  o = vec4(c, 1.);
}`;
const GLASS = COMMON + `
uniform sampler2D uBlur, uProf;
uniform vec4 uB[${MAX}];   // body: centre x, y, half width, half height (css px)
uniform vec4 uBp[${MAX}];  // body: corner radius, frost 0..1, -, -
uniform int uN;
uniform float uK, uBevel, uProfN, uProfDepth, uEdge;
uniform vec2 uLight;       // towards the light, screen space (y down)
uniform vec3 uBump;        // the cursor's swell inside the glass: x, y, amount
uniform vec2 uTintY;       // the card's top and height, for its tint gradient
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
// widen: 0 = the outline; uBevel = a rounder twin used only for the bend direction (no creases at corners)
float field(vec2 p, float widen) {
  float d = 1e5;
  for (int i = 0; i < ${MAX}; i++) { if (i >= uN) break;
    vec4 b = uB[i]; d = smin(d, sdBox(p - b.xy, b.zw, min(uBp[i].x + widen, min(b.z, b.w))), uK); }
  return d;
}
void bodyMix(vec2 p, out float frost, out float bevel) {               // frosted bodies stay frosted where they merge
  float ws = 0., wf = 0., wb = 0.;
  for (int i = 0; i < ${MAX}; i++) { if (i >= uN) break;
    vec4 b = uB[i]; float w = exp(-max(sdBox(p - b.xy, b.zw, min(uBp[i].x, min(b.z, b.w))), 0.) * .05);
    ws += w; wf += w * uBp[i].y; wb += w * min(uBevel, min(b.z, b.w) - 1.); }
  frost = wf / max(ws, 1e-4); bevel = max(1., wb / max(ws, 1e-4));
}
vec2 prof(float s) { return texture(uProf, vec2((clamp(s, 0., uProfDepth) / uProfDepth * (uProfN - 1.) + .5) / uProfN, .5)).rg; }
void main() {
  vec2 p = cssAt(gl_FragCoord.xy);
  float d = field(p, 0.);
  if (d > .8) {                                                        // outside: only the drop shadow (0 12px 36px -20px)
    float a = 0.;
    if (d < 90.) a = .07 * (1. - smoothstep(-36., 36., field(p - vec2(0., 12.), 0.) + 20.));
    o = vec4(vec3(.118, .098, .059) * a, a); return;
  }
  float frost, bevel; bodyMix(p, frost, bevel);
  float s = max(-d, 0.);
  float sProf = s * uBevel / bevel;                                    // small drops use the whole profile across their radius
  vec2 g = vec2(field(p + vec2(1., 0.), uBevel) - field(p - vec2(1., 0.), uBevel), field(p + vec2(0., 1.), uBevel) - field(p - vec2(0., 1.), uBevel));
  g = g / max(length(g), 1e-4);                                        // outward
  vec2 pe = prof(sProf);                                               // r: inward displacement px, g: signed edge light
  vec2 off = -g * pe.r;
  vec2 bd = p - uBump.xy; float bg = exp(-dot(bd, bd) / 1800.); vec2 bgrad = -bd / 900. * bg * uBump.z;
  off += bgrad * 22.;                                                  // the cursor's swell: a soft lens of its own
  vec2 ps = p + off;
  vec3 col = mix(sceneAt(ps), texture(uBlur, vec2(ps.x / uView.x, 1. - ps.y / uView.y)).rgb, frost);
  float ty = clamp((p.y - uTintY.x) / uTintY.y, 0., 1.);               // the card's --glass tint: .30 → .19 → .25
  float tint = ty < .45 ? mix(.30, .19, ty / .45) : mix(.19, .25, (ty - .45) / .55);
  col = mix(col, vec3(1.), tint * mix(.4, 1., frost));
  float e = pe.g, f = dot(g, uLight);                                  // Hyalite's edge light; only the lit half follows the light
  if (e > 0.) e *= max(0., f) * .78 + max(0., -f) * .30;
  col = e > 0. ? mix(col, vec3(1.), min(e, 1.)) : mix(col, vec3(0.), min(-e, 1.));
  col = mix(col, vec3(0.), .16 * uEdge * (1. - smoothstep(1.1, 1.9, s)));   // the card's CSS rim: dark hairline, white line
  col = mix(col, vec3(1.), .72 * uEdge * (1. - smoothstep(.2, .9, s)) + .55 * uEdge * max(0., f) * (1. - smoothstep(.6, 1.6, s)));
  col += uBump.z * .16 * bg * pow(max(dot(normalize(vec3(bgrad * 14., 1.)), normalize(vec3(uLight, .9))), 0.), 40.);
  float a = smoothstep(.8, -.8, d);
  o = vec4(col * a, a);
}`;

// ---- springs ------------------------------------------------------------------------------------------------------
// each body moves its centre, half size and radius toward a target on damped springs (a little under-damped:
// liquid wobbles before it settles)
class Body {
  static n = 0;
  constructor(state, {frost = 0, k = 160, z = .6} = {}) {
    this.id = ++Body.n;
    this.c = {...state}; this.t = {...state}; this.v = {x: 0, y: 0, w: 0, h: 0, r: 0}; this.frost = frost; this.k = k; this.z = z;
  }
  set(state, snap = false) { Object.assign(this.t, state); if (snap) { Object.assign(this.c, this.t); for (const key in this.v) this.v[key] = 0; } }
  step(dt) {
    let moving = false; const c = 2 * this.z * Math.sqrt(this.k);
    for (const key in this.v) {
      const a = this.k * (this.t[key] - this.c[key]) - c * this.v[key];
      this.v[key] += a * dt; this.c[key] += this.v[key] * dt;
      if (Math.abs(this.v[key]) > .02 || Math.abs(this.t[key] - this.c[key]) > .05) moving = true;
    }
    this.c.w = Math.max(0, this.c.w); this.c.h = Math.max(0, this.c.h); this.c.r = Math.max(0, this.c.r);
    return moving;
  }
  settled(tol = 2) { return ['x', 'y', 'w', 'h'].every(k => Math.abs(this.t[k] - this.c[k]) < tol) && Math.abs(this.v.w) < 5; }
}
const rectBody = (r, radius = 22) => ({x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w / 2, h: r.h / 2, r: radius});

// ---- the engine: created once, switched on and off with the conditions --------------------------------------------
let gl = null, canvas = null, E = null;
function create() {
  canvas = document.createElement('canvas');
  canvas.className = 'liquid-canvas'; canvas.setAttribute('aria-hidden', 'true');
  gl = canvas.getContext('webgl2', {antialias: false, alpha: true, premultipliedAlpha: true, depth: false, stencil: false, powerPreference: 'high-performance'});
  if (!gl) return false;
  const program = fs => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VERT], [gl.FRAGMENT_SHADER, fs]]) {
      const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(p, s);
    }
    gl.bindAttribLocation(p, 0, 'a'); gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p));
    const u = {}, n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
    for (let i = 0; i < n; i++) { const name = gl.getActiveUniform(p, i).name.replace(/\[0\]$/, ''); u[name] = gl.getUniformLocation(p, name); }
    return {p, u};
  };
  const texture = (wrap = gl.CLAMP_TO_EDGE) => {
    const t = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array([0, 0, 0, 0]));
    return t;
  };
  const target = () => { const t = texture(); const f = gl.createFramebuffer(); gl.bindFramebuffer(gl.FRAMEBUFFER, f);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, t, 0); return {t, f, w: 1, h: 1}; };
  E = {scene: program(SCENE), blur: program(BLUR), glass: program(GLASS), paper: texture(gl.REPEAT), ink: texture(), prof: texture(),
       a: target(), b: target()};
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  E.PROF = profileTable();
  gl.bindTexture(gl.TEXTURE_2D, E.prof); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RG16F, E.PROF.n, 1, 0, gl.RG, gl.FLOAT, E.PROF.data);
  const paper = new Image(); paper.src = 'paper-texture.png';
  paper.onload = () => { gl.bindTexture(gl.TEXTURE_2D, E.paper); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, paper); sceneDirty = dirty = true; };
  visuals.after(canvas);
  return true;
}

// ---- state --------------------------------------------------------------------------------------------------------
let W = 0, H = 0, DPR = 1, raf = 0, last = 0, dirty = true, sceneDirty = true;
const L = {card: {x: 0, y: 0, w: 0, h: 0}, ink: {x: 0, y: 0, w: 1, h: 1}};
const card = new Body({x: 0, y: 0, w: 0, h: 0, r: 22}, {frost: 1, k: 300, z: 1});
const bodies = new Set([card]);
const cursor = new Body({x: -100, y: -100, w: 0, h: 0, r: 0}, {k: 420, z: .72});
const bump = {x: 0, y: 0, a: 0, ta: 0, v: 0};
let dot = null, pointerAt = null, panelOpen = 0;

function layout() {
  if (!Liquid.active) return;
  W = root.clientWidth; H = innerHeight; DPR = Math.min(1.5, devicePixelRatio || 1);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  for (const b of [E.a, E.b]) {                                         // the frost is computed at half resolution
    b.w = Math.max(1, Math.round(W / 2)); b.h = Math.max(1, Math.round(H / 2));
    gl.bindTexture(gl.TEXTURE_2D, b.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, b.w, b.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  const c = cardEl.getBoundingClientRect(), v = visuals.getBoundingClientRect();
  L.card = {x: c.left, y: c.top, w: c.width, h: c.height};
  L.ink = {x: v.left, y: v.top, w: v.width || 1, h: v.height || 1};
  card.set(rectBody(L.card), true);
  sceneDirty = dirty = true;
}

// ---- the drawing under the glass: whatever the player shows (its video, or its still), at the layer's opacity ------
let inkFresh = true, inkAlpha = 1, inkSrc = '', veilWatch = 0;
const video = visuals.querySelector('.study-motion'), still = visuals.querySelector('.study-still');
const onVideoFrame = () => { inkFresh = true; poke(); video.requestVideoFrameCallback(onVideoFrame); };
if (video?.requestVideoFrameCallback) video.requestVideoFrameCallback(onVideoFrame);
still?.addEventListener('load', () => { inkFresh = true; poke(); });
new MutationObserver(() => { veilWatch = performance.now() + 900; poke(); }).observe(visuals, {attributes: true, attributeFilter: ['class']});
function uploadInk() {
  const showVideo = video && !video.hidden && video.readyState >= 2;
  const src = showVideo ? video : (still?.complete && still.naturalWidth ? still : null);
  const key = showVideo ? 'video' : still?.currentSrc;
  if (!src) return;
  if (!inkFresh && key === inkSrc) return;
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, E.ink);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
  inkFresh = false; inkSrc = key; sceneDirty = true;
}

// ---- render -------------------------------------------------------------------------------------------------------
const Bv = new Float32Array(MAX * 4), Bpv = new Float32Array(MAX * 4);
function common(prog, w, h) {
  gl.useProgram(prog.p);
  gl.uniform2f(prog.u.uView, W, H); gl.uniform2f(prog.u.uRes, w, h); gl.uniform4f(prog.u.uInkRect, L.ink.x, L.ink.y, L.ink.w, L.ink.h);
  gl.uniform1f(prog.u.uInkAlpha, inkAlpha); gl.uniform1i(prog.u.uPaper, 0); gl.uniform1i(prog.u.uInk, 1);
}
function render() {
  gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, E.paper);
  uploadInk();
  gl.activeTexture(gl.TEXTURE1); gl.bindTexture(gl.TEXTURE_2D, E.ink);
  if (sceneDirty) {                                                     // the frost: the background, blurred (6px)
    gl.disable(gl.BLEND);
    common(E.scene, E.a.w, E.a.h);
    gl.bindFramebuffer(gl.FRAMEBUFFER, E.a.f); gl.viewport(0, 0, E.a.w, E.a.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.useProgram(E.blur.p); gl.uniform1i(E.blur.u.uSrc, 2); gl.activeTexture(gl.TEXTURE2);
    const k = P.blur / 2 / 2 * 1.25;                                    // half resolution; the kernel is ~2 steps wide
    for (const [src, dst, step] of [[E.a, E.b, [k, 0]], [E.b, E.a, [0, k]]]) {
      gl.bindTexture(gl.TEXTURE_2D, src.t); gl.bindFramebuffer(gl.FRAMEBUFFER, dst.f); gl.viewport(0, 0, dst.w, dst.h);
      gl.uniform2f(E.blur.u.uStep, step[0] / src.w, step[1] / src.h); gl.drawArrays(gl.TRIANGLES, 0, 3);
    }
    sceneDirty = false;
  }
  gl.activeTexture(gl.TEXTURE2); gl.bindTexture(gl.TEXTURE_2D, E.a.t);
  gl.activeTexture(gl.TEXTURE3); gl.bindTexture(gl.TEXTURE_2D, E.prof);
  common(E.glass, canvas.width, canvas.height);
  const u = E.glass.u; let n = 0;
  for (const b of bodies) {
    if (n >= MAX || b.c.w <= .3 || b.c.h <= .3) continue;
    Bv.set([b.c.x, b.c.y, b.c.w, b.c.h], n * 4); Bpv.set([b.c.r, b.frost, 0, 0], n * 4); n++;
  }
  gl.uniform4fv(u.uB, Bv); gl.uniform4fv(u.uBp, Bpv); gl.uniform1i(u.uN, n);
  gl.uniform1i(u.uBlur, 2); gl.uniform1i(u.uProf, 3);
  gl.uniform1f(u.uK, P.smooth); gl.uniform1f(u.uBevel, P.bevel); gl.uniform1f(u.uEdge, P.edge);
  gl.uniform1f(u.uProfN, E.PROF.n); gl.uniform1f(u.uProfDepth, E.PROF.depth);
  gl.uniform2f(u.uTintY, L.card.y, L.card.h);
  const a = P.light * Math.PI / 180; gl.uniform2f(u.uLight, Math.sin(a), -Math.cos(a));
  gl.uniform3f(u.uBump, bump.x, bump.y, bump.a);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 3);
  if (!canvas.classList.contains('ready')) requestAnimationFrame(() => canvas.classList.add('ready'));   // fade in once drawn
}
function tick(now) {
  raf = 0;
  if (!Liquid.active) return;
  const dt = Math.min(1 / 30, (now - (last || now)) / 1000); last = now;
  ambient(now);
  let moving = false;
  for (const tw of tweens) {                                            // targets that slide along a path
    const t = tw.dur ? Math.min(1, (now - tw.start) / tw.dur) : 1;
    tw.body.set(tw.fn(t)); moving = true;
    if (t >= 1) { tweens.delete(tw); tw.done(); }
  }
  for (const b of bodies) if (b.step(dt)) moving = true;
  const ba = 2 * .8 * Math.sqrt(140); bump.v += (140 * (bump.ta - bump.a) - ba * bump.v) * dt; bump.a += bump.v * dt;
  if (Math.abs(bump.v) > .001 || Math.abs(bump.ta - bump.a) > .002) moving = true;
  if (now < veilWatch) {                                                // the veil fades the drawing layer: follow it
    const o = +getComputedStyle(visuals).opacity;
    if (Math.abs(o - inkAlpha) > .002) { inkAlpha = o; sceneDirty = dirty = true; }
    moving = true;
  }
  if (moving || dirty || inkFresh) { render(); dirty = false; }
  // keep ticking while anything moves (or a drop is out, or the veil is fading); otherwise sleep until poked
  if (moving || drops.length || tweens.size || panelOpen && [...bodies].some(b => b.frost && b !== card && !b.settled(1))) raf = requestAnimationFrame(tick);
  else last = 0;
}
const poke = () => { dirty = true; if (!raf && Liquid.active) raf = requestAnimationFrame(tick); };

// ---- the cursor: a small clear droplet centred on the pointer; inside the card it merges in and becomes a soft
// swell that follows you. (It no longer leans toward links: that pulled it away from the pointer just as you clicked.)
function aim(x, y, el) {
  const over = !!el?.closest?.('a, button');
  dot.classList.toggle('over', over);
  const R = over ? 11 : 8;
  cursor.set({x, y, w: R, h: R, r: R});
  const c = L.card, inside = x > c.x + 6 && x < c.x + c.w - 6 && y > c.y + 6 && y < c.y + c.h - 6;
  bump.ta = inside ? (over ? 1.4 : 1) : 0; bump.x = x; bump.y = y;
  poke();
}
const onPointerMove = e => {
  if (e.pointerType !== 'mouse') return;
  pointerAt = {x: e.clientX, y: e.clientY};
  dot.style.translate = `${e.clientX}px ${e.clientY}px`;            // not `transform`: the `scale` when over a link would multiply it
  if (!cursor.c.w) cursor.set({x: e.clientX, y: e.clientY}, true);   // appear where the pointer is, not fly in
  aim(e.clientX, e.clientY, e.target);
};
const onScrollAim = () => { if (pointerAt) aim(pointerAt.x, pointerAt.y, document.elementFromPoint(pointerAt.x, pointerAt.y)); };
const onLeave = () => { cursor.set({w: 0, h: 0, r: 0}); bump.ta = 0; poke(); };

// ---- ambient droplets: beads of the card's glass bud off one after another (up to three at once), drift over the
// ink a while at different heights, and come home and merge back in. A panel opening calls them home.
const DROPS = 3;
let nextDrop = 0, drops = [];
// birth and return are slow, eased paths (tweens) the bead follows: it swells as a bulge on the card's edge, still
// joined by a neck, before it pulls away and grows to full size; coming home it drifts back until it touches the edge
// and is drawn in, shrinking as it merges
const BIRTH = 3000, RETURN = 3800, RETURN_FAST = 1900;
function ambient(now) {
  if (reduceMotion.matches) return;
  if (!nextDrop) nextDrop = now + 3500;
  const c = L.card, edge = c.x + c.w;
  if (!panelOpen && drops.length < DROPS && now > nextDrop && !document.hidden) {
    const used = drops.map(d => d.band), free = [0, 1, 2].filter(i => !used.includes(i));
    const band = free[Math.floor(Math.random() * free.length)];
    // sizes vary: small, medium or large (radius px), a class no other bead out now is using
    const SIZES = [[22, 34], [36, 54], [58, 84]], usedSize = drops.map(d => d.size);
    const freeSize = [0, 1, 2].filter(i => !usedSize.includes(i)), size = freeSize[Math.floor(Math.random() * freeSize.length)];
    const R = SIZES[size][0] + Math.random() * (SIZES[size][1] - SIZES[size][0]);
    const y = c.y + c.h * (.22 + band * .28 + Math.random() * .1);
    const out = {x: edge + 110 + R * 1.2 + Math.random() * 190, y: y + (Math.random() - .5) * 120};
    const b = new Body({x: edge - 30, y, w: 10, h: 10, r: 10}, {frost: 0, k: 70, z: .7});
    const d = {b, band, size, y, R, out, ph: Math.random() * 6.28, born: 0, life: 13 + Math.random() * 5, home: false};
    drops.push(d); bodies.add(b);
    tween(b, BIRTH, t => {
      const bud = inOut(clamp01(t / .45)), p = inOut(clamp01((t - .32) / .68));
      const r = mix(mix(10, R * .62, bud), R, p);                          // a bulge first, then full size as it travels
      const x0 = mix(edge - 30, edge + R * .15, bud);                       // the bulge sits on the edge: the neck holds it
      return {x: mix(x0, out.x, p), y: mix(y, out.y, p), w: r, h: r, r};
    }).then(() => { d.born = performance.now(); });
    nextDrop = now + (drops.length < DROPS ? 1800 + Math.random() * 2400 : 9000 + Math.random() * 6000);
  }
  for (const d of [...drops]) {
    if (!d.born || d.home) continue;
    if (panelOpen) { goHome(d); continue; }
    if (d.pair) continue;                                               // meeting, merged or parting: its tweens drive it
    const age = (now - d.born) / 1000;
    if (age > d.life) { goHome(d); continue; }
    d.b.set(wanderAt(d, age));
  }
  maybePair(now);
}
const wanderAt = (d, age) => ({x: d.out.x + Math.sin(age * .4 + d.ph) * 80, y: d.out.y + Math.sin(age * .27 + d.ph * 2) * 60});
const stopTweens = body => tweens.forEach(tw => tw.body === body && tweens.delete(tw));
// carry on wandering from wherever the bead is now (the wander path is re-anchored, so nothing jumps)
const rebase = d => { const w = wanderAt(d, (performance.now() - d.born) / 1000); d.out = {x: d.out.x + d.b.c.x - w.x, y: d.out.y + d.b.c.y - w.y}; };

// ---- beads meet and part: now and then the two closest beads drift together and merge into one bigger bead (the
// material does the merging: their outlines blend), wander as one for a while, then stretch apart and split in two
let nextPair = 0;
const MEET = 3400, HOLD = 4200, PART = 3000;
async function maybePair(now) {
  if (!nextPair) nextPair = now + 9000;
  if (panelOpen || now < nextPair || drops.some(d => d.pair)) return;
  const free = drops.filter(d => d.born && !d.home && (now - d.born) / 1000 < d.life - 4);
  if (free.length < 2) return;
  nextPair = now + 18000 + Math.random() * 14000;
  let A = null, B = null, best = Infinity;
  for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
    const dist = Math.hypot(free[i].b.c.x - free[j].b.c.x, free[i].b.c.y - free[j].b.c.y);
    if (dist < best) { best = dist; A = free[i]; B = free[j]; }
  }
  const pair = {A, B}; A.pair = B.pair = pair;
  const span = (MEET + HOLD + PART) / 1000 + 4;
  for (const d of [A, B]) d.life = Math.max(d.life, (now - d.born) / 1000 + span);
  const edge = L.card.x + L.card.w, rA = A.b.c.w, rB = B.b.c.w;
  const rM = Math.min(96, Math.sqrt(rA * rA + rB * rB));                 // about the two beads' area together
  const fA = {...A.b.c}, fB = {...B.b.c}, ph = Math.random() * 6.28;
  const meet = {x: Math.max(edge + rM + 110, (fA.x + fB.x) / 2), y: (fA.y + fB.y) / 2};
  const drift = t => ({x: meet.x + Math.sin(t * 1.3 + ph) * 30, y: meet.y + Math.sin(t * .9 + ph) * 22});
  const alive = () => A.pair === pair && B.pair === pair && !A.home && !B.home;
  // meet: both slide to the meeting point (the neck forms as they near), then swell into one bead
  await Promise.all([[A, fA, rA], [B, fB, rB]].map(([d, f, r]) => tween(d.b, MEET, t => {
    const p = inOut(t), m = drift(0), rr = mix(r, rM, inOut(clamp01((t - .68) / .32)));
    return {x: mix(f.x, m.x, p), y: mix(f.y, m.y, p), w: rr, h: rr, r: rr};
  })));
  if (!alive()) return;
  await Promise.all([A, B].map(d => tween(d.b, HOLD, t => ({...drift(t), w: rM, h: rM, r: rM}))));   // as one
  if (!alive()) return;
  // part: stretch apart (mostly up and down, away from the card), each back to its own size; the neck thins and snaps
  const ang = Math.PI / 2 + (Math.random() - .5) * 1.1, ux = Math.cos(ang), uy = Math.sin(ang), m1 = drift(1), sep = (rA + rB + 80) / 2;
  await Promise.all([[A, rA, 1], [B, rB, -1]].map(([d, r, side]) => tween(d.b, PART, t => {
    const p = inOut(t), rr = mix(rM, r, inOut(clamp01(t / .55)));
    return {x: m1.x + ux * side * sep * p, y: m1.y + uy * side * sep * p, w: rr, h: rr, r: rr};
  })));
  if (!alive()) return;
  for (const d of [A, B]) { d.pair = null; rebase(d); }
}

function goHome(d) {
  if (d.pair) {                                                         // leaving mid-meeting: the other carries on alone
    const other = d.pair.A === d ? d.pair.B : d.pair.A;
    d.pair = null; stopTweens(d.b);
    if (!other.home) { other.pair = null; stopTweens(other.b); rebase(other); other.b.set({w: other.R, h: other.R, r: other.R}); }
  }
  d.home = true;
  const b = d.b, from = {...b.c}, R = from.w, edge = L.card.x + L.card.w;
  tween(b, panelOpen ? RETURN_FAST : RETURN, t => {
    const p = inOut(clamp01(t / .58)), sink = inOut(clamp01((t - .48) / .52));
    const r = mix(R, 6, sink);
    const x = mix(mix(from.x, edge + R * .55, p), edge - 28, sink);       // drift back to touch the edge, then drawn in
    return {x, y: mix(from.y, d.y, p), w: r, h: r, r};
  }).then(() => {
    bodies.delete(b); drops.splice(drops.indexOf(d), 1);
    if (!drops.length && nextDrop < performance.now() + 6000) nextDrop = performance.now() + 6000 + Math.random() * 4000;
  });
}
// a bead is due while the page is idle: wake for it (the loop otherwise sleeps)
setInterval(() => { if (Liquid.active && !panelOpen && drops.length < DROPS && performance.now() > nextDrop) poke(); }, 1000);

// ---- the project panel: a blob of the card's glass that buds off, travels and grows; closing reverses it ----------
const until = (test, timeout = 1600) => new Promise(resolve => {
  const t0 = performance.now(); const check = () => (test() || performance.now() - t0 > timeout) ? resolve() : requestAnimationFrame(check); check();
});
// The panel's motion is one continuous path, not a chain of stops: the target slides along an eased route while the
// spring follows it closely (a little under-damped, so the glass still wobbles as it lands). Sending the body to a
// stopping point per stage made it crawl to each one — most visibly just before it merged back into the card.
const tweens = new Set();
const tween = (body, dur, fn) => new Promise(done => { tweens.add({body, start: performance.now(), dur: reduceMotion.matches ? 0 : dur, fn, done}); poke(); });
const clamp01 = v => Math.min(1, Math.max(0, v));
const inOut = t => t < .5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
const out3 = t => 1 - Math.pow(1 - t, 3);
const mix = (a, b, t) => a + (b - a) * t;
Liquid.bud = async (point, rect) => {
  const R = {x: rect.left, y: rect.top, w: rect.width, h: rect.height}, cx = R.x + R.w / 2, cy = R.y + R.h / 2;
  const b = new Body({x: point.x - 26, y: point.y, w: 16, h: 16, r: 16}, {frost: 1, k: 420, z: .6});
  bodies.add(b); panelOpen++;
  let closed = false;
  const handle = {
    place(r) { b.set(rectBody({x: r.left, y: r.top, w: r.width, h: r.height})); poke(); },
    async close(to) {
      if (closed) return; closed = true;
      tweens.forEach(tw => tw.body === b && tweens.delete(tw));
      const from = {...b.c};
      // one sweep: deflate into a drop while already heading home, flow into the card's edge, the neck forming as it nears
      // size and travel run off one eased progress, so the motion is one smooth rise and fall with no lull between
      await tween(b, 720, t => {
        const p = inOut(t), g = out3(clamp01(p / .45)), end = clamp01((p - .7) / .3);
        const w = mix(mix(from.w, 28, g), 9, end * end), h = mix(mix(from.h, 28, g), 9, end * end);
        return {x: mix(from.x, to.x - 28, p), y: mix(from.y, to.y, p), w, h, r: Math.min(w, h, mix(from.r, 28, g))};
      });
      await until(() => b.c.w < 11, 400);
      bodies.delete(b); panelOpen--; poke();
    },
  };
  // one path: bud out of the edge, pinch off and travel, inflate into the panel — each phase flowing into the next
  await tween(b, 760, t => {
    const p = inOut(t), q = clamp01(p / .8), inflate = inOut(clamp01((p - .42) / .58));
    const drop = 16 + 26 * out3(clamp01(p / .5));
    const w = mix(drop, R.w / 2, inflate), h = mix(drop, R.h / 2, inflate);
    return {x: mix(point.x - 26, cx, q), y: mix(point.y, cy, q), w, h, r: Math.min(w, h, mix(drop, 22, inflate))};
  });
  b.k = 200; b.z = .55;                                                 // looser at the end: it wobbles as it settles
  await until(() => b.settled(6));
  return handle;
};

// ---- on and off ------------------------------------------------------------------------------------------------------
function wanted() { return wideQuery.matches && !reduceTransparency.matches && (gl || create()); }
function update() {
  const on = !!wanted();
  // the page's head may already have decided (index.html): confirm it, or undo it if WebGL2 is missing after all
  if (on === Liquid.active && root.classList.contains('liquid') === on) return;
  Liquid.active = on;
  root.classList.toggle('liquid', on);
  if (on) {
    if (window.Hyalite) Hyalite.detach(cardEl);                        // the canvas draws the card's glass now
    if (finePointer.matches) {
      if (!dot) { dot = document.createElement('div'); dot.className = 'liquid-dot'; dot.setAttribute('aria-hidden', 'true'); document.body.append(dot); }
      root.classList.add('liquid-cursor'); bodies.add(cursor);
      addEventListener('pointermove', onPointerMove, {passive: true});
      addEventListener('scroll', onScrollAim, {passive: true});
      root.addEventListener('pointerleave', onLeave);
    }
    layout(); inkFresh = true; poke();
  } else {
    root.classList.remove('liquid-cursor'); bodies.delete(cursor);
    removeEventListener('pointermove', onPointerMove); removeEventListener('scroll', onScrollAim); root.removeEventListener('pointerleave', onLeave);
    for (const b of [...bodies]) if (b !== card) bodies.delete(b);
    drops = []; panelOpen = 0;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    dispatchEvent(new Event('resize'));                                // frame.js puts its Hyalite glass back
  }
}
addEventListener('resize', () => { layout(); poke(); });
for (const q of [wideQuery, reduceTransparency]) q.addEventListener('change', update);
document.fonts?.ready.then(() => { layout(); poke(); });
update();
