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
const MAX = 256;                   // glass bodies at most (the card, the panel, the cursor and the frit's dots)
const TILE = 32, SLOTS = 24;       // the glass is drawn in TILE px tiles; each tile lists the (at most SLOTS) bodies near it

const Liquid = window.Liquid = {active: false, bud: null, debug: () => [...bodies].map(b => ({...b.c, frost: b.frost, id: b.id})), tiles: () => [G.nt, G.cols * G.rows]};

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
// The glass is drawn in small square tiles, and only where some body is near. Each tile carries its index; the fragment
// shader reads that tile's short list of nearby bodies and loops over those alone, so the cost per pixel stays small
// however many bubbles there are, and no pixel is shaded twice.
const VERT_TILES = `#version 300 es
in vec3 a; uniform vec2 uView; flat out int vTile;
void main() { vTile = int(a.z); gl_Position = vec4(a.x / uView.x * 2. - 1., 1. - a.y / uView.y * 2., 0., 1.); }`;
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
uniform highp sampler2D uBodies;   // row 0: centre x, y, half width, half height (css px); row 1: corner radius, frost
vec4 bodyB(int i) { return texelFetch(uBodies, ivec2(i, 0), 0); }
vec4 bodyP(int i) { return texelFetch(uBodies, ivec2(i, 1), 0); }
uniform float uK, uBevel, uProfN, uProfDepth, uEdge;
uniform vec2 uLight;       // towards the light, screen space (y down)
uniform vec3 uBump;        // the cursor's swell inside the glass: x, y, amount
uniform vec2 uTintY;       // the card's top and height, for its tint gradient
uniform int uCard;         // 1 when body 0 is the card: its deep inside can skip the other bodies
uniform highp usampler2D uTiles;   // per tile: [count, body index, body index, …]
flat in int vTile;
int ids[${SLOTS}]; int nIds = -1;
void loadIds() {
  if (nIds >= 0) return;
  nIds = int(texelFetch(uTiles, ivec2(0, vTile), 0).r);
  for (int k = 0; k < ${SLOTS}; k++) { if (k >= nIds) break; ids[k] = int(texelFetch(uTiles, ivec2(k + 1, vTile), 0).r); }
}
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
// widen: 0 = the outline; uBevel = a rounder twin used only for the bend direction (no creases at corners)
float shadowField(vec2 p) {                                             // the frosted panels' outline: they cast the shadow
  float d = 1e5;
  for (int k = 0; k < ${SLOTS}; k++) { if (k >= nIds) break; int i = ids[k];
    vec4 bp = bodyP(i); if (bp.y < .5) continue;
    vec4 b = bodyB(i); d = smin(d, sdBox(p - b.xy, b.zw, min(bp.x, min(b.z, b.w))), uK); }
  return d;
}
float field(vec2 p, float widen) {
  float d = 1e5;
  for (int k = 0; k < ${SLOTS}; k++) { if (k >= nIds) break; int i = ids[k];
    vec4 b = bodyB(i); float kk = min(uK, max(2., min(b.z, b.w) * .7));
    d = smin(d, sdBox(p - b.xy, b.zw, min(bodyP(i).x + widen, min(b.z, b.w))), kk); }
  return d;
}
// a rounded box's distance and its exact gradient (outward)
float sdBoxG(vec2 p, vec2 b, float r, out vec2 g) {
  vec2 q = abs(p) - b + r, m = max(q, 0.); float l = length(m);
  vec2 sp = vec2(p.x < 0. ? -1. : 1., p.y < 0. ? -1. : 1.);
  g = l > 0. ? m / l * sp : (q.x > q.y ? vec2(sp.x, 0.) : vec2(0., sp.y));
  return l + min(max(q.x, q.y), 0.) - r;
}
// the outline, the frost and bevel of the bodies near p (frosted bodies stay frosted where they merge), and the bend's
// direction: the gradient of a rounder twin of the outline (no creases at corners). The smooth minimum's gradient is a
// blend of the two gradients it joins, so it comes out of the same pass with no extra samples.
float scan(vec2 p, out float frost, out float bevel, out vec2 grad) {
  if (uCard == 1) {                                                    // deep inside the card no other body can reach
    vec4 c = bodyB(0); float dc = sdBox(p - c.xy, c.zw, min(bodyP(0).x, min(c.z, c.w)));
    if (dc < -(uBevel + uK + 4.)) { frost = bodyP(0).y; bevel = uBevel; grad = vec2(0.); return dc; }
  }
  loadIds();
  float d = 1e5, dw = 1e5, ws = 0., wf = 0., wb = 0.; vec2 gw = vec2(0.), gi;
  for (int k = 0; k < ${SLOTS}; k++) { if (k >= nIds) break; int i = ids[k];
    vec4 b = bodyB(i), bp = bodyP(i); vec2 pp = p - b.xy; float rr = min(b.z, b.w);
    float kk = min(uK, max(2., rr * .7));                               // merging scales with the smaller body
    float di, dwi;
    if (bp.x >= rr && abs(b.z - b.w) < .01) {                          // a round droplet (most bodies): one cheap step
      float l = length(pp); di = dwi = l - rr; gi = pp / max(l, 1e-4);
    } else {
      di = sdBox(pp, b.zw, min(bp.x, rr));
      dwi = sdBoxG(pp, b.zw, min(bp.x + uBevel, rr), gi);
    }
    d = smin(d, di, kk);
    float h = max(kk - abs(dw - dwi), 0.) / kk;
    gw = mix(gw, gi, dwi < dw ? 1. - h * .5 : h * .5); dw = min(dw, dwi) - h * h * kk * .25;
    float q = max(di, 0.) * .05, w = 1. / (1. + q + q * q);             // nearby bodies weigh more (a cheap falloff)
    ws += w; wf += w * bp.y; wb += w * min(uBevel, rr - 1.); }
  frost = wf / max(ws, 1e-4); bevel = max(1., wb / max(ws, 1e-4)); grad = gw;
  return d;
}
vec2 prof(float s) { return texture(uProf, vec2((clamp(s, 0., uProfDepth) / uProfDepth * (uProfN - 1.) + .5) / uProfN, .5)).rg; }
void main() {
  vec2 p = cssAt(gl_FragCoord.xy);
  float frost, bevel; vec2 gw;
  float d = scan(p, frost, bevel, gw);
  if (d > .8) {                                                        // outside: only the drop shadow (0 12px 36px -20px)
    float a = 0.;
    if (d < 30.) { loadIds(); a = .07 * (1. - smoothstep(-36., 36., shadowField(p - vec2(0., 12.)) + 20.)); }
    o = vec4(vec3(.118, .098, .059) * a, a); return;
  }
  float s = max(-d, 0.);
  float sProf = s * uBevel / bevel;                                    // small drops use the whole profile across their radius
  vec2 g = vec2(0.), pe = vec2(0.);
  if (sProf < uProfDepth + 1.) {                                       // the bevel bends and lights; the flat inside does not
    g = gw / max(length(gw), 1e-4);                                    // outward
    pe = prof(sProf);                                                  // r: inward displacement px, g: signed edge light
  }
  vec2 off = -g * pe.r;
  vec2 bd = p - uBump.xy; float bg = exp(-dot(bd, bd) / 1800.); vec2 bgrad = -bd / 900. * bg * uBump.z;
  off += bgrad * 22.;                                                  // the cursor's swell: a soft lens of its own
  vec2 ps = p + off;
  vec3 blurred = texture(uBlur, vec2(ps.x / uView.x, 1. - ps.y / uView.y)).rgb;
  vec3 col = frost > .995 ? blurred : mix(sceneAt(ps), blurred, frost);   // fully frosted glass never shows the sharp backdrop
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
  const program = (fs, vs = VERT) => {
    const p = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, vs], [gl.FRAGMENT_SHADER, fs]]) {
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
  E = {scene: program(SCENE), blur: program(BLUR), glass: program(GLASS, VERT_TILES), paper: texture(gl.REPEAT), ink: texture(), prof: texture(),
       a: target(), b: target()};
  E.full = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, E.full);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  E.tiles = gl.createBuffer();                                          // sized in layout()
  E.bodyTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, E.bodyTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, MAX, 2, 0, gl.RGBA, gl.FLOAT, null);
  E.tileTex = gl.createTexture(); gl.bindTexture(gl.TEXTURE_2D, E.tileTex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.enableVertexAttribArray(0);
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
  G.cols = Math.ceil(W / TILE); G.rows = Math.ceil(H / TILE); const n = G.cols * G.rows;
  if (!G.data || G.data.length < n * (SLOTS + 1)) {
    G.data = new Uint8Array(n * (SLOTS + 1)); G.verts = new Float32Array(n * 18);
    gl.bindBuffer(gl.ARRAY_BUFFER, E.tiles); gl.bufferData(gl.ARRAY_BUFFER, G.verts.byteLength, gl.DYNAMIC_DRAW);
  }
  gl.bindTexture(gl.TEXTURE_2D, E.tileTex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8UI, SLOTS + 1, n, 0, gl.RED_INTEGER, gl.UNSIGNED_BYTE, null);
  fritLayout();
  sceneDirty = dirty = true;
}
const G = {cols: 0, rows: 0, data: null, verts: null};

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
const BD = new Float32Array(MAX * 8), Bpo = MAX * 4;                   // the body texture: row 0, then row 1
// how far a body can matter: its shadow (16px past its outline, cast from 12px above, plus a margin) and how far it
// merges (the smooth minimum's k, which scales with the body's size)
const reachOf = (c, frost) => (frost >= .5 ? 30 : 3) + Math.min(P.smooth, Math.max(2, Math.min(c.w, c.h) * .7));
const useBuffer = buf => { gl.bindBuffer(gl.ARRAY_BUFFER, buf); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0); };
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
    gl.disable(gl.BLEND); useBuffer(E.full);
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
  const S1 = SLOTS + 1, data = G.data, cols = G.cols, rows = G.rows, tiles = cols * rows;
  for (let t = 0; t < tiles; t++) data[t * S1] = 0;
  for (const b of bodies) {
    if (n >= MAX || b.c.w <= .3 || b.c.h <= .3) continue;
    const c = b.c, i = n * 4;
    BD[i] = c.x; BD[i + 1] = c.y; BD[i + 2] = c.w; BD[i + 3] = c.h; BD[Bpo + i] = c.r; BD[Bpo + i + 1] = b.frost;
    // every tile this body can matter to lists it
    const R = reachOf(c, b.frost);
    const tx0 = Math.max(0, Math.floor((c.x - c.w - R) / TILE)), tx1 = Math.min(cols - 1, Math.floor((c.x + c.w + R) / TILE));
    const ty0 = Math.max(0, Math.floor((c.y - c.h - R) / TILE)), ty1 = Math.min(rows - 1, Math.floor((c.y + c.h + R + 12) / TILE));
    for (let ty = ty0; ty <= ty1; ty++) for (let tx = tx0; tx <= tx1; tx++) {
      const o = (ty * cols + tx) * S1, k = data[o];
      if (k < SLOTS) { data[o + 1 + k] = n; data[o] = k + 1; }
    }
    n++;
  }
  let nt = 0; const V = G.verts;
  for (let t = 0; t < tiles; t++) {
    if (!data[t * S1]) continue;
    const x0 = (t % cols) * TILE, y0 = Math.floor(t / cols) * TILE, x1 = x0 + TILE, y1 = y0 + TILE, v = nt * 18;
    V[v] = x0; V[v + 1] = y0; V[v + 2] = t; V[v + 3] = x1; V[v + 4] = y0; V[v + 5] = t; V[v + 6] = x0; V[v + 7] = y1; V[v + 8] = t;
    V[v + 9] = x0; V[v + 10] = y1; V[v + 11] = t; V[v + 12] = x1; V[v + 13] = y0; V[v + 14] = t; V[v + 15] = x1; V[v + 16] = y1; V[v + 17] = t;
    nt++;
  }
  G.nt = nt;
  gl.activeTexture(gl.TEXTURE4); gl.bindTexture(gl.TEXTURE_2D, E.tileTex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, S1, tiles, gl.RED_INTEGER, gl.UNSIGNED_BYTE, data, 0);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.uniform1i(u.uTiles, 4);
  gl.activeTexture(gl.TEXTURE5); gl.bindTexture(gl.TEXTURE_2D, E.bodyTex);
  gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAX, 2, gl.RGBA, gl.FLOAT, BD);
  gl.uniform1i(u.uBodies, 5);
  gl.uniform1i(u.uBlur, 2); gl.uniform1i(u.uProf, 3);
  gl.uniform1f(u.uK, P.smooth); gl.uniform1f(u.uBevel, P.bevel); gl.uniform1f(u.uEdge, P.edge);
  gl.uniform1f(u.uProfN, E.PROF.n); gl.uniform1f(u.uProfDepth, E.PROF.depth);
  gl.uniform2f(u.uTintY, L.card.y, L.card.h);
  gl.uniform1i(u.uCard, bodies.values().next().value === card && card.c.w > .3 ? 1 : 0);
  const a = P.light * Math.PI / 180; gl.uniform2f(u.uLight, Math.sin(a), -Math.cos(a));
  gl.uniform3f(u.uBump, bump.x, bump.y, bump.a);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindBuffer(gl.ARRAY_BUFFER, E.tiles); gl.bufferSubData(gl.ARRAY_BUFFER, 0, G.verts, 0, nt * 18);
  gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, nt * 6);
  if (!canvas.classList.contains('ready')) requestAnimationFrame(() => canvas.classList.add('ready'));   // fade in once drawn
}
function tick(now) {
  raf = 0;
  if (!Liquid.active) return;
  const dt = Math.min(1 / 30, (now - (last || now)) / 1000); last = now;
  frit(now, dt);
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
  // keep ticking while anything moves; the stream always flows (unless motion is reduced), so in practice it keeps going
  if (moving || !reduceMotion.matches || tweens.size || panelOpen) raf = requestAnimationFrame(tick);
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

// ---- the frit: like the dot band printed along a car window's edge, a staggered grid of glass dots runs along the
// card's right edge. The first column is large and nearly touching, so it merges into the card like the solid band; the
// dots then taper column by column down to the size of the cursor's droplet. Each dot only breathes and drifts a pixel
// or two. A project panel takes in the dots where it opens and on its way there; when it closes they grow back, in a
// ripple running outward from the card.
const FRIT = {pitch: 46, cols: 9, d0: 44, d1: 16, frost: .14, wobble: 1.6};
let dots = [], panelRect = null, panelFrom = null, refill = false, fritT = 0;
const rand = (a, b) => a + Math.random() * (b - a);
function fritLayout() {
  const edge = L.card.x + L.card.w, top = L.card.y + 14, bottom = L.card.y + L.card.h - 14;
  const p = FRIT.pitch, rowH = p * Math.sqrt(3) / 2;                    // a staggered (hex) grid
  const cols = Math.max(2, Math.min(FRIT.cols, Math.floor((W - edge - 40) / p)));
  const rows = Math.floor((bottom - top) / rowH) + 1, y0 = top + ((bottom - top) - (rows - 1) * rowH) / 2;
  const old = dots; dots = [];
  for (const d of old) bodies.delete(d.b);
  for (let c = 0; c < cols; c++) {
    const f = c / (cols - 1), dia = FRIT.d0 + (FRIT.d1 - FRIT.d0) * Math.pow(f, .85);
    for (let r = 0; r < rows; r++) {
      if (dots.length >= MAX - 8) break;
      const x = edge + dia * .32 + c * p + (r % 2 ? p / 2 : 0), y = y0 + r * rowH;
      if (x + dia / 2 > W - 8) continue;
      const d = {col: c, x, y, r0: dia / 2, s: 1, st: 1, at: 0, ph: [rand(0, 6.28), rand(0, 6.28), rand(0, 6.28)],
                 w: [rand(.25, .55), rand(.25, .55), rand(.3, .7)]};
      const was = old.find(o => o.col === c && Math.abs(o.y - y) < 2);
      if (was) { d.s = was.s; d.st = was.st; }                          // a resize keeps the panel's state
      d.b = new Body({x, y, w: d.r0, h: d.r0, r: d.r0}, {frost: FRIT.frost});
      bodies.add(d.b); dots.push(d);
    }
  }
}
function frit(now, dt) {
  if (!reduceMotion.matches) fritT += dt;
  const r = panelRect, t = fritT;
  for (const d of dots) {
    // the panel: dots where it opens, or on its way there, are taken in
    if (panelOpen && r && d.st === 1) {
      const m = d.r0 + 26, inPanel = d.x > r.x - m && d.x < r.x + r.w + m && d.y > r.y - m && d.y < r.y + r.h + m;
      const onRoute = panelFrom && distToSegment(d, panelFrom, {x: r.x + r.w / 2, y: r.y + r.h / 2}) < m + 46;
      if (inPanel || onRoute) { d.st = 0; d.at = now; d.fast = onRoute; }
    }
    if (refill && !panelOpen && d.st === 0) { d.st = 1; d.at = now + d.col * 70 + rand(0, 90); }   // the ripple back
    // out of the panel's way before it passes (its route) or arrives; back in more gently
    if (now >= d.at) d.s += (d.st - d.s) * Math.min(1, dt * (d.st ? 4.5 : d.fast ? 22 : 12));
    const wob = FRIT.wobble * Math.min(1, d.r0 / 14);
    const x = d.x + wob * Math.sin(t * d.w[0] + d.ph[0]), y = d.y + wob * Math.sin(t * d.w[1] + d.ph[1]);
    const rr = d.r0 * d.s * (1 + .035 * Math.sin(t * d.w[2] + d.ph[2]));
    d.b.set({x, y, w: rr, h: rr, r: rr}, true);
  }
  if (refill && !panelOpen) refill = false;
}
function distToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, t = clamp01(((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1));
  return Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t);
}

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
  bodies.add(b); panelOpen++; panelRect = R; panelFrom = point;
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
      bodies.delete(b); panelOpen--; panelRect = panelFrom = null; refill = true; poke();
    },
  };
  // one path: bud out of the edge, pinch off and travel, inflate into the panel — each phase flowing into the next
  await tween(b, 900, t => {
    const q = inOut(clamp01(t / .62)), inflate = inOut(clamp01((t - .36) / .64));
    const drop = 16 + 26 * out3(clamp01(t / .4));
    const w = mix(drop, R.w / 2, inflate), h = mix(drop, R.h / 2, inflate);
    return {x: mix(point.x - 26, cx, q), y: mix(point.y, cy, q), w, h, r: Math.min(w, h, mix(drop, 22, inflate))};
  });
  b.k = 200; b.z = .55;                                                 // looser at the end: it wobbles as it settles
  await until(() => b.settled(6));
  return handle;
};



