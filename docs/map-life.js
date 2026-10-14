// The living city: layers that sit on the survey map and move with it.
//   Elevation  hillshade lit by the hour, contour lines, and a readout under the cursor
//   Mana       blue light leaving the Wells along the Lattice
//   Silt       spent mana shed where implants burn, running downhill into the Downflow and the Sump
//   The Sage   a presence over the Silvershade Well that now and then moves the city
//   Sky        the hour, the weather, lit windows, and the 3:10 night freight
// The geography lives in data/neonix-flows.json; this file only draws it.

const NS = 'http://www.w3.org/2000/svg';
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const svg = (tag, attrs = {}, parent) => { const el = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v)); parent?.append(el); return el; };
const pathD = pts => 'M' + pts.map(p => p[0].toFixed(1) + ',' + p[1].toFixed(1)).join('L');

function inside([x, y], poly) {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if ((yi > y) !== (yj > y) && x < (xj - xi) * (y - yi) / (yj - yi) + xi) hit = !hit;
  }
  return hit;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return [Math.hypot(px - ax - t * dx, py - ay - t * dy), t];
}
function edgeDistance(p, poly) {
  let d = Infinity;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) d = Math.min(d, segDist(p[0], p[1], poly[j][0], poly[j][1], poly[i][0], poly[i][1])[0]);
  return d;
}
function makeNoise(seed) {
  const hash = (x, y) => { let h = Math.imul(x, 374761393) + Math.imul(y, 668265263) + Math.imul(seed, 982451653); h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const noise = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    return lerp(lerp(hash(xi, yi), hash(xi + 1, yi), u), lerp(hash(xi, yi + 1), hash(xi + 1, yi + 1), u), v);
  };
  return (x, y) => { let s = 0, a = 0.5, f = 1; for (let o = 0; o < 4; o++) { s += a * noise(x * f, y * f); f *= 2.03; a *= 0.5; } return s / 0.9375; };
}
const pickWeighted = (weights, rnd = Math.random) => {
  const entries = Object.entries(weights).filter(([, w]) => w > 0);
  let r = rnd() * entries.reduce((s, [, w]) => s + w, 0);
  for (const [k, w] of entries) if ((r -= w) <= 0) return k;
  return entries.at(-1)?.[0];
};

// ---------- terrain ----------

export function buildTerrain(spec, districts) {
  const [x0, y0, x1, y1] = spec.bounds, g = spec.grid;
  const nx = Math.round((x1 - x0) / g) + 1, ny = Math.round((y1 - y0) / g) + 1;
  const fbm = makeNoise(spec.noise.seed);
  const { high, low, drop, clamp: [c0, c1] } = spec.tilt;
  const dx = low[0] - high[0], dy = low[1] - high[1], dd = dx * dx + dy * dy;
  const plateaus = spec.features.filter(f => f.kind === 'plateau').map(f => ({ ...f, poly: f.polygon || districts.find(d => d.id === f.district)?.points })).filter(f => f.poly);
  const hills = spec.features.filter(f => f.kind === 'hill');
  const height = (x, y) => {
    let h = drop * (1 - clamp(((x - high[0]) * dx + (y - high[1]) * dy) / dd, c0, c1));
    for (const f of plateaus) h += f.rise * smooth(f.edge[0], f.edge[1], edgeDistance([x, y], f.poly) * (inside([x, y], f.poly) ? 1 : -1));
    for (const f of hills) { const ex = x - f.center[0], ey = y - f.center[1]; h += f.rise * Math.exp(-(ex * ex + ey * ey) / (f.radius * f.radius)); }
    return h + spec.noise.amplitude * (fbm(x / spec.noise.scale, y / spec.noise.scale) * 2 - 1);
  };
  const H = new Float32Array(nx * ny);
  let min = Infinity, max = -Infinity;
  for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const v = height(x0 + i * g, y0 + j * g); H[j * nx + i] = v; if (v < min) min = v; if (v > max) max = v; }
  const at = (x, y) => {
    const fx = clamp((x - x0) / g, 0, nx - 1.001), fy = clamp((y - y0) / g, 0, ny - 1.001), i = Math.floor(fx), j = Math.floor(fy), u = fx - i, v = fy - j, k = j * nx + i;
    return lerp(lerp(H[k], H[k + 1], u), lerp(H[k + nx], H[k + nx + 1], u), v);
  };
  const grad = (x, y) => [(at(x + g, y) - at(x - g, y)) / (2 * g), (at(x, y + g) - at(x, y - g)) / (2 * g)];
  return { x0, y0, g, nx, ny, w: (nx - 1) * g, h: (ny - 1) * g, H, min, max, at, grad };
}

// Marching squares, joined into lines and softened.
export function contourLines(T, interval, step = 2, win = [-140, -110, 1340, 960]) {
  const sx = Math.floor((T.nx - 1) / step) + 1, sy = Math.floor((T.ny - 1) / step) + 1;
  const V = (i, j) => T.H[j * step * T.nx + i * step], X = i => T.x0 + i * step * T.g, Y = j => T.y0 + j * step * T.g;
  const out = [];
  for (let L = Math.ceil(T.min / interval) * interval; L <= T.max; L += interval) {
    const adj = new Map(), pts = new Map();
    const hid = (i, j) => (j * sx + i) * 2, vid = (i, j) => (j * sx + i) * 2 + 1;
    const link = (a, b) => { (adj.get(a) || adj.set(a, []).get(a)).push(b); (adj.get(b) || adj.set(b, []).get(b)).push(a); };
    for (let j = 0; j < sy - 1; j++) for (let i = 0; i < sx - 1; i++) {
      if (X(i) < win[0] || X(i) > win[2] || Y(j) < win[1] || Y(j) > win[3]) continue;
      const c = (V(i, j) > L ? 8 : 0) | (V(i + 1, j) > L ? 4 : 0) | (V(i + 1, j + 1) > L ? 2 : 0) | (V(i, j + 1) > L ? 1 : 0);
      if (!c || c === 15) continue;
      const t = hid(i, j), b = hid(i, j + 1), l = vid(i, j), r = vid(i + 1, j);
      switch (c) {
        case 1: case 14: link(l, b); break;
        case 2: case 13: link(b, r); break;
        case 3: case 12: link(l, r); break;
        case 4: case 11: link(t, r); break;
        case 6: case 9: link(t, b); break;
        case 7: case 8: link(l, t); break;
        case 5: link(t, r); link(l, b); break;
        case 10: link(l, t); link(b, r); break;
      }
    }
    const point = id => {
      if (pts.has(id)) return pts.get(id);
      const k = id >> 1, i = k % sx, j = (k - i) / sx;
      let p;
      if (id & 1) { const a = V(i, j), b = V(i, j + 1); p = [X(i), Y(j) + (L - a) / (b - a) * (Y(j + 1) - Y(j))]; }
      else { const a = V(i, j), b = V(i + 1, j); p = [X(i) + (L - a) / (b - a) * (X(i + 1) - X(i)), Y(j)]; }
      pts.set(id, p);
      return p;
    };
    const seen = new Set(), lines = [];
    const walk = start => {
      const line = [start]; seen.add(start);
      let prev = -1, cur = start;
      for (;;) {
        const nb = adj.get(cur) || [], next = nb.find(n => n !== prev && !seen.has(n));
        if (next === undefined) { if (line.length > 2 && nb.includes(start)) line.push(start); break; }
        line.push(next); seen.add(next); prev = cur; cur = next;
      }
      return line;
    };
    for (const [id, nb] of adj) if (nb.length === 1 && !seen.has(id)) lines.push(walk(id));
    for (const id of adj.keys()) if (!seen.has(id)) lines.push(walk(id));
    out.push({ level: L, lines: lines.filter(l => l.length > 3).map(l => chaikin(chaikin(l.map(point)))) });
  }
  return out;
}
function chaikin(p) {
  if (p.length < 3) return p;
  const closed = p[0] === p.at(-1) || (p[0][0] === p.at(-1)[0] && p[0][1] === p.at(-1)[1]);
  const out = closed ? [] : [p[0]];
  for (let i = 0; i < p.length - 1; i++) {
    const [ax, ay] = p[i], [bx, by] = p[i + 1];
    out.push([ax * 0.75 + bx * 0.25, ay * 0.75 + by * 0.25], [ax * 0.25 + bx * 0.75, ay * 0.25 + by * 0.75]);
  }
  if (closed) out.push(out[0]); else out.push(p.at(-1));
  return out;
}

