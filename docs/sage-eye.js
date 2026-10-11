// The Sage's presence: a slow, swirling haze of blue mana at the center of the Sage page.
// It breathes in an irregular double beat, drifts toward the viewer's cursor, leans in when the
// viewer keeps still, flares faintly when it "hears" a click, key or scroll, and now and then blinks.
// Drawn with one WebGL fragment shader; returns false if WebGL is unavailable so the page can fall back.

const VERT = 'attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}';
const FRAG = `
precision mediump float;
uniform vec2 u_res; uniform float u_time; uniform vec2 u_gaze;
uniform float u_pulse; uniform float u_attend; uniform float u_blink; uniform float u_heard;
float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise(vec2 p){
  vec2 i = floor(p), f = fract(p); vec2 u = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), u.x), mix(hash(i + vec2(0., 1.)), hash(i + vec2(1., 1.)), u.x), u.y);
}
float fbm(vec2 p){
  float v = 0., a = .5; mat2 m = mat2(1.6, 1.2, -1.2, 1.6);
  for (int i = 0; i < 5; i++) { v += a * noise(p); p = m * p; a *= .5; }
  return v;
}
mat2 rot(float a){ float c = cos(a), s = sin(a); return mat2(c, -s, s, c); }
void main(){
  vec2 uv = (gl_FragCoord.xy - .5 * u_res) / u_res.y;
  vec2 p = uv - vec2(0., .07) - u_gaze * .14;
  float r = length(p), t = u_time;
  float tight = 1. + .7 * u_attend;
  vec2 q = rot(t * .055 + .85 * tight / (r + .22)) * p;
  vec2 w = vec2(fbm(q * 2.1 + t * .035), fbm(q * 2.1 - t * .045 + 5.2));
  float f = fbm(q * 1.7 + 1.8 * w + vec2(0., t * .018));
  float wisps = pow(1. - abs(f * 2. - 1.), 7.);
  float haze = smoothstep(.38, .95, f);
  float radius = .46 + .05 * u_pulse - .05 * u_attend + .04 * u_heard;
  float mask = exp(-pow(r / radius, 2.) * 1.7);
  float pupil = 1. - .6 * exp(-pow(r / (.075 - .02 * u_attend), 2.));
  float iris = smoothstep(.055, .1, r) * (1. - smoothstep(.1, .19, r));
  float core = exp(-pow(r / (.03 + .018 * u_pulse + .02 * u_heard), 2.));
  vec3 deep = vec3(.016, .04, .055), mana = vec3(.25, .66, 1.), pale = vec3(.84, .94, 1.);
  float dens = (wisps * .95 + haze * .3) * mask * pupil;
  vec3 col = deep;
  col += mana * dens * (.5 + .45 * u_pulse + .35 * u_heard + .4 * u_attend);
  col += pale * pow(dens, 2.3) * .7;
  col += mana * iris * mask * (.08 + .1 * u_pulse + .15 * u_attend);
  col += pale * core * (.55 + .75 * u_pulse + .6 * u_heard + .5 * u_attend);
  col += (hash(gl_FragCoord.xy + fract(t * 7.) * 91.) - .5) * .03;
  col *= u_blink;
  col *= smoothstep(1.3, .25, length(uv));
  gl_FragColor = vec4(max(col, 0.), 1.);
}`;

