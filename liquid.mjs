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
const MAX = 16;

const Liquid = window.Liquid = {active: false, bud: null, debug: () => [...bodies].map(b => ({...b.c, frost: b.frost, id: b.id})),
  drops: () => drops.map(d => ({id: d.b?.id, born: !!d.born, pair: !!d.pair, home: d.home, visit: !!d.visit, tween: [...tweens].some(t => t.body === d.b)}))};

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
// the glass is drawn as one quad per body (its box plus the reach of the shadow and the merging), not a full-screen
// pass: most of the screen has no glass, and those pixels now cost nothing
const VERT_QUADS = `#version 300 es
in vec2 a; uniform vec2 uView;
void main() { gl_Position = vec4(a.x / uView.x * 2. - 1., 1. - a.y / uView.y * 2., 0., 1.); }`;
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
uniform float uRimFrost;   // the frosted panels' rim is as clear as the bubbles, frosting over toward the inside
uniform vec2 uTintY;       // the card's top and height, for its tint gradient
uniform vec2 uRipple;      // the frosted panels' slight ripple: time (s), strength
uniform vec2 uCardR;       // the card's text edge and right edge: past the text it turns to the bubbles' glass
uniform float uKC;         // how far the card's edge reaches toward the other glass (wider than uK: it bulges out to meet them)
uniform int uCard;         // 1 when body 0 is the card: its deep inside can skip the other bodies
float sdBox(vec2 p, vec2 b, float r) { vec2 q = abs(p) - b + r; return length(max(q, 0.)) + min(max(q.x, q.y), 0.) - r; }
float smin(float a, float b, float k) { float h = max(k - abs(a - b), 0.) / k; return min(a, b) - h * h * k * .25; }
// widen: 0 = the outline; uBevel = a rounder twin used only for the bend direction (no creases at corners)
// a body's distance: a round body (most of them) is a plain circle; a body farther than FAR px cannot change a pixel
// (the merging reaches uK, the frost weighting fades to nothing by then), so the costlier work skips it
#define FAR 140.
bool round_(vec4 b, float r) { return r >= min(b.z, b.w) && abs(b.z - b.w) < .01; }
float field(vec2 p, float widen) {
  float d = 1e5, dc = 1e5;
  for (int i = 0; i < ${MAX}; i++) { if (i >= uN) break;
    vec4 b = uB[i]; vec2 pp = p - b.xy; float rr = min(b.z, b.w);
    float di = round_(b, uBp[i].x) ? length(pp) - rr : sdBox(pp, b.zw, min(uBp[i].x + widen, rr));
    if (i == 0 && uCard == 1) dc = di; else if (di < FAR) d = smin(d, di, uK); }
  return smin(d, dc, uKC);
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
    vec4 c = uB[0]; float dc = sdBox(p - c.xy, c.zw, min(uBp[0].x, min(c.z, c.w)));
    if (dc < -(uBevel + uKC + 4.)) { frost = uBp[0].y; bevel = uBevel; grad = vec2(0.); return dc; }
  }
  float d = 1e5, dw = 1e5, ws = 0., wf = 0., wb = 0., dC = 1e5, dwC = 1e5; vec2 gw = vec2(0.), gi, gC = vec2(0.);
  for (int i = 0; i < ${MAX}; i++) { if (i >= uN) break;
    vec4 b = uB[i]; vec2 pp = p - b.xy; float rr = min(b.z, b.w), dwi;
    bool rnd = round_(b, uBp[i].x);
    float di = rnd ? length(pp) - rr : sdBox(pp, b.zw, min(uBp[i].x, rr));
    if (di > FAR) continue;
    if (rnd) { dwi = di; gi = pp / max(di + rr, 1e-4); }                 // a circle's rounder twin is itself
    else dwi = sdBoxG(pp, b.zw, min(uBp[i].x + uBevel, rr), gi);
    float w = exp(-max(di, 0.) * .05); ws += w; wf += w * uBp[i].y; wb += w * min(uBevel, rr - 1.);
    if (i == 0 && uCard == 1) { dC = di; dwC = dwi; gC = gi; continue; }  // the card joins last, with its own reach
    d = smin(d, di, uK);
    float h = max(uK - abs(dw - dwi), 0.) / uK;
    gw = mix(gw, gi, dwi < dw ? 1. - h * .5 : h * .5); dw = min(dw, dwi) - h * h * uK * .25; }
  d = smin(d, dC, uKC);
  float h = max(uKC - abs(dw - dwC), 0.) / uKC;
  gw = mix(gw, gC, dwC < dw ? 1. - h * .5 : h * .5);
  frost = wf / max(ws, 1e-4); bevel = max(1., wb / max(ws, 1e-4)); grad = gw;
  return d;
}
// a few long, slow swells crossing in different directions: the surface slope (per unit of strength)
vec2 ripple(vec2 p, float t) {
  const vec2 k1 = vec2(.0210, .0080), k2 = vec2(-.0110, .0190), k3 = vec2(.0060, -.0250);
  return k1 * cos(dot(k1, p) - t * .55) + k2 * cos(dot(k2, p) - t * .43 + 1.7) * .8 + k3 * cos(dot(k3, p) - t * .67 + 4.1) * .6;
}
vec2 prof(float s) { return texture(uProf, vec2((clamp(s, 0., uProfDepth) / uProfDepth * (uProfN - 1.) + .5) / uProfN, .5)).rg; }
void main() {
  vec2 p = cssAt(gl_FragCoord.xy);
  float frost, bevel; vec2 gw;
  float d = scan(p, frost, bevel, gw);
  if (d > .8) {                                                        // outside: only the drop shadow (0 12px 36px -20px)
    float a = 0.;
    if (d < 46.) a = .07 * (1. - smoothstep(-36., 36., field(p - vec2(0., 12.), 0.) + 20.));
    o = vec4(vec3(.118, .098, .059) * a, a); return;
  }
  float s = max(-d, 0.);
  float panel = smoothstep(.9, .93, frost);                            // the frosted panels ripple, the bubbles do not
  if (frost > .5) frost = mix(uRimFrost, frost, smoothstep(4., uBevel * 1.15, s));
  float side = smoothstep(uCardR.x - 70., uCardR.y - 6., p.x) * (1. - smoothstep(uCardR.y + 60., uCardR.y + 90., p.x));
  frost = mix(frost, min(frost, .55), side);                           // the card's right margin is clear glass, like the bubbles
  float sProf = s * uBevel / bevel;                                    // small drops use the whole profile across their radius
  vec2 g = vec2(0.), pe = vec2(0.);
  if (sProf < uProfDepth + 1.) {                                       // the bevel bends and lights; the flat inside does not
    g = gw / max(length(gw), 1e-4);                                    // outward
    pe = prof(sProf);                                                  // r: inward displacement px, g: signed edge light
  }
  vec2 off = -g * pe.r;
  float bg = 0.; vec2 bgrad = vec2(0.);
  if (uBump.z > .001) {                                                // the cursor is over the card
    vec2 bd = p - uBump.xy; bg = exp(-dot(bd, bd) / 1800.); bgrad = -bd / 900. * bg * uBump.z;
  }
  vec2 rg = vec2(0.);
  if (panel > 0. && uRipple.y > 0.) rg = ripple(p, uRipple.x) * uRipple.y * panel;
  off += bgrad * 22. + rg * 50.;                                                  // the cursor's swell: a soft lens of its own
  vec2 ps = p + off;
  vec3 blurred = texture(uBlur, vec2(ps.x / uView.x, 1. - ps.y / uView.y)).rgb;
  vec3 col = frost > .995 ? blurred : mix(sceneAt(ps), blurred, frost);   // fully frosted: the sharp backdrop never shows
  float ty = clamp((p.y - uTintY.x) / uTintY.y, 0., 1.);               // the card's --glass tint: .30 → .19 → .25
  float tint = ty < .45 ? mix(.30, .19, ty / .45) : mix(.19, .25, (ty - .45) / .55);
  col = mix(col, vec3(1.), tint * mix(.4, 1., frost) * (1. - .45 * side));
  col += dot(rg, uLight) * .5;                                         // the swells catch the light faintly
  float e = pe.g, f = dot(g, uLight);                                  // Hyalite's edge light; only the lit half follows the light
  if (e > 0.) e *= max(0., f) * .78 + max(0., -f) * .30;
  col = e > 0. ? mix(col, vec3(1.), min(e, 1.)) : mix(col, vec3(0.), min(-e, 1.));
  col = mix(col, vec3(0.), .16 * uEdge * (1. - smoothstep(1.1, 1.9, s)));   // the card's CSS rim: dark hairline, white line
  col = mix(col, vec3(1.), .72 * uEdge * (1. - smoothstep(.2, .9, s)) + .55 * uEdge * max(0., f) * (1. - smoothstep(.6, 1.6, s)));
  if (uBump.z > .001) col += uBump.z * .16 * bg * pow(max(dot(normalize(vec3(bgrad * 14., 1.)), normalize(vec3(uLight, .9))), 0.), 40.);
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
const CARD_FROST = .94;                                                   // a touch of the drawing shows through, as in the bubbles
const PANEL_R = 36;                                                      // the frosted panels' corner radius (style.css matches)
const rectBody = (r, radius = PANEL_R) => ({x: r.x + r.w / 2, y: r.y + r.h / 2, w: r.w / 2, h: r.h / 2, r: radius});

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
  E = {scene: program(SCENE), blur: program(BLUR), glass: program(GLASS, VERT_QUADS), paper: texture(gl.REPEAT), ink: texture(), prof: texture(),
       a: target(), b: target()};
  E.full = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, E.full);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  E.quads = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, E.quads);
  gl.bufferData(gl.ARRAY_BUFFER, MAX * 12 * 4, gl.DYNAMIC_DRAW);
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
const card = new Body({x: 0, y: 0, w: 0, h: 0, r: PANEL_R}, {frost: CARD_FROST, k: 300, z: 1});
const bodies = new Set([card]);
const cursor = new Body({x: -100, y: -100, w: 0, h: 0, r: 0}, {k: 420, z: .72});
const bump = {x: 0, y: 0, a: 0, ta: 0, v: 0};
let dot = null, pointerAt = null, panelOpen = 0;