// ---------- polylines ----------

function polyline(points) {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]));
  const length = cum.at(-1);
  const at = s => {
    s = clamp(s, 0, length);
    let i = 1;
    while (i < cum.length - 1 && cum[i] < s) i++;
    const t = (s - cum[i - 1]) / (cum[i] - cum[i - 1] || 1), a = points[i - 1], b = points[i];
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  const nearest = (x, y) => {
    let best = [Infinity, 0];
    for (let i = 1; i < points.length; i++) {
      const [d, t] = segDist(x, y, points[i - 1][0], points[i - 1][1], points[i][0], points[i][1]);
      if (d < best[0]) best = [d, cum[i - 1] + t * (cum[i] - cum[i - 1])];
    }
    return best;
  };
  return { points, length, at, nearest };
}

// ---------- sky ----------

const AMBIENT = [[0, [.19, .23, .40]], [4.5, [.21, .25, .42]], [5.8, [.55, .45, .56]], [6.8, [.95, .74, .64]], [8, [1, .97, .92]], [12, [1, 1, 1]], [16.5, [1, .96, .89]], [18.3, [.98, .70, .56]], [19.4, [.62, .45, .56]], [20.6, [.27, .28, .47]], [24, [.19, .23, .40]]];
function ambientAt(h) {
  for (let i = 1; i < AMBIENT.length; i++) if (h <= AMBIENT[i][0]) {
    const [h0, a] = AMBIENT[i - 1], [h1, b] = AMBIENT[i], t = smooth(0, 1, (h - h0) / (h1 - h0));
    return a.map((v, k) => lerp(v, b[k], t));
  }
  return AMBIENT[0][1];
}
const nightAt = h => (h < 12 ? 1 - smooth(5.2, 7.2, h) : smooth(17.6, 20.2, h));
const phaseAt = h => (h >= 5 && h < 7.5 ? 'DAWN' : h >= 7.5 && h < 17.5 ? 'DAY' : h >= 17.5 && h < 20.5 ? 'DUSK' : 'NIGHT');
function sunAt(h) {
  const day = (h - 6) / 12;
  if (day > 0 && day < 1) {
    const th = day * Math.PI, e = lerp(0.12, 1.05, Math.sin(th));
    return { v: [Math.cos(e) * Math.cos(th), Math.cos(e) * Math.sin(th), Math.sin(e)], strength: smooth(0, 0.08, day) * smooth(1, 0.92, day) };
  }
  const e = 0.6;
  return { v: [Math.cos(e) * -0.6, Math.cos(e) * 0.8, Math.sin(e)], strength: 0.3 };
}
const clock = h => { const m = Math.round(((h % 24) + 24) % 24 * 60) % 1440; return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0'); };
const WEATHER = {
  clear: { rain: 0, fog: 0.04, cloud: 0, wind: [0.35, 0.08], label: 'CLEAR SKIES' },
  rain: { rain: 0.5, fog: 0.12, cloud: 0.7, wind: [0.6, 0.2], label: 'RAIN' },
  fog: { rain: 0, fog: 0.9, cloud: 0.5, wind: [0.15, 0.05], label: 'FOG IN THE LOW STREETS' },
  storm: { rain: 1, fog: 0.15, cloud: 1, wind: [1.15, 0.35], label: 'STORM' },
};
const NEXT_WEATHER = { clear: { rain: 0.45, fog: 0.4, storm: 0.15 }, rain: { clear: 0.4, storm: 0.3, fog: 0.3 }, storm: { rain: 0.7, clear: 0.3 }, fog: { clear: 0.6, rain: 0.4 } };
const compass = (x, y) => ['E', 'SE', 'S', 'SW', 'W', 'NW', 'N', 'NE'][Math.round(((Math.atan2(y, x) + Math.PI * 2) % (Math.PI * 2)) / (Math.PI / 4)) % 8];

// ---------- the atmosphere shader: the Sage, fog, haze, the Veil, the Hum, blooms, lightning ----------

const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FRAG = `
precision mediump float;
uniform vec2 u_res; uniform vec4 u_view; uniform float u_time;
uniform vec2 u_well; uniform float u_sageR; uniform vec2 u_gaze; uniform float u_pulse; uniform float u_heard; uniform float u_sage;
uniform vec2 u_leaf; uniform float u_leafOn; uniform vec2 u_hum; uniform vec3 u_bloom; uniform vec2 u_veil;
uniform float u_night; uniform float u_fog; uniform vec2 u_wind; uniform float u_flash; uniform float u_haze;
uniform sampler2D u_height; uniform vec4 u_hbox; uniform vec2 u_hrange;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){ vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y); }
float fbm(vec2 p){ float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6); for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= .5; } return v; }
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  vec2 css = vec2(gl_FragCoord.x, u_res.y - gl_FragCoord.y) / u_view.w;
  vec2 m = (css - u_view.yz) / u_view.x;
  float t = u_time;
  vec3 col = vec3(0.);
  float h = mix(u_hrange.x, u_hrange.y, texture2D(u_height, clamp((m - u_hbox.xy) / u_hbox.zw, 0., 1.)).r);
  float low = smoothstep(60., -10., h);
  float hz = fbm(m * .006 + vec2(t * .012, t * .004));
  col += vec3(.30, .25, .42) * low * low * (.3 + .7 * hz) * u_haze;
  if (u_fog > .002) {
    float f = smoothstep(.32, .85, fbm(m * .0042 + u_wind * t * .018 + vec2(3.1, 1.7)));
    col += mix(vec3(.50, .57, .63), vec3(.17, .21, .29), u_night) * u_fog * f * (.4 + .8 * low);
  }
  { vec2 d = (m - u_veil) / 62.; float r = length(d);
    if (r < 2.2) col += vec3(.42, .52, .58) * exp(-r * r * 1.5) * smoothstep(.3, .8, fbm(d * 2.4 + vec2(t * .05, -t * .03))) * .6; }
  vec2 sp = (m - u_well - u_gaze) / u_sageR;
  if (u_sage > .001 && length(sp) < 2.6) {
    vec2 p = sp; float r = length(p);
    vec2 q = rot(t * .05 + .9 / (r + .25)) * p;
    vec2 w = vec2(fbm(q * 2.2 + t * .04), fbm(q * 2.2 - t * .05 + 5.2));
    float f = fbm(q * 1.8 + 1.8 * w);
    float wisps = pow(1. - abs(f * 2. - 1.), 6.);
    float mask = exp(-r * r * 1.6);
    float cr = .07 + .03 * u_pulse + .03 * u_heard;
    col += vec3(.25, .66, 1.) * (wisps * .9 + smoothstep(.45, .9, f) * .25) * mask * (.42 + .35 * u_pulse + .45 * u_heard + .35 * u_night) * u_sage;
    col += vec3(.84, .94, 1.) * exp(-r * r / (cr * cr)) * (.45 + .6 * u_pulse + .5 * u_heard) * u_sage;
  }
  vec2 pl = (m - u_leaf) / (u_sageR * .42); float rl = length(pl);
  if (u_sage > .001 && u_leafOn > .01 && rl < 2.4) {
    float fl = fbm(rot(t * .07 + .6 / (rl + .3)) * pl * 2.4 + t * .05);
    col += vec3(.25, .66, 1.) * pow(1. - abs(fl * 2. - 1.), 6.) * exp(-rl * rl * 1.8) * .55 * u_leafOn * u_sage;
    col += vec3(.84, .94, 1.) * exp(-rl * rl / .006) * .35 * u_leafOn * u_sage;
  }
  if (u_hum.y > 0.) { float d = length(m - u_well); float ring = exp(-pow((d - u_hum.x) / 24., 2.)); if (ring > .01) col += vec3(.5, .8, 1.) * ring * u_hum.y * (.55 + .45 * fbm(m * .03 + t)); }
  if (u_bloom.z > 0. && length(m - u_bloom.xy) < 180.) { vec2 d = (m - u_bloom.xy) / 70.; float r = length(d), a = atan(d.y, d.x);
    float petals = .55 + .45 * sin(a * 7. + t * 1.5 + fbm(d * 3.) * 4.);
    col += mix(vec3(.4, .55, 1.), vec3(.85, .5, 1.), petals) * exp(-r * r * 2.2) * petals * u_bloom.z; }
  col += vec3(.55, .6, .78) * u_flash;
  col += (hash(gl_FragCoord.xy + fract(t * 7.) * 91.) - .5) * .012;
  gl_FragColor = vec4(max(col, 0.), 1.);
}`;

function startAtmosphere(canvas, T) {
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  if (!gl) return null;
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return null;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return null;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  // Height as a texture, so fog and haze can pool in the low streets.
  const bytes = new Uint8Array(T.nx * T.ny);
  for (let k = 0; k < bytes.length; k++) bytes[k] = Math.round(255 * (T.H[k] - T.min) / (T.max - T.min));
  gl.bindTexture(gl.TEXTURE_2D, gl.createTexture());
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.LUMINANCE, T.nx, T.ny, 0, gl.LUMINANCE, gl.UNSIGNED_BYTE, bytes);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const U = {};
  for (const n of ['res', 'view', 'time', 'well', 'sageR', 'gaze', 'pulse', 'heard', 'sage', 'leaf', 'leafOn', 'hum', 'bloom', 'veil', 'night', 'fog', 'wind', 'flash', 'haze', 'height', 'hbox', 'hrange']) U[n] = gl.getUniformLocation(prog, 'u_' + n);
  gl.uniform1i(U.height, 0);
  gl.uniform4f(U.hbox, T.x0, T.y0, T.w, T.h);
  gl.uniform2f(U.hrange, T.min, T.max);
  return {
    draw(u) {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.uniform2f(U.res, canvas.width, canvas.height);
      gl.uniform4f(U.view, u.s, u.tx, u.ty, u.px);
      gl.uniform1f(U.time, u.time);
      gl.uniform2f(U.well, ...u.well); gl.uniform1f(U.sageR, u.sageR); gl.uniform2f(U.gaze, ...u.gaze);
      gl.uniform1f(U.pulse, u.pulse); gl.uniform1f(U.heard, u.heard); gl.uniform1f(U.sage, u.sage);
      gl.uniform2f(U.leaf, ...u.leaf); gl.uniform1f(U.leafOn, u.leafOn);
      gl.uniform2f(U.hum, u.hum[0], u.hum[1]); gl.uniform3f(U.bloom, ...u.bloom); gl.uniform2f(U.veil, ...u.veil);
      gl.uniform1f(U.night, u.night); gl.uniform1f(U.fog, u.fog); gl.uniform2f(U.wind, ...u.wind);
      gl.uniform1f(U.flash, u.flash); gl.uniform1f(U.haze, u.haze);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
  };
}

// ---------- bring it to life ----------

let flowsRequest = null;
const loadFlows = () => (flowsRequest ??= fetch('data/neonix-flows.json').then(r => { if (!r.ok) throw Error('flows'); return r.json(); }).catch(e => { flowsRequest = null; throw e; }));

export function bringToLife({ container, stage, mapEl, group, layout, byId, reduced }) {
  let dead = false, raf = 0;
  const cleanups = [];
  const on = (node, ev, fn, opts) => { node.addEventListener(ev, fn, opts); cleanups.push(() => node.removeEventListener(ev, fn, opts)); };
  const destroy = () => { dead = true; if (raf) cancelAnimationFrame(raf); cleanups.forEach(f => f()); };
  loadFlows().then(flows => { if (!dead) build(flows); }).catch(() => {});
  return { destroy };

  function build(F) {
    const districts = layout.districts;
    const T = buildTerrain(F.terrain, districts);
    const name = id => byId.get(id)?.name || id;
    const districtAt = p => districts.find(d => inside(p, d.points))?.id || null;
    const wells = new Map(F.wells.map(w => [w.id, w]));
    const sageWell = wells.get(F.sage.well);
    for (const k of ['elevation', 'mana', 'silt', 'sage']) if (!stage.dataset[k]) stage.dataset[k] = 'on';
    const layer = k => stage.dataset[k] !== 'off';

    // ----- static layers inside the map, so they pan and zoom with it -----
    const before = sel => group.querySelector(sel);
    const contours = svg('g', { class: 'life-contours', fill: 'none' });
    group.insertBefore(contours, before('.atlas-roads'));
    for (const { level, lines } of contourLines(T, F.terrain.contourInterval)) {
      const major = level % F.terrain.indexContour === 0;
      const d = lines.map(pathD).join('');
      if (d) svg('path', { d, class: major ? 'contour major' : level < 0 ? 'contour below' : 'contour' }, contours);
      if (major && level > 0) {
        const longest = lines.filter(l => l.some(p => p[0] > 60 && p[0] < 1140 && p[1] > 40 && p[1] < 820)).sort((a, b) => b.length - a.length)[0];
        if (longest) {
          const inCity = longest.filter(p => p[0] > 120 && p[0] < 1100 && p[1] > 60 && p[1] < 800);
          const p = (inCity.length ? inCity : longest)[Math.floor((inCity.length ? inCity : longest).length / 2)];
          svg('text', { x: p[0].toFixed(1), y: p[1].toFixed(1), class: 'contour-label' }, contours).textContent = level + ' m';
        }
      }
    }
    const hypso = svg('image', { class: 'life-hypso', x: T.x0, y: T.y0, width: T.w, height: T.h, preserveAspectRatio: 'none' });
    group.insertBefore(hypso, contours);
    {
      const RAMP = [[-50, [74, 58, 106]], [-10, [61, 58, 92]], [20, [32, 57, 74]], [80, [36, 80, 90]], [150, [47, 100, 96]], [210, [76, 122, 92]], [260, [126, 154, 106]], [310, [176, 184, 138]]];
      const c = document.createElement('canvas'); c.width = T.nx; c.height = T.ny;
      const cx = c.getContext('2d'), im = cx.createImageData(T.nx, T.ny), d = im.data;
      for (let j = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++) {
        const k = j * T.nx + i, h = T.H[k];
        let a = RAMP[0][1], b = RAMP[0][1], t = 0;
        for (let r = 1; r < RAMP.length; r++) if (h <= RAMP[r][0] || r === RAMP.length - 1) { a = RAMP[r - 1][1]; b = RAMP[r][1]; t = clamp((h - RAMP[r - 1][0]) / (RAMP[r][0] - RAMP[r - 1][0]), 0, 1); break; }
        const x = T.x0 + i * T.g, y = T.y0 + j * T.g, far = Math.hypot((x - 640) / 760, (y - 430) / 560);
        d[k * 4] = lerp(a[0], b[0], t); d[k * 4 + 1] = lerp(a[1], b[1], t); d[k * 4 + 2] = lerp(a[2], b[2], t);
        d[k * 4 + 3] = 255 * smooth(1.15, 0.75, far);
      }
      cx.putImageData(im, 0, 0);
      hypso.setAttribute('href', c.toDataURL('image/png'));
    }
    const flowsG = svg('g', { class: 'life-flows' });
    const support = before('.atlas-support-group');
    group.insertBefore(flowsG, support);
    const railG = svg('g', { class: 'life-rail' }, flowsG);
    svg('title', {}, railG).textContent = `${F.freight.name}. ${F.freight.note}`;
    svg('path', { d: pathD(F.freight.points), class: 'rail-bed' }, railG);
    svg('path', { d: pathD(F.freight.points), class: 'rail-ties' }, railG);
    const downflow = svg('g', { class: 'life-downflow' }, flowsG);
    for (const dr of F.downflow) { const g = svg('g', { 'data-drain': dr.id }, downflow); svg('title', {}, g).textContent = `${dr.name}: part of the Downflow, Gilda Rockfounder's drains. Empties into ${dr.to === 'sump' ? 'the Sump' : 'the Boneyard'}.`; svg('path', { d: pathD(dr.points), class: 'drain-bed' }, g); svg('path', { d: pathD(dr.points), class: 'drain-run' }, g); }
    const sumpG = svg('g', { class: 'life-sump' }, flowsG);
    for (const o of Object.values(F.outfalls)) { const g = svg('g', {}, sumpG); svg('title', {}, g).textContent = `${o.name}. ${o.note}`; svg('ellipse', { cx: o.point[0], cy: o.point[1], rx: o.radius[0], ry: o.radius[1], class: 'sump-pool' }, g); }
    const lattice = svg('g', { class: 'life-lattice' }, flowsG);
    for (const c of F.lattice) { const g = svg('g', {}, lattice); svg('title', {}, g).textContent = `${c.name}: mana from ${wells.get(c.from).name} to ${name(c.to)}.`; svg('path', { d: pathD(c.points), class: 'conduit', 'stroke-width': (0.8 + c.weight * 1.4).toFixed(2) }, g); }
    const wellsG = svg('g', { class: 'life-wells' }, flowsG);
    for (const w of F.wells) {
      const g = svg('g', { class: 'well' + (w.dry ? ' dry' : '') + (w.id === sageWell.id ? ' sage-well' : ''), 'data-well': w.id }, wellsG);
      svg('title', {}, g).textContent = `${w.name}. ${w.note}`;
      for (let r = 3; r >= 1; r--) svg('ellipse', { cx: w.point[0], cy: w.point[1], rx: (5 + r * 4.5) * (w.strength ? 0.6 + w.strength * 0.5 : 0.8), ry: (3 + r * 2.6) * (w.strength ? 0.6 + w.strength * 0.5 : 0.8), class: 'well-ring' }, g);
      svg('circle', { cx: w.point[0], cy: w.point[1], r: w.dry ? 2.2 : 3, class: 'well-eye' }, g);
    }
    const shade = svg('image', { class: 'life-shade', x: T.x0, y: T.y0, width: T.w, height: T.h, preserveAspectRatio: 'none' });
    group.insertBefore(shade, support);
    const labels = svg('g', { class: 'life-labels' }, group);
    for (const w of F.wells) svg('text', { x: w.point[0], y: w.point[1] + (w.id === 'leafgold' ? -14 : 19), class: 'life-label' + (w.dry ? ' dry' : '') }, labels).textContent = w.name.replace(/^The /, '').toUpperCase();
    const sump = F.outfalls.sump;
    svg('text', { x: sump.point[0], y: sump.point[1] + 3, class: 'life-label sump-label' }, labels).textContent = 'THE SUMP ↓';

    // ----- controls -----
    const layersBar = container.querySelector('.atlas-layers');
    const hint = layersBar?.querySelector('small');
    for (const [id, label] of [['elevation', 'Elevation'], ['mana', 'Mana'], ['silt', 'Silt'], ['sage', 'The Sage']]) {
      const l = document.createElement('label'); l.className = 'life-layer';
      l.innerHTML = `<input type="checkbox" data-map-layer="${id}" ${layer(id) ? 'checked' : ''}>${label}`;
      layersBar?.insertBefore(l, hint);
    }
    const sky = document.createElement('div');
    sky.className = 'atlas-sky';
    sky.innerHTML = `<div class="sky-time" role="group" aria-label="Time of day">
        <button type="button" class="sky-play" aria-pressed="true" title="Let time pass"><span aria-hidden="true">❚❚</span><span class="sr-only">Pause time</span></button>
        <output class="sky-clock">19:30</output>
        <input class="sky-slider" type="range" min="0" max="1435" step="5" aria-label="Time of day">
        <button type="button" class="sky-now" title="Jump to your own local time">Now</button>
      </div>
      <div class="sky-weather" role="radiogroup" aria-label="Weather">${[['auto', 'Changing'], ['clear', 'Clear'], ['rain', 'Rain'], ['fog', 'Fog'], ['storm', 'Storm']].map(([w, l]) => `<button type="button" role="radio" data-weather="${w}" aria-checked="${w === 'auto'}">${l}</button>`).join('')}</div>`;
    layersBar?.after(sky);
    const key = container.querySelector('.atlas-key');
    key?.insertAdjacentHTML('beforeend', '<span class="life-key"><i class="key-mana"></i>Mana / the Lattice</span><span class="life-key"><i class="key-silt"></i>Silt / the Downflow</span><span class="life-key"><i class="key-well"></i>Wells</span>');
    const readout = document.createElement('div');
    readout.className = 'atlas-sky-readout';
    readout.innerHTML = '<span class="sky-r-time"></span><span class="sky-r-weather"></span><span class="sky-r-elev"></span>';
    stage.append(readout);
    const ticker = document.createElement('div');
    ticker.className = 'atlas-sage-ticker';
    ticker.setAttribute('role', 'status');
    stage.append(ticker);
    cleanups.push(() => { sky.remove(); readout.remove(); ticker.remove(); container.querySelectorAll('.life-layer,.life-key').forEach(n => n.remove()); });

    // ----- canvases above the map -----
    const atmoCanvas = document.createElement('canvas');
    atmoCanvas.className = 'life-atmosphere'; atmoCanvas.setAttribute('aria-hidden', 'true');
    const fxCanvas = document.createElement('canvas');
    fxCanvas.className = 'life-fx'; fxCanvas.setAttribute('aria-hidden', 'true');
    mapEl.after(atmoCanvas, fxCanvas);
    cleanups.push(() => { atmoCanvas.remove(); fxCanvas.remove(); });
    const atmo = startAtmosphere(atmoCanvas, T);
    if (!atmo) atmoCanvas.remove();
    const fx = fxCanvas.getContext('2d');
    let cssW = 0, cssH = 0, dpr = 1;
    const resize = () => {
      cssW = mapEl.clientWidth; cssH = mapEl.clientHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
      fxCanvas.width = Math.max(2, Math.round(cssW * dpr)); fxCanvas.height = Math.max(2, Math.round(cssH * dpr));
      const a = Math.min(window.devicePixelRatio || 1, 1.5) * 0.6;
      atmoCanvas.width = Math.max(2, Math.round(cssW * a)); atmoCanvas.height = Math.max(2, Math.round(cssH * a));
      sizeParticles();
      if (reduced) paint(performance.now());
    };

    // ----- state -----
    const S = {
      hour: reduced ? 21.5 : 19.5, mode: reduced ? 'still' : 'lapse',
      weatherMode: 'auto', weather: reduced ? 'clear' : 'rain', nextWeather: 0,
      rain: 0, fog: 0, cloud: 0, wind: [0.5, 0.15],
      shadeKey: '', shadeAt: 0,
      events: [], nextEvent: 9, routed: null, flash: 0, nextStrike: 4, bolt: null,
      pulse: 0, heard: 0, nextBeat: 1, beatAt: -99, gaze: [0, 0], gazeTarget: [0, 0],
      t: 0, last: performance.now(), freightOn: false, visible: true, pointer: null,
    };
    const W = () => WEATHER[S.weather];
    if (!reduced) { const w = W(); S.rain = w.rain; S.fog = w.fog; S.cloud = w.cloud; S.wind = [...w.wind]; S.nextWeather = 70 + Math.random() * 60; }

    // ----- day, night and terrain shading, painted into the map -----
    const normals = new Float32Array(T.nx * T.ny * 3);
    for (let j = 0; j < T.ny; j++) for (let i = 0; i < T.nx; i++) {
      const k = j * T.nx + i, ex = 0.8;
      const dzx = (T.H[j * T.nx + Math.min(i + 1, T.nx - 1)] - T.H[j * T.nx + Math.max(i - 1, 0)]) / (2 * T.g) * ex;
      const dzy = (T.H[Math.min(j + 1, T.ny - 1) * T.nx + i] - T.H[Math.max(j - 1, 0) * T.nx + i]) / (2 * T.g) * ex;
      const l = Math.hypot(dzx, dzy, 1);
      normals[k * 3] = -dzx / l; normals[k * 3 + 1] = -dzy / l; normals[k * 3 + 2] = 1 / l;
    }
    const shadeCanvas = document.createElement('canvas');
    shadeCanvas.width = T.nx; shadeCanvas.height = T.ny;
    const sctx = shadeCanvas.getContext('2d');
    const img = sctx.createImageData(T.nx, T.ny);
    function paintShade() {
      const amb = ambientAt(S.hour), sun = sunAt(S.hour), relief = layer('elevation');
      const cloud = S.cloud, strength = sun.strength * (1 - 0.7 * cloud) * (relief ? 1 : 0);
      const dim = 1 - 0.16 * cloud;
      const [lx, ly, lz] = sun.v;
      const d = img.data;
      for (let k = 0, n = T.nx * T.ny; k < n; k++) {
        const nx = normals[k * 3], ny = normals[k * 3 + 1], nz = normals[k * 3 + 2], h = T.H[k];
        const rel = Math.max(0, nx * lx + ny * ly + nz * lz) - lz;
        const light = clamp(0.92 + rel * 1.35 * strength, 0.5, 1) * (relief ? 0.9 + 0.1 * smooth(-10, 250, h) : 1);
        const low = relief ? smooth(45, -12, h) * 0.18 : 0;
        d[k * 4] = 255 * clamp(amb[0] * light * dim * (1 - low * 0.9), 0, 1);
        d[k * 4 + 1] = 255 * clamp(amb[1] * light * dim * (1 - low), 0, 1);
        d[k * 4 + 2] = 255 * clamp(amb[2] * light * dim * (1 - low * 0.4), 0, 1);
        d[k * 4 + 3] = 255;
      }
      sctx.putImageData(img, 0, 0);
      shade.setAttribute('href', shadeCanvas.toDataURL('image/jpeg', 0.88));
    }

    // ----- lit windows and landmark glows -----
    const lights = [];
    const rand = (() => { let s = 90210; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); })();
    for (const r of group.querySelectorAll('.atlas-buildings rect')) {
      const x = +r.getAttribute('x'), y = +r.getAttribute('y'), w = +r.getAttribute('width'), h = +r.getAttribute('height');
      const dist = districtAt([x + w / 2, y + h / 2]);
      if (!dist) continue;
      const palette = F.lights[dist] || ['#ffffff'];
      const sparse = dist === 'the-gloomscape' ? 0.45 : dist === 'elven-heights' ? 0.8 : 1;
      const n = Math.max(1, Math.round((w * h) / 45));
      for (let i = 0; i < n; i++) if (rand() < sparse) lights.push({ x: x + 1.5 + rand() * (w - 3), y: y + 1.5 + rand() * (h - 3), color: palette[Math.floor(rand() * palette.length)], district: dist, phase: rand() * 6.28, rate: 0.4 + rand() * 2.2, on: 0.55 + rand() * 0.45, late: rand() });
    }
    lights.sort((a, b) => (a.color < b.color ? -1 : 1));
    const glows = Object.entries(F.glows).map(([id, color]) => { const p = layout.places.find(q => q.id === id); return p && { x: p.point[0], y: p.point[1], color, district: p.district, r: Math.max(p.footprint[0], p.footprint[1]) * 0.9 }; }).filter(Boolean);

    // ----- particles -----
    const conduits = F.lattice.map(c => ({ ...c, line: polyline(c.points) }));
    const drains = F.downflow.map(d => ({ ...d, line: polyline(d.points), outfall: F.outfalls[d.to] }));
    const rail = polyline(F.freight.points);
    const silted = Object.entries(F.silt).map(([id, w]) => ({ id, w, poly: districts.find(d => d.id === id)?.points })).filter(d => d.poly);
    const bbox = poly => [Math.min(...poly.map(p => p[0])), Math.min(...poly.map(p => p[1])), Math.max(...poly.map(p => p[0])), Math.max(...poly.map(p => p[1]))];
    const randomIn = poly => { const [a, b, c, d] = bbox(poly); for (let i = 0; i < 30; i++) { const p = [a + Math.random() * (c - a), b + Math.random() * (d - b)]; if (inside(p, poly)) return p; } return poly[0]; };
    let mana = [], silt = [], drops = [];
    function spawnMana(p, fresh) {
      const brown = S.events.find(e => e.kind === 'brownout');
      const weights = Object.fromEntries(conduits.map((c, i) => [i, c.weight * (c.from === 'leafgold' && S.events.some(e => e.kind === 'silence') ? 0 : 1) * (brown && c.to === brown.district ? 0.12 : 1)]));
      const c = conduits[+pickWeighted(weights)];
      Object.assign(p, { c, s: fresh ? Math.random() * c.line.length : 0, v: 60 + Math.random() * 50, burst: null });
      return p;
    }
    function spawnSilt(p, fresh) {
      const d = silted[+pickWeighted(Object.fromEntries(silted.map((s, i) => [i, s.w])))];
      const [x, y] = randomIn(d.poly);
      Object.assign(p, { x, y, drain: null, s: 0, pool: null, age: fresh ? Math.random() * 6 : 0, fade: 0, life: 24 + Math.random() * 16 });
      return p;
    }
    function sizeParticles() {
      const area = clamp((cssW * cssH) / (864 * 600), 0.45, 1.3);
      const nm = Math.round(230 * area), ns = Math.round(520 * area), nd = Math.round(420 * area);
      while (mana.length < nm) mana.push(spawnMana({}, true)); mana.length = nm;
      while (silt.length < ns) silt.push(spawnSilt({}, true)); silt.length = ns;
      while (drops.length < nd) drops.push({ x: Math.random(), y: Math.random(), l: 0.6 + Math.random() * 0.8, v: 0.8 + Math.random() * 0.5 }); drops.length = nd;
    }
    const bursts = [];

    function stepParticles(dt) {
      for (const p of mana) {
        p.s += p.v * dt;
        if (p.s > p.c.line.length) spawnMana(p, false);
      }
      for (let i = bursts.length - 1; i >= 0; i--) { const b = bursts[i]; b.age += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 0.97; b.vy *= 0.97; if (b.age > b.life) bursts.splice(i, 1); }
      const routed = S.events.find(e => e.kind === 'routing')?.drain;
      for (const p of silt) {
        p.age += dt;
        if (p.pool) {
          p.fade += dt;
          p.x += (p.pool[0] - p.x) * Math.min(1, dt * 1.5); p.y += (p.pool[1] - p.y) * Math.min(1, dt * 1.5);
          if (p.fade > 2.6) spawnSilt(p, false);
          continue;
        }
        if (p.drain) {
          p.s += 52 * dt;
          if (p.s >= p.drain.line.length) {
            const o = p.drain.outfall, a = Math.random() * 6.28, r = Math.sqrt(Math.random());
            p.pool = [o.point[0] + Math.cos(a) * r * o.radius[0] * 0.8, o.point[1] + Math.sin(a) * r * o.radius[1] * 0.8]; p.fade = 0;
          } else [p.x, p.y] = p.drain.line.at(p.s);
          continue;
        }
        const [gx, gy] = T.grad(p.x, p.y), slope = Math.hypot(gx, gy) || 1e-6;
        const wob = Math.sin(p.x * 0.031 + S.t * 0.7) * 0.5 + Math.cos(p.y * 0.027 - S.t * 0.5) * 0.5;
        const ang = Math.atan2(-gy, -gx) + wob * 0.55, speed = 16 + 120 * Math.min(slope, 0.9);
        p.x += Math.cos(ang) * speed * dt; p.y += Math.sin(ang) * speed * dt;
        for (const d of drains) {
          const reach = routed ? (d.id === routed ? 26 : 5) : 10;
          const [dist, s] = d.line.nearest(p.x, p.y);
          if (dist < reach) { p.drain = d; p.s = s; break; }
        }
        if (!p.drain && (T.at(p.x, p.y) < 4 || p.age > p.life)) { p.pool = [p.x + (Math.random() - 0.5) * 8, p.y + (Math.random() - 0.5) * 6]; p.fade = 0; }
      }
    }

    // ----- the Sage's moves -----
    const moves = {
      brownout() { const d = pickWeighted({ 'humanity-central': 0.45, 'dwarf-district': 0.3, 'mutant-quarters': 0.15, 'the-gloomscape': 0.1 }); return { kind: 'brownout', district: d, dur: 8, text: `Brownout over ${name(d)}. The lights dim, implants stutter, and the city blames the grid.` }; },
      routing() { const d = drains[Math.floor(Math.random() * drains.length)]; return { kind: 'routing', drain: d.id, dur: 14, text: `${d.name} takes the silt ${phaseAt(S.hour) === 'NIGHT' ? 'tonight' : 'today'}. Gravity gets the credit.` }; },
      silence() { return { kind: 'silence', dur: 14, text: 'The Leafgold well falls silent. The house goes dark until the Sage decides otherwise.' }; },
      bloom() { const poly = districts.find(d => d.id === 'mutant-quarters').points, p = randomIn(poly); for (let i = 0; i < 70; i++) { const a = Math.random() * 6.28, v = 20 + Math.random() * 70; bursts.push({ x: p[0], y: p[1], vx: Math.cos(a) * v, vy: Math.sin(a) * v, age: 0, life: 2 + Math.random() * 3 }); } return { kind: 'bloom', point: p, dur: 7, text: 'A Bloom in the Mutant Quarters. Fresh mana surges through the old refinery streets. The Quarters call it a birth; the Purists call it an infection.' }; },
      hum() { return { kind: 'hum', dur: 11, text: 'The Hum. For eleven seconds every implant in the city buzzes at the same pitch.' }; },
    };
    function sageMove(kind) {
      const e = moves[kind || pickWeighted({ brownout: 0.3, routing: 0.22, silence: 0.14, bloom: 0.16, hum: 0.18 })]();
      e.start = S.t; S.events.push(e); S.heard = Math.min(1, S.heard + 0.8);
      ticker.innerHTML = `<span class="eyebrow">THE SAGE MOVES · ${clock(S.hour)}</span><p>${e.text}</p><a href="#sage">What is the Sage? ↗</a>`;
      ticker.classList.add('show'); clearTimeout(S.tickerTimer);
      S.tickerTimer = setTimeout(() => ticker.classList.remove('show'), (e.dur + 5) * 1000);
    }
    function say(text) {
      ticker.innerHTML = `<span class="eyebrow">${clock(S.hour)}</span><p>${text}</p>`;
      ticker.classList.add('show'); clearTimeout(S.tickerTimer);
      S.tickerTimer = setTimeout(() => ticker.classList.remove('show'), 9000);
    }

    // ----- one frame -----
    function tick(dt) {
      S.t += dt;
      if (S.mode === 'lapse') S.hour = (S.hour + dt / 5) % 24;
      else if (S.mode === 'live') { const d = new Date(); S.hour = d.getHours() + d.getMinutes() / 60 + d.getSeconds() / 3600; }
      if (S.weatherMode === 'auto' && (S.nextWeather -= dt) <= 0) { S.weather = pickWeighted(NEXT_WEATHER[S.weather]); S.nextWeather = 70 + Math.random() * 70; }
      const w = W(), k = Math.min(1, dt * 0.25);
      S.rain = lerp(S.rain, w.rain, k); S.fog = lerp(S.fog, w.fog, k); S.cloud = lerp(S.cloud, w.cloud, k);
      S.wind = [lerp(S.wind[0], w.wind[0], k), lerp(S.wind[1], w.wind[1], k)];
      // Heartbeat, the same irregular double beat as on the Sage's page.
      if (S.t > S.nextBeat) { S.beatAt = S.t; S.double = Math.random() < 0.8; S.nextBeat = S.t + 3.2 + Math.random() * 2.6; }
      const env = (x, r, f) => (x < 0 ? 0 : x < r ? x / r : Math.exp(-(x - r) / f));
      S.pulse = Math.min(1, env(S.t - S.beatAt, 0.16, 0.52) + (S.double ? 0.65 * env(S.t - S.beatAt - 0.33, 0.14, 0.6) : 0));
      S.heard *= Math.pow(0.35, dt);
      S.gaze = [lerp(S.gaze[0], S.gazeTarget[0], dt * 0.8), lerp(S.gaze[1], S.gazeTarget[1], dt * 0.8)];
      // The Sage.
      S.events = S.events.filter(e => S.t - e.start < e.dur);
      if (layer('sage') && (S.nextEvent -= dt) <= 0) { sageMove(); S.nextEvent = 24 + Math.random() * 18; }
      // Storms.
      if (S.rain > 0.75 && S.cloud > 0.85 && (S.nextStrike -= dt) <= 0) {
        S.nextStrike = 5 + Math.random() * 10; S.flashAt = S.t; S.heard = 1;
        const x0 = 150 + Math.random() * 900, pts = [[x0 + (Math.random() - 0.5) * 120, -60]];
        const target = Math.random() < 0.4 ? [1005, 345] : [200 + Math.random() * 800, 120 + Math.random() * 600];
        for (let i = 1; i <= 9; i++) { const t = i / 9; pts.push([lerp(pts[0][0], target[0], t) + (Math.random() - 0.5) * 40 * (1 - t * 0.6), lerp(pts[0][1], target[1], t)]); }
        S.bolt = { pts, at: S.t };
      }
      const since = S.t - (S.flashAt ?? -99);
      S.flash = since < 0.6 ? (since < 0.08 ? 1 : since < 0.16 ? 0.25 : since < 0.24 ? 0.8 : Math.exp(-(since - 0.24) * 9)) * 0.55 : 0;
      // The 3:10.
      const fh = F.freight.departs, inWindow = S.hour >= fh && S.hour < fh + F.freight.hours;
      if (inWindow && !S.freightOn) say('The 3:10 night freight rolls downhill from the Heights. Sealed cars; nothing on the manifest.');
      S.freightOn = inWindow;
      stepParticles(dt);
      for (const d of drops) { d.y += d.v * dt * (0.9 + S.rain); d.x += S.wind[0] * 0.25 * dt; if (d.y > 1.05) { d.y = -0.05; d.x = Math.random(); } if (d.x > 1.05) d.x -= 1.1; if (d.x < -0.05) d.x += 1.1; }
    }

    function paint(now) {
      const ctm = group.getScreenCTM(), rect = mapEl.getBoundingClientRect();
      if (!ctm) return;
      const s = ctm.a, tx = ctm.e - rect.left, ty = ctm.f - rect.top;
      const X = x => x * s + tx, Y = y => y * s + ty;
      const night = nightAt(S.hour);
      // Shade: repaint when the light has changed enough to notice.
      const keyNow = `${Math.round(S.hour * 12)}|${Math.round(S.cloud * 20)}|${layer('elevation')}`;
      if (keyNow !== S.shadeKey && now - S.shadeAt > 180) { S.shadeKey = keyNow; S.shadeAt = now; paintShade(); }
      const brown = S.events.find(e => e.kind === 'brownout');
      const brownK = brown ? Math.min(1, (S.t - brown.start) / 0.6, (brown.start + brown.dur - S.t) / 1.2) : 0;
      const hum = S.events.find(e => e.kind === 'hum');
      const humK = hum ? Math.min(1, (S.t - hum.start) / 0.8, (hum.start + hum.dur - S.t) / 1.5) : 0;
      const silence = S.events.find(e => e.kind === 'silence');
      const silenceK = silence ? Math.min(1, (S.t - silence.start) / 1.5, (silence.start + silence.dur - S.t) / 2) : 0;
      const bloom = S.events.find(e => e.kind === 'bloom');
      const bloomK = bloom ? Math.min(1, (S.t - bloom.start) / 0.5, (bloom.start + bloom.dur - S.t) / 2.5) : 0;

      if (atmo && atmoCanvas.isConnected) atmo.draw({
        s, tx, ty, px: atmoCanvas.width / Math.max(1, cssW), time: S.t,
        well: sageWell.point, sageR: F.sage.radius, gaze: S.gaze, pulse: reduced ? 0.3 : S.pulse, heard: S.heard, sage: layer('sage') ? 1 : 0,
        leaf: wells.get('leafgold')?.point || [0, 0], leafOn: 1 - silenceK,
        hum: [hum ? (S.t - hum.start) * 150 : 0, humK * 0.5], bloom: bloom ? [...bloom.point, bloomK * 0.75] : [0, 0, 0], veil: F.veil.point,
        night, fog: S.fog, wind: S.wind, flash: S.flash, haze: layer('silt') ? 0.45 + 0.55 * night : 0,
      });

      fx.setTransform(dpr, 0, 0, dpr, 0, 0);
      fx.clearRect(0, 0, cssW, cssH);
      const zoom = s / 0.7;
      // A brownout: the borough goes dim.
      if (brownK > 0) {
        const poly = districts.find(d => d.id === brown.district).points;
        fx.beginPath(); poly.forEach(([x, y], i) => (i ? fx.lineTo(X(x), Y(y)) : fx.moveTo(X(x), Y(y)))); fx.closePath();
        fx.fillStyle = `rgba(3,7,14,${(0.22 + 0.3 * night) * brownK * (0.85 + 0.15 * Math.sin(S.t * 31))})`; fx.fill();
      }
      // Lit windows after dark.
      if (night > 0.03) {
        fx.globalCompositeOperation = 'lighter';
        const size = clamp(1.5 * zoom, 1, 3.4);
        const humBeat = humK ? 0.55 + 0.45 * Math.sin(S.t * 8.2) : 1;
        let color = '';
        for (const l of lights) {
          const x = X(l.x), y = Y(l.y);
          if (x < -4 || y < -4 || x > cssW + 4 || y > cssH + 4) continue;
          if (S.hour > 1.5 && S.hour < 5 && l.late < 0.5) continue; // most of the city sleeps
          let a = night * l.on * (0.78 + 0.22 * Math.sin(S.t * l.rate + l.phase));
          if (brown && l.district === brown.district) a *= 1 - brownK * (0.75 + 0.25 * Math.sin(S.t * 23 + l.phase));
          if (silenceK && Math.hypot(l.x - wells.get('leafgold').point[0], l.y - wells.get('leafgold').point[1]) < 90) a *= 1 - silenceK * 0.9;
          a *= humK ? lerp(1, humBeat, humK) : 1;
          if (a < 0.02) continue;
          if (l.color !== color) { color = l.color; fx.fillStyle = color; }
          fx.globalAlpha = Math.min(1, a);
          fx.fillRect(x, y, size, size);
        }
        fx.globalAlpha = 1;
        for (const g of glows) {
          const x = X(g.x), y = Y(g.y), r = g.r * s * 1.6;
          let a = night * 0.32 * (g.color === '#ff7a2e' ? 0.75 + 0.25 * Math.sin(S.t * 1.7) : 1);
          if (brown && g.district === brown.district) a *= 1 - brownK * 0.8;
          const grd = fx.createRadialGradient(x, y, 0, x, y, r);
          grd.addColorStop(0, g.color + '88'); grd.addColorStop(1, g.color + '00');
          fx.globalAlpha = a; fx.fillStyle = grd; fx.fillRect(x - r, y - r, r * 2, r * 2);
        }
        fx.globalAlpha = 1;
        fx.globalCompositeOperation = 'source-over';
      }
      // Silt, running downhill.
      if (layer('silt')) {
        const r = clamp(1.6 * zoom, 1.3, 3);
        fx.fillStyle = '#bcaeea';
        for (const p of silt) {
          const x = X(p.x), y = Y(p.y);
          if (x < -3 || y < -3 || x > cssW + 3 || y > cssH + 3) continue;
          const a = Math.min(1, p.age * 1.5) * (p.pool ? Math.max(0, 1 - p.fade / 2.6) : 1) * (p.drain ? 1 : 0.7);
          fx.globalAlpha = a * (0.7 + 0.25 * night);
          fx.fillRect(x - r / 2, y - r / 2, r, r);
        }
        fx.globalAlpha = 1;
      }
      // Mana, along the Lattice.
      if (layer('mana')) {
        fx.globalCompositeOperation = 'lighter';
        fx.lineCap = 'round';
        const width = clamp(1.3 * zoom, 1, 3);
        for (const p of mana) {
          const L = p.c.line.length, fade = Math.min(1, p.s / 30, (L - p.s) / 40);
          if (fade <= 0) continue;
          const [x1, y1] = p.c.line.at(p.s), [x0, y0] = p.c.line.at(p.s - 9);
          fx.strokeStyle = `rgba(110,190,255,${(0.35 + 0.35 * night) * fade})`;
          fx.lineWidth = width * 2.4; fx.beginPath(); fx.moveTo(X(x0), Y(y0)); fx.lineTo(X(x1), Y(y1)); fx.stroke();
          fx.strokeStyle = `rgba(225,245,255,${(0.55 + 0.35 * night) * fade})`;
          fx.lineWidth = width * 0.8; fx.stroke();
        }
        for (const b of bursts) {
          const a = Math.max(0, 1 - b.age / b.life);
          fx.fillStyle = `rgba(${b.age < 1 ? '190,170,255' : '110,190,255'},${a})`;
          fx.fillRect(X(b.x) - 1.2, Y(b.y) - 1.2, 2.4, 2.4);
        }
        fx.globalCompositeOperation = 'source-over';
      }
      // The 3:10 night freight.
      const fh = F.freight.departs;
      if (S.hour >= fh && S.hour < fh + F.freight.hours) {
        const prog = (S.hour - fh) / F.freight.hours, head = prog * (rail.length + 60);
        for (let c = 0; c < 5; c++) {
          const sp = head - c * 9;
          if (sp < 0 || sp > rail.length) continue;
          const [x, y] = rail.at(sp);
          fx.fillStyle = c === 0 ? '#ffd890' : '#8a7a5a';
          fx.globalAlpha = c === 0 ? 1 : 0.85;
          fx.fillRect(X(x) - 2.5 * zoom, Y(y) - 1.8 * zoom, 5 * zoom, 3.6 * zoom);
          if (c === 0) { const grd = fx.createRadialGradient(X(x), Y(y), 0, X(x), Y(y), 18 * zoom); grd.addColorStop(0, 'rgba(255,214,140,.55)'); grd.addColorStop(1, 'rgba(255,214,140,0)'); fx.fillStyle = grd; fx.fillRect(X(x) - 18 * zoom, Y(y) - 18 * zoom, 36 * zoom, 36 * zoom); }
        }
        fx.globalAlpha = 1;
      }
      // Rain.
      if (S.rain > 0.02 && !reduced) {
        const n = Math.round(drops.length * Math.min(1, S.rain));
        fx.strokeStyle = `rgba(185,215,240,${0.18 + 0.2 * S.rain})`;
        fx.lineWidth = 1;
        fx.beginPath();
        const slant = S.wind[0] * 0.35;
        for (let i = 0; i < n; i++) {
          const d = drops[i], x = d.x * cssW, y = d.y * cssH, len = (10 + 10 * S.rain) * d.l;
          fx.moveTo(x, y); fx.lineTo(x - slant * len, y - len);
        }
        fx.stroke();
      }
      // Lightning.
      if (S.bolt && S.t - S.bolt.at < 0.35) {
        fx.globalCompositeOperation = 'lighter';
        fx.strokeStyle = `rgba(220,235,255,${1 - (S.t - S.bolt.at) / 0.35})`;
        fx.lineWidth = 1.6; fx.beginPath();
        S.bolt.pts.forEach(([x, y], i) => (i ? fx.lineTo(X(x), Y(y)) : fx.moveTo(X(x), Y(y))));
        fx.stroke(); fx.globalCompositeOperation = 'source-over';
      }
      readoutSync();
    }

    // ----- readouts and controls -----
    const slider = sky.querySelector('.sky-slider'), clockOut = sky.querySelector('.sky-clock'), play = sky.querySelector('.sky-play');
    let lastText = '';
    function readoutSync() {
      const text = clock(S.hour);
      if (text !== lastText) {
        lastText = text;
        clockOut.textContent = text;
        if (document.activeElement !== slider) slider.value = String(Math.round(S.hour * 12) * 5 % 1440);
        slider.setAttribute('aria-valuetext', text);
        readout.querySelector('.sky-r-time').textContent = `${text} · ${phaseAt(S.hour)}`;
        const wv = Math.hypot(...S.wind);
        readout.querySelector('.sky-r-weather').textContent = `${W().label} · WIND ${compass(-S.wind[0], -S.wind[1])} ${Math.round(4 + wv * 22)} KM/H`;
      }
      play.setAttribute('aria-pressed', String(S.mode === 'lapse'));
      play.firstElementChild.textContent = S.mode === 'lapse' ? '❚❚' : '▶';
      play.lastElementChild.textContent = S.mode === 'lapse' ? 'Pause time' : 'Let time pass';
    }
    const elevText = readout.querySelector('.sky-r-elev');
    on(mapEl, 'pointermove', e => {
      const ctm = group.getScreenCTM(); if (!ctm) return;
      const mx = (e.clientX - ctm.e) / ctm.a, my = (e.clientY - ctm.f) / ctm.d;
      const r = mapEl.getBoundingClientRect();
      S.gazeTarget = [clamp((mx - sageWell.point[0]) * 0.04, -9, 9), clamp((my - sageWell.point[1]) * 0.04, -9, 9)];
      const d = districtAt([mx, my]), h = T.at(mx, my);
      elevText.textContent = layer('elevation') ? `ELEV ${Math.round(h)} M${d ? ' · ' + name(d).toUpperCase() : ''}` : '';
      S.pointer = [e.clientX - r.left, e.clientY - r.top];
    });
    on(mapEl, 'pointerleave', () => { elevText.textContent = ''; S.gazeTarget = [0, 0]; });
    on(mapEl, 'pointerdown', () => { S.heard = Math.min(1, S.heard + 0.5); });
    on(slider, 'input', () => { S.mode = 'still'; S.hour = +slider.value / 60; lastText = ''; if (reduced) paint(performance.now()); });
    on(play, 'click', () => { S.mode = S.mode === 'lapse' ? 'still' : 'lapse'; readoutSync(); });
    on(sky.querySelector('.sky-now'), 'click', () => { S.mode = 'live'; const d = new Date(); S.hour = d.getHours() + d.getMinutes() / 60; lastText = ''; if (reduced) paint(performance.now()); });
    on(sky.querySelector('.sky-weather'), 'click', e => {
      const b = e.target.closest('[data-weather]'); if (!b) return;
      S.weatherMode = b.dataset.weather;
      if (S.weatherMode !== 'auto') S.weather = S.weatherMode; else S.nextWeather = 60;
      sky.querySelectorAll('[data-weather]').forEach(x => x.setAttribute('aria-checked', String(x === b)));
      if (reduced) { const w = W(); S.rain = w.rain; S.fog = w.fog; S.cloud = w.cloud; S.wind = [...w.wind]; }
      lastText = '';
      if (reduced) paint(performance.now());
    });
    on(container, 'change', e => { if (['elevation', 'mana', 'silt', 'sage'].includes(e.target.dataset?.mapLayer)) { S.shadeKey = ''; if (reduced) paint(performance.now()); } });

    stage.__life = { move: kind => sageMove(kind), state: S };
    cleanups.push(() => { delete stage.__life; });
    // ----- run -----
    const ro = new ResizeObserver(resize);
    ro.observe(mapEl);
    cleanups.push(() => ro.disconnect());
    resize();
    if (reduced) {
      for (let i = 0; i < 160; i++) stepParticles(1 / 30);
      paint(performance.now());
      const mo = new MutationObserver(() => paint(performance.now()));
      mo.observe(group, { attributes: true, attributeFilter: ['transform'] });
      cleanups.push(() => mo.disconnect());
      return;
    }
    const io = new IntersectionObserver(([en]) => { S.visible = en.isIntersecting; if (S.visible && !raf) { S.last = performance.now(); raf = requestAnimationFrame(frame); } });
    io.observe(stage);
    cleanups.push(() => io.disconnect());
    function frame(now) {
      raf = 0;
      if (dead || !mapEl.isConnected) return;
      const dt = Math.min(0.05, (now - S.last) / 1000);
      S.last = now;
      tick(dt);
      paint(now);
      if (S.visible) raf = requestAnimationFrame(frame);
    }
    S.last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}