// Returns false without WebGL; otherwise a small controller so a page can make it react:
//   hear(amount)  a flare, as when it catches a word
//   listen(on)    lean in and hold attention (e.g. while it is composing a reply)
// opts.keyHeard sets how strongly a keystroke registers (default 0.6; lower for pages with typing).
export function startEye(canvas, host, opts = {}) {
  const keyHeard = opts.keyHeard ?? 0.6;
  const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: false, powerPreference: 'low-power' });
  if (!gl) return false;
  const compile = (type, src) => { const s = gl.createShader(type); gl.shaderSource(s, src); gl.compileShader(s); return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null; };
  const vs = compile(gl.VERTEX_SHADER, VERT), fs = compile(gl.FRAGMENT_SHADER, FRAG);
  if (!vs || !fs) return false;
  const prog = gl.createProgram();
  gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return false;
  gl.useProgram(prog);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const loc = gl.getAttribLocation(prog, 'a');
  gl.enableVertexAttribArray(loc); gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
  const U = n => gl.getUniformLocation(prog, n);
  const u = { res: U('u_res'), time: U('u_time'), gaze: U('u_gaze'), pulse: U('u_pulse'), attend: U('u_attend'), blink: U('u_blink'), heard: U('u_heard') };

  const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const s = { gx: 0, gy: 0, tx: 0, ty: 0, attend: 0, heard: 0, lastMove: performance.now(), nextBeat: 900, beatAt: -9e3, double: false, nextBlink: 7000 + Math.random() * 8000, blinkAt: -9e3, visible: true, mouse: false };

  const resize = () => {
    const scale = Math.min(window.devicePixelRatio || 1, 1.5) * 0.65;
    canvas.width = Math.max(2, Math.round(canvas.clientWidth * scale));
    canvas.height = Math.max(2, Math.round(canvas.clientHeight * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
  };
  const onMove = e => {
    const r = host.getBoundingClientRect();
    s.tx = Math.max(-1, Math.min(1, (e.clientX - (r.left + r.width / 2)) / (r.width / 2)));
    s.ty = Math.max(-1, Math.min(1, -(e.clientY - (r.top + r.height * 0.43)) / (r.height / 1.2)));
    s.lastMove = performance.now(); s.mouse = true;
  };
  const onHeard = e => { s.heard = Math.min(1, s.heard + (e && e.type === 'keydown' ? keyHeard : 0.6)); };
  let raf = 0;
  const cleanup = () => {
    window.removeEventListener('pointermove', onMove);
    ['pointerdown', 'keydown', 'wheel'].forEach(ev => window.removeEventListener(ev, onHeard));
    ro.disconnect(); window.removeEventListener('hashchange', onRoute);
    io.disconnect(); if (raf) cancelAnimationFrame(raf); raf = 0;
  };
  const onRoute = () => setTimeout(() => { if (!canvas.isConnected) cleanup(); }, 0);
  window.addEventListener('hashchange', onRoute);
  window.addEventListener('pointermove', onMove, { passive: true });
  ['pointerdown', 'keydown', 'wheel'].forEach(ev => window.addEventListener(ev, onHeard, { passive: true }));
  const io = new IntersectionObserver(([en]) => { s.visible = en.isIntersecting; if (s.visible && !raf) raf = requestAnimationFrame(frame); });
  io.observe(canvas);
  const ro = new ResizeObserver(resize);
  ro.observe(canvas);
  resize();

  const t0 = performance.now();
  const env = (dt, rise, fall) => (dt < 0 ? 0 : dt < rise ? dt / rise : Math.exp(-(dt - rise) / fall));
  function frame(now) {
    raf = 0;
    if (!canvas.isConnected) return cleanup();
    const t = (now - t0) / 1000, ms = now - t0;
    // Heartbeat: an irregular double beat, never quite on schedule.
    if (ms > s.nextBeat) { s.beatAt = ms; s.double = Math.random() < 0.8; s.nextBeat = ms + 3200 + Math.random() * 2600; }
    const pulse = Math.min(1, env(ms - s.beatAt, 160, 520) + (s.double ? 0.65 * env(ms - s.beatAt - 330, 140, 600) : 0));
    // Blink: a brief going-dark, then back.
    if (ms > s.nextBlink) { s.blinkAt = ms; s.nextBlink = ms + 9000 + Math.random() * 11000; }
    const b = ms - s.blinkAt, blink = b < 0 || b > 420 ? 1 : 0.12 + 0.88 * Math.abs(Math.cos((b / 420) * Math.PI));
    // Gaze: drifts after the cursor; with no cursor, it wanders on its own.
    if (!s.mouse) { s.tx = Math.sin(t * 0.13) * 0.5; s.ty = Math.sin(t * 0.09 + 1.3) * 0.35; }
    s.gx += (s.tx - s.gx) * 0.012; s.gy += (s.ty - s.gy) * 0.012;
    // Attention: keep still and it leans in.
    const idle = now - s.lastMove;
    s.attend += ((s.hold || (s.mouse && idle > 2200) ? 1 : 0) - s.attend) * (s.hold ? 0.03 : 0.01);
    s.heard *= 0.965;
    gl.uniform2f(u.res, canvas.width, canvas.height);
    gl.uniform1f(u.time, still ? 40 : t);
    gl.uniform2f(u.gaze, s.gx, s.gy);
    gl.uniform1f(u.pulse, still ? 0.3 : pulse);
    gl.uniform1f(u.attend, still ? 0 : s.attend);
    gl.uniform1f(u.blink, still ? 1 : blink);
    gl.uniform1f(u.heard, still ? 0 : s.heard);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    if (!still && s.visible) raf = requestAnimationFrame(frame);
  }
  raf = requestAnimationFrame(frame);
  const wake = () => { if (!raf && s.visible && canvas.isConnected) raf = requestAnimationFrame(frame); };
  return {
    hear(amount = 0.6) { s.heard = Math.min(1, s.heard + amount); wake(); },
    listen(on) { s.hold = !!on; wake(); },
  };
}