const px1 = new Uint8Array(4);
// the cost of one full render: of a fixed scene (the card and exactly `beads` test bubbles), or with beads < 0 of the page as it is
Liquid.bench = (n = 60, beads = 8, frost = .5) => {
  const was = Liquid.active; Liquid.active = false; if (raf) cancelAnimationFrame(raf); raf = 0;   // the page loop pauses
  const kept = [...bodies];
  if (beads >= 0) { bodies.clear(); bodies.add(card); }                 // beads < 0: measure the page as it is
  for (let i = 0; i < beads; i++) { const r = 8 + (i % 5) * 9; bodies.add(new Body({x: L.card.x + L.card.w + 50 + (i % 6) * 105, y: 70 + Math.floor(i / 6) * 110, w: r, h: r, r}, {frost: FRIT.frost})); }
  render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
  // the GPU's own timer where the browser offers it (exact, unaffected by how busy the CPU is); else wall time
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'), qs = [];
  const t0 = performance.now();
  for (let i = 0; i < n; i++) {
    sceneDirty = frost >= 1 || (frost > 0 && i % 2 === 0);
    const q = tq && gl.createQuery(); if (q) gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    render();
    if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); qs.push(q); }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
  }
  let ms = (performance.now() - t0) / n;
  const gpu = qs.filter(q => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)).map(q => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6).sort((x, y) => x - y);
  qs.forEach(q => gl.deleteQuery(q));
  if (gpu.length > n / 2 && !gl.getParameter(tq.GPU_DISJOINT_EXT)) ms = gpu[gpu.length >> 1];
  bodies.clear(); kept.forEach(b => bodies.add(b)); Liquid.active = was; poke();
  return ms;
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
    dots = []; panelOpen = 0;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    dispatchEvent(new Event('resize'));                                // frame.js puts its Hyalite glass back
  }
}
addEventListener('resize', () => { layout(); poke(); });
for (const q of [wideQuery, reduceTransparency]) q.addEventListener('change', update);
document.fonts?.ready.then(() => { layout(); poke(); });
update();