function layout() {
  if (!Liquid.active) return;
  W = root.clientWidth; H = innerHeight; DPR = Math.min(SCALES[quality], devicePixelRatio || 1);
  canvas.width = Math.round(W * DPR); canvas.height = Math.round(H * DPR);
  for (const b of [E.a, E.b]) {                                         // the frost is computed at half resolution
    b.w = Math.max(1, Math.round(W / 2)); b.h = Math.max(1, Math.round(H / 2));
    gl.bindTexture(gl.TEXTURE_2D, b.t); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, b.w, b.h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
  }
  const c = cardEl.getBoundingClientRect(), v = visuals.getBoundingClientRect();
  L.card = {x: c.left, y: c.top, w: c.width, h: c.height};
  L.textR = c.right - (parseFloat(getComputedStyle(cardEl.querySelector('.content') || cardEl).paddingRight) || 60);
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
let lastFrost = 0, frostOwed = false;
// the frosted panels' ripple: very slight and slow, so it is redrawn at most 30 times a second; still for reduced motion
const RIPPLE = 1; let rippleT = 0, lastRipple = 0;
const Bv = new Float32Array(MAX * 4), Bpv = new Float32Array(MAX * 4), Q = new Float32Array(MAX * 12);
const REACH = 34;                                                       // px past a body's box: its shadow and its merging
const CARD_REACH = 72;                                                  // the card's edge reaches farther (uKC)
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
  // the frost: the background, blurred (6px). It is soft anyway, so with the drawing playing at 60 fps it is refreshed at
  // most 30 times a second (the sharp drawing under clear glass still takes every frame)
  const nowMs = performance.now();
  if (sceneDirty && nowMs - lastFrost < 30) { sceneDirty = false; frostOwed = true; }
  if (frostOwed && nowMs - lastFrost >= 30) { sceneDirty = true; frostOwed = false; }
  if (sceneDirty) { lastFrost = nowMs;
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
  for (const b of bodies) {
    if (n >= MAX || b.c.w <= .3 || b.c.h <= .3) continue;
    const c = b.c, i = n * 4;
    Bv[i] = c.x; Bv[i + 1] = c.y; Bv[i + 2] = c.w; Bv[i + 3] = c.h; Bpv[i] = c.r; Bpv[i + 1] = b.frost;
    const RE = b === card ? CARD_REACH + 12 : REACH;
    const x0 = c.x - c.w - RE, x1 = c.x + c.w + RE, y0 = c.y - c.h - RE, y1 = c.y + c.h + RE + 12, q = n * 12;
    Q[q] = x0; Q[q + 1] = y0; Q[q + 2] = x1; Q[q + 3] = y0; Q[q + 4] = x0; Q[q + 5] = y1;
    Q[q + 6] = x0; Q[q + 7] = y1; Q[q + 8] = x1; Q[q + 9] = y0; Q[q + 10] = x1; Q[q + 11] = y1;
    n++;
  }
  gl.uniform4fv(u.uB, Bv); gl.uniform4fv(u.uBp, Bpv); gl.uniform1i(u.uN, n);
  gl.uniform1i(u.uBlur, 2); gl.uniform1i(u.uProf, 3);
  gl.uniform1f(u.uK, P.smooth); gl.uniform1f(u.uKC, CARD_REACH); gl.uniform1f(u.uBevel, P.bevel); gl.uniform1f(u.uEdge, P.edge);
  gl.uniform1f(u.uProfN, E.PROF.n); gl.uniform1f(u.uProfDepth, E.PROF.depth);
  gl.uniform2f(u.uTintY, L.card.y, L.card.h); gl.uniform2f(u.uRipple, rippleT, RIPPLE); gl.uniform2f(u.uCardR, L.textR, L.card.x + L.card.w);
  gl.uniform1i(u.uCard, bodies.values().next().value === card && card.c.w > .3 ? 1 : 0);
  const a = P.light * Math.PI / 180; gl.uniform2f(u.uLight, Math.sin(a), -Math.cos(a));
  gl.uniform3f(u.uBump, bump.x, bump.y, bump.a); gl.uniform1f(u.uRimFrost, DROP_FROST);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, canvas.width, canvas.height);
  gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT);
  // overlapping quads compute the same value twice and simply overwrite it (no blending)
  gl.bindBuffer(gl.ARRAY_BUFFER, E.quads); gl.bufferSubData(gl.ARRAY_BUFFER, 0, Q, 0, n * 12);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.drawArrays(gl.TRIANGLES, 0, n * 6);
  if (!canvas.classList.contains('ready')) requestAnimationFrame(() => canvas.classList.add('ready'));   // fade in once drawn
}
// adaptive quality: if frames stay slow (under about 52 fps for some 3 s), the glass is drawn at a lower resolution, a
// step at a time; it only ever steps down (no see-sawing), and a hidden tab's long gaps are ignored
const SCALES = [1.5, 1.25, 1];
let quality = 0, prevNow = 0, gapSum = 0; const gaps = [];
function watchFrames(now) {
  const gap = now - prevNow; prevNow = now;
  if (gap <= 0 || gap > 1000 || document.hidden) return;                 // a hidden tab or a stall is not the glass
  gaps.push(gap); gapSum += gap;
  if (gapSum < 3000 || gaps.length < 12) return;                        // judged every 3 s
  gaps.sort((a, b) => a - b); const median = gaps[gaps.length >> 1]; gaps.length = 0; gapSum = 0;
  if (median > 19 && quality < SCALES.length - 1 && (devicePixelRatio || 1) > SCALES[quality + 1]) {
    quality++; Liquid.quality = SCALES[quality]; layout();
  }
}
function tick(now) {
  raf = 0;
  if (!Liquid.active) return;
  watchFrames(now);
  Liquid.ticks = (Liquid.ticks || 0) + 1;
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
  if (!reduceMotion.matches && now - lastRipple >= 33) { rippleT = now / 1000; lastRipple = now; dirty = true; }
  if (dirty || inkFresh || sceneDirty || frostOwed || (moving && visiblyChanged())) { render(); markDrawn(); dirty = false; Liquid.renders = (Liquid.renders || 0) + 1; }
  // keep ticking while anything moves (or a drop is out, or the veil is fading); otherwise sleep until poked
  // (beads are always out, so in practice it keeps ticking; it also must not sleep before the card buds them again)
  // exactly one loop: something during this tick (a bubble budding, a tween starting) may already have queued the next
  // frame through poke(); queuing another here used to start a second loop each time, every one of them rendering
  if (raf) return;
  if (moving || frostOwed || (drops.length && !reduceMotion.matches) || tweens.size || panelOpen || (!reduceMotion.matches && live().length < COUNT[0])) raf = requestAnimationFrame(tick);
  else last = 0;
}
// what the last frame drew: positions and sizes of every body, and the cursor's swell
const SEEN = .3;                                                        // css px: below this a move cannot be seen
let drawnIds = 0, drawnBump = 0;
function visiblyChanged() {
  let ids = 0;
  for (const b of bodies) {
    ids += b.id; const c = b.c, d = b.drawn;
    if (!d || Math.abs(c.x - d.x) > SEEN || Math.abs(c.y - d.y) > SEEN || Math.abs(c.w - d.w) > SEEN || Math.abs(c.h - d.h) > SEEN || Math.abs(c.r - d.r) > SEEN) return true;
  }
  return ids !== drawnIds || Math.abs(bump.a - drawnBump) > .004;
}
function markDrawn() {
  let ids = 0;
  for (const b of bodies) { ids += b.id; const c = b.c, d = b.drawn || (b.drawn = {}); d.x = c.x; d.y = c.y; d.w = c.w; d.h = c.h; d.r = c.r; }
  drawnIds = ids; drawnBump = bump.a;
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

// ---- beads: there are always 6–8 beads of the glass drifting over the drawing, in a range of sizes. Some are already
// out when the page loads; each wanders a while, then drifts home and merges into the card, and the card buds a new one
// (it swells as a bulge on the card's edge, still joined by a neck, before it pulls away). A project panel takes them in:
// beads where it opens are absorbed into it, the rest go home; after it closes the card buds them out again.
const COUNT = [4, 5], DROP_FROST = .85;                                   // few enough that the drawing stays the subject
const SIZES = [[30, 44], [48, 70], [76, 104], [110, 150]];             // radius px, small to large
let nextDrop = 0, drops = [], target = 5, seeded = false, panelRect = null, panelFrom = null;
const BIRTH = 3000, RETURN = 3800, RETURN_FAST = 1900, ABSORB_MS = 420;
const live = () => drops.filter(d => !d.home);
function pickSize() {                                                   // mostly medium: one small and one large at most
  const n = [0, 0, 0, 0]; for (const d of live()) n[d.size]++;
  const ok = [1, 2].concat(n[0] < 1 ? [0] : [], n[3] < 1 ? [3] : []), min = Math.min(...ok.map(i => n[i]));
  const pick = ok.filter(i => n[i] === min), size = pick[Math.floor(Math.random() * pick.length)];
  return {size, R: SIZES[size][0] + Math.random() * (SIZES[size][1] - SIZES[size][0])};
}
function spot(R) {                                                      // a home for its wander, away from the others
  // close to the card: from just off its edge to a few hundred px out, the nearest the likeliest
  const edge = L.card.x + L.card.w, x0 = edge + R + 30, x1 = Math.min(W - R - 110, edge + R + 200), y0 = L.card.y + R * .5, y1 = L.card.y + L.card.h - R * .5;
  let best = null, bestGap = -1;
  for (let i = 0; i < 16; i++) {
    const c = {x: mix(x0, Math.max(x0, x1), Math.pow(Math.random(), 2.2)), y: mix(y0, Math.max(y0, y1), Math.random())};
    const gap = Math.min(...live().map(d => Math.hypot(d.out.x - c.x, d.out.y - c.y) - d.R), 1e9);
    if (gap > bestGap) { bestGap = gap; best = c; }
  }
  return best;
}
function makeDrop(born) {
  const {size, R} = pickSize(), out = spot(R);
  const d = {b: null, size, R, out, y: out.y, ph: Math.random() * 6.28, born, life: 20 + Math.random() * 16, home: false};
  return d;
}
function seed(now) {                                                    // the page opens with beads already out
  seeded = true;
  const n = COUNT[0] + Math.floor(Math.random() * 2);
  for (let i = 0; i < n; i++) {
    const d = makeDrop(now - Math.random() * 14000);                    // part-way through their wander, so they leave at different times
    d.y = L.card.y + L.card.h * (.2 + Math.random() * .6);
    // at its own spot (spots are spaced apart), already riding the current: no scramble on load
    const c0 = current(d.out.x, d.out.y, now / 1000), s0 = 10 * Math.pow(40 / d.R, .45);
    d.p = {x: d.out.x, y: d.out.y}; d.v = {x: c0.x * s0, y: c0.y * s0};
    d.b = new Body({...d.p, w: d.R, h: d.R, r: d.R}, {frost: DROP_FROST, k: 24, z: .62});
    drops.push(d); bodies.add(d.b);
  }
  nextDrop = now + 2500;
}
// A bubble keeps its size from leaving the card to going back in. It starts tucked inside the card's edge (part of the
// card's glass, so unseen), slides out through the edge, which bulges and necks around it before it pinches off, and
// coming home slides back in the same way and is gone into the glass.
const TUCK = 80;
// every trip a bubble takes keeps one calm pace: its length sets its duration, and it eases in and out on a sine (whose
// peak is only 1.6x the average), along a path of straight legs taken as one smooth run
const PACE = 34, PACE_FAST = 110;                                       // px/s on average (fast: clearing the way for a panel)
function route(pts) {
  const legs = []; let len = 0;
  for (let i = 1; i < pts.length; i++) { const l = Math.hypot(pts[i].x - pts[i - 1].x, pts[i].y - pts[i - 1].y); legs.push(l); len += l; }
  const at = u => {
    let s = u * len;
    for (let i = 0; i < legs.length; i++) {
      if (s <= legs[i] || i === legs.length - 1) { const f = legs[i] ? clamp01(s / legs[i]) : 1; return {x: mix(pts[i].x, pts[i + 1].x, f), y: mix(pts[i].y, pts[i + 1].y, f)}; }
      s -= legs[i];
    }
  };
  return {len, at};
}
const tripMs = (len, pace = PACE) => Math.max(1500, len / pace * 1000);                                                        // how far inside the edge a tucked-in bubble sits
function budDrop(now) {
  const c = L.card, edge = c.x + c.w, d = makeDrop(0);
  const R = d.R, y = Math.min(c.y + c.h - R - TUCK, Math.max(c.y + R + TUCK, c.y + c.h * (.18 + Math.random() * .64))), out = d.out; d.y = y;
  const x0 = edge - R - TUCK;
  d.b = new Body({x: x0, y, w: R, h: R, r: R}, {frost: DROP_FROST, k: 70, z: .7});
  drops.push(d); bodies.add(d.b);
  // straight out sideways until clear of the card's edge (so it never cuts a corner), then on to its home
  const path = route([{x: x0, y}, {x: Math.max(edge + R + 12, Math.min(out.x, edge + R + 12)), y}, out]);
  tween(d.b, tripMs(path.len), t => ({...path.at(sine(t)), w: R, h: R, r: R}))
    .then(() => { if (!d.home) { d.born = performance.now(); d.b.k = 24; d.b.z = .62; d.p = {x: d.b.c.x, y: d.b.c.y}; d.v = {x: 0, y: 0}; } });
}
function ambient(now) {
  if (!seeded) seed(now);
  if (reduceMotion.matches) return;                                     // reduced motion: the beads stay put
  if (panelOpen) {
    for (const d of live()) {
      const p = d.b.c, r = panelRect, m = d.R + 30;
      const inPanel = r && p.x > r.x - m && p.x < r.x + r.w + m && p.y > r.y - m && p.y < r.y + r.h + m;
      // the panel travels from the card's edge at its row to its centre: beads near that line are in its way too
      const onRoute = r && panelFrom && distToSegment(p, panelFrom, {x: r.x + r.w / 2, y: r.y + r.h / 2}) < m + 40;
      if (inPanel || onRoute) absorb(d); else goHome(d);
    }
    return;
  }
  const n = drops.length;                                              // counting those still on their way home: never more than 5 in view
  if (n < target && now > nextDrop && !document.hidden) {
    budDrop(now);
    nextDrop = now + (n + 1 < COUNT[0] ? 700 + Math.random() * 700 : 2500 + Math.random() * 3000);
    target = COUNT[0] + Math.floor(Math.random() * (COUNT[1] - COUNT[0] + 1));
  }
  const moving = [];
  for (const d of live()) {
    if (!d.born || d.pair) continue;                                    // budding, or meeting another: tweens drive it
    if ((now - d.born) / 1000 > d.life) { goHome(d); continue; }
    moving.push(d);
  }
  float(moving, now / 1000);
  maybePair(now);
}
function distToSegment(p, a, b) {
  const vx = b.x - a.x, vy = b.y - a.y, t = clamp01(((p.x - a.x) * vx + (p.y - a.y) * vy) / (vx * vx + vy * vy || 1));
  return Math.hypot(p.x - a.x - vx * t, p.y - a.y - vy * t);
}
function absorb(d) {                                                    // taken into the panel opening over it
  if (d.pair) unpair(d);
  d.home = true; stopTweens(d.b);
  const from = {...d.b.c};
  tween(d.b, ABSORB_MS, t => { const r = mix(from.w, 0, inOut(t)); return {x: from.x, y: from.y, w: r, h: r, r}; })
    .then(() => { bodies.delete(d.b); drops.splice(drops.indexOf(d), 1); });
}
// ---- how the bubbles float: like things on slow water, not on fixed paths. They all ride one shared current that
// drifts and turns over time (so neighbours move together), with momentum and drag (bigger ones are heavier and
// slower), a weak pull back toward their own area, soft walls clear of the card and the window's edges, and a gentle
// push apart when two get close (unless they are meeting on purpose). Each also breathes very slightly.
const current = (x, y, t) => ({
  x: Math.sin(y * .0042 + t * .11) + .6 * Math.sin((x + y) * .0031 - t * .07 + 1.3) + .35 * Math.sin(x * .0057 + t * .05),
  y: Math.cos(x * .0038 - t * .09) + .6 * Math.cos((x - y) * .0027 + t * .05 + 2.1) + .35 * Math.cos(y * .0049 - t * .06),
});
let lastFloat = 0;
// visits: every so often the bubble nearest the card drifts over, touches it for a few seconds, and pulls away
let nextVisit = 0;
function visits(list, t, edge) {
  for (const d of list) {
    const v = d.visit; if (!v) continue;
    if (!v.touched && d.p.x - d.R - edge < 1) v.touched = t;              // the stay is timed from the touch
    if ((v.touched && t > v.touched + v.hold) || t > v.deadline) { d.out = v.home; d.visit = null; d.leave = t + 4; }
  }
  if (!nextVisit) nextVisit = t + 2;
  if (t < nextVisit || list.filter(d => d.visit).length >= 2) return;    // up to two at the card at once
  nextVisit = t + 3 + Math.random() * 4;
  const c = L.card, ok = list.filter(d => !d.visit && !(d.leave > t) && d.p.y > c.y + d.R * .5 && d.p.y < c.y + c.h - d.R * .5 && (t * 1000 - d.born) / 1000 < d.life - 10);
  if (!ok.length) return;
  const d = ok.reduce((a, b) => (a.p.x - a.R < b.p.x - b.R ? a : b));
  d.visit = {hold: 4 + Math.random() * 4, deadline: t + 20, touched: 0, home: d.out};
  d.out = {x: edge + d.R - 7, y: d.p.y};
}
function float(list, t) {
  const dt = Math.min(1 / 20, lastFloat ? t - lastFloat : 1 / 60); lastFloat = t;
  const edge = L.card.x + L.card.w;
  visits(list, t, edge);
  for (const d of list) {
    const mass = Math.pow(d.R / 40, 1.5), speed = 10 * Math.pow(40 / d.R, .45);
    const c = current(d.p.x, d.p.y, t), drag = .55 / Math.sqrt(mass);
    let ax = (c.x * speed - d.v.x) * drag + (d.out.x - d.p.x) * .028;
    let ay = (c.y * speed - d.v.y) * drag + (d.out.y - d.p.y) * .016;
    const wall = (v, lo, hi) => (v < lo ? (lo - v) * .9 : 0) - (v > hi ? (v - hi) * .9 : 0);
    // only a visiting bubble may touch the card; the others keep their distance
    ax += wall(d.p.x, edge + d.R + (d.visit ? -10 : 26), W - d.R - 18); ay += wall(d.p.y, d.R + 14, H - d.R - 14);
    const gap = d.p.x - d.R - edge;
    // a visit: drawn in until it touches, the card's edge reaching out to it in a liquid neck. Leaving, it is eased
    // away for a few seconds, so the neck stretches thin and snaps
    if (d.visit) ax += (d.out.x - d.p.x) * .04 - (gap > 0 ? 3 : 0), ay += (d.out.y - d.p.y) * .02;
    else if (d.leave && t < d.leave) ax += 4;
    for (const e of list) {                                             // room for each other
      if (e === d) continue;
      const dx = d.p.x - e.p.x, dy = d.p.y - e.p.y, dist = Math.hypot(dx, dy) || 1, room = d.R + e.R + 70;
      if (dist < room) { const f = (room - dist) * 1.4 / mass; ax += dx / dist * f; ay += dy / dist * f; }
    }
    d.v.x += ax * dt; d.v.y += ay * dt;
    const v = Math.hypot(d.v.x, d.v.y), vmax = speed * 2.2;                // never more than a gentle drift
    if (v > vmax) { d.v.x *= vmax / v; d.v.y *= vmax / v; }
    d.p.x += d.v.x * dt; d.p.y += d.v.y * dt;
    const rr = d.R * (1 + .015 * Math.sin(t * .6 + d.ph));
    d.b.set({x: d.p.x, y: d.p.y, w: rr, h: rr, r: rr});
  }
}
const stopTweens = body => tweens.forEach(tw => tw.body === body && tweens.delete(tw));
// carry on floating from wherever the bead is now (nothing jumps)
const rebase = d => { d.p = {x: d.b.c.x, y: d.b.c.y}; d.v = {x: 0, y: 0}; };

// ---- beads meet and part: now and then the two closest beads drift together and merge into one bigger bead (the
// material does the merging: their outlines blend), wander as one for a while, then stretch apart and split in two
let nextPair = 0;
const MEET = 3400, HOLD = 4200, PART = 3000;
async function maybePair(now) {
  if (!nextPair) nextPair = now + 25000;
  if (panelOpen || now < nextPair || drops.some(d => d.pair)) return;
  const free = drops.filter(d => d.born && !d.home && !d.pair && (now - d.born) / 1000 < d.life - 14);
  if (free.length < 2) return;
  nextPair = now + 45000 + Math.random() * 25000;                       // rare: a moment, not a habit
  let A = null, B = null, best = Infinity;
  for (let i = 0; i < free.length; i++) for (let j = i + 1; j < free.length; j++) {
    const dist = Math.hypot(free[i].b.c.x - free[j].b.c.x, free[i].b.c.y - free[j].b.c.y);
    if (dist < best) { best = dist; A = free[i]; B = free[j]; }
  }
  const pair = {A, B}; A.pair = B.pair = pair;
  const span = (MEET + HOLD + PART) / 1000 + 4;
  for (const d of [A, B]) d.life = Math.max(d.life, (now - d.born) / 1000 + span);
  const edge = L.card.x + L.card.w, rA = A.b.c.w, rB = B.b.c.w;
  const rM = Math.min(170, Math.sqrt(rA * rA + rB * rB));                // about the two beads' area together
  const fA = {...A.b.c}, fB = {...B.b.c}, ph = Math.random() * 6.28;
  const meet = {x: Math.max(edge + rM + 110, (fA.x + fB.x) / 2), y: (fA.y + fB.y) / 2};
  const drift = t => ({x: meet.x + Math.sin(t * .5 + ph) * 20, y: meet.y + Math.sin(t * .37 + ph) * 14});
  const alive = () => A.pair === pair && B.pair === pair && !A.home && !B.home;
  // meet: both slide to the meeting point (the neck forms as they near), then swell into one bead
  const meetMs = Math.max(MEET, tripMs(Math.max(Math.hypot(fA.x - meet.x, fA.y - meet.y), Math.hypot(fB.x - meet.x, fB.y - meet.y))));
  await Promise.all([[A, fA, rA], [B, fB, rB]].map(([d, f, r]) => tween(d.b, meetMs, t => {
    const p = sine(t), m = drift(0), rr = mix(r, rM, inOut(clamp01((t - .68) / .32)));
    return {x: mix(f.x, m.x, p), y: mix(f.y, m.y, p), w: rr, h: rr, r: rr};
  })));
  if (!alive()) return;
  await Promise.all([A, B].map(d => tween(d.b, HOLD, t => ({...drift(t), w: rM, h: rM, r: rM}))));   // as one
  if (!alive()) return;
  // part: stretch apart (mostly up and down, away from the card), each back to its own size; the neck thins and snaps
  const ang = Math.PI / 2 + (Math.random() - .5) * 1.1, ux = Math.cos(ang), uy = Math.sin(ang), m1 = drift(1), sep = (rA + rB + 80) / 2;
  await Promise.all([[A, rA, 1], [B, rB, -1]].map(([d, r, side]) => tween(d.b, Math.max(PART, tripMs(sep)), t => {
    const p = sine(t), rr = mix(rM, r, inOut(clamp01(t / .55)));
    return {x: m1.x + ux * side * sep * p, y: m1.y + uy * side * sep * p, w: rr, h: rr, r: rr};
  })));
  if (!alive()) return;
  for (const d of [A, B]) { d.pair = null; rebase(d); }
}

function unpair(d) {                                                    // leaving mid-meeting: the other carries on alone
  const other = d.pair.A === d ? d.pair.B : d.pair.A;
  d.pair = null; stopTweens(d.b);
  if (!other.home) { other.pair = null; stopTweens(other.b); rebase(other); other.b.set({w: other.R, h: other.R, r: other.R}); }
}
function goHome(d) {
  if (d.home) return;
  if (d.pair) unpair(d);
  stopTweens(d.b);
  d.home = true;
  const b = d.b, from = {...b.c}, R = d.R, c = L.card, edge = c.x + c.w;
  const ty = Math.min(c.y + c.h - R - TUCK, Math.max(c.y + R + TUCK, from.y)), tx = edge - R - TUCK;   // back in beside where it is
  // level with where it goes in while still clear of the edge, then straight in sideways
  const path = route([from, {x: Math.max(from.x, edge + R + 12), y: ty}, {x: tx, y: ty}]);
  tween(b, tripMs(path.len, panelOpen ? PACE_FAST : PACE), t => {
    const r = mix(from.w, R, clamp01(t * 4));                           // (a merged pair settles back to its own size)
    return {...path.at(sine(t)), w: r, h: r, r};
  }).then(() => {
    bodies.delete(b); drops.splice(drops.indexOf(d), 1);
  });
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
const sine = t => .5 - .5 * Math.cos(Math.PI * t);                      // gentle in and out (peak speed 1.6x the average)
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
      bodies.delete(b); panelOpen--; panelRect = panelFrom = null; nextDrop = performance.now() + 500; poke();
    },
  };
  // one path: bud out of the edge, pinch off and travel, inflate into the panel — each phase flowing into the next
  await tween(b, 900, t => {
    const q = inOut(clamp01(t / .62)), inflate = inOut(clamp01((t - .36) / .64));
    const drop = 16 + 26 * out3(clamp01(t / .4));
    const w = mix(drop, R.w / 2, inflate), h = mix(drop, R.h / 2, inflate);
    return {x: mix(point.x - 26, cx, q), y: mix(point.y, cy, q), w, h, r: Math.min(w, h, mix(drop, PANEL_R, inflate))};
  });
  b.k = 200; b.z = .55;                                                 // looser at the end: it wobbles as it settles
  await until(() => b.settled(6));
  return handle;
};



const px1 = new Uint8Array(4);
// the cost of one full render of a fixed scene: the card and exactly `beads` beads (everything else set aside)
// the GPU cost of one full render (the GPU's own timer where available, else wall time): of a fixed scene (the card
// and exactly `beads` test bubbles), or with beads < 0 of the page as it is. frost: share of frames that redo the frost
Liquid.bench = (n = 60, beads = -1, frost = .5) => {
  const was = Liquid.active; Liquid.active = false; if (raf) cancelAnimationFrame(raf); raf = 0;   // the page loop pauses
  const kept = [...bodies];
  if (beads >= 0) { bodies.clear(); bodies.add(card); }
  for (let i = 0; i < beads; i++) { const r = 18 + (i % 4) * 16; bodies.add(new Body({x: L.card.x + L.card.w + 140 + (i % 3) * 190, y: 110 + i * 85, w: r, h: r, r}, {frost: .35})); }
  render(); gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
  const tq = gl.getExtension('EXT_disjoint_timer_query_webgl2'), qs = [], t0 = performance.now();
  for (let i = 0; i < n; i++) {
    sceneDirty = frost >= 1 || (frost > 0 && i % Math.round(1 / frost) === 0);
    const q = tq && gl.createQuery(); if (q) gl.beginQuery(tq.TIME_ELAPSED_EXT, q);
    render();
    if (q) { gl.endQuery(tq.TIME_ELAPSED_EXT); qs.push(q); }
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, px1);
  }
  let ms = (performance.now() - t0) / n;
  const gpu = qs.filter(q => gl.getQueryParameter(q, gl.QUERY_RESULT_AVAILABLE)).map(q => gl.getQueryParameter(q, gl.QUERY_RESULT) / 1e6).sort((x, y) => x - y);
  qs.forEach(q => gl.deleteQuery(q));
  if (tq && gpu.length > n / 2 && !gl.getParameter(tq.GPU_DISJOINT_EXT)) ms = gpu[gpu.length >> 1];
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
    drops = []; panelOpen = 0; seeded = false;
    if (raf) cancelAnimationFrame(raf); raf = 0;
    dispatchEvent(new Event('resize'));                                // frame.js puts its Hyalite glass back
  }
}
addEventListener('resize', () => { layout(); poke(); });
for (const q of [wideQuery, reduceTransparency]) q.addEventListener('change', update);
document.fonts?.ready.then(() => { layout(); poke(); });
update();
