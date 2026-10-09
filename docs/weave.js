// The Weave: the relationship web drawn as a dreamcatcher.
// Beads are characters (colored by people), threads are ties (colored by who knows them),
// feathers are the five circles, and the bead at the center is the secret they all orbit.
let data = null;
const VIS = {
  public: { label: 'Public', note: 'the city knows' },
  private: { label: 'Private', note: 'insiders know' },
  secret: { label: 'Secret', note: 'one side, or almost no one, knows' }
};
const FEATHER = { 'the-wells': '#e6d39a', 'the-deep': '#d99566', 'carmine-night': '#e2705f', 'bodies': '#8fb4ff', 'downhill-trade': '#9ccfc1' };
const CX = 500, CY = 452, R_HOOP = 418, R_BEAD = 298, R_LABEL = 312;
let state = { selected: null, kind: null, show: new Set(['public', 'private', 'secret']) };

async function load() {
  if (!data) {
    const res = await fetch('data/weave.json');
    if (!res.ok) throw Error('Weave unavailable');
    data = await res.json();
    data.byId = new Map(data.nodes.map(n => [n.id, n]));
    const gap = 1.6, slots = data.nodes.length + gap * data.clusters.length;
    let s = gap / 2;
    data.clusters.forEach(c => {
      c.start = s;
      data.nodes.filter(n => n.cluster === c.id).forEach(n => { n.angle = -Math.PI / 2 + (s / slots) * Math.PI * 2; s += 1; });
      c.end = s - 1;
      s += gap;
    });
    data.nodes.forEach(n => { n.x = CX + R_BEAD * Math.cos(n.angle); n.y = CY + R_BEAD * Math.sin(n.angle); });
  }
  return data;
}

const f = n => n.toFixed(1);

function threadPath(a, b) {
  let d = Math.abs(a.angle - b.angle) % (Math.PI * 2);
  if (d > Math.PI) d = Math.PI * 2 - d;
  const k = 0.12 + 0.62 * Math.pow(1 - d / Math.PI, 1.6);
  const mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
  const qx = CX + (mx - CX) * k, qy = CY + (my - CY) * k;
  return `M${f(a.x)} ${f(a.y)}Q${f(qx)} ${f(qy)} ${f(b.x)} ${f(b.y)}`;
}

function webRings() {
  // The decorative net: each ring knots at the midpoints of the ring outside it, pulled inward.
  let pts = Array.from({ length: 24 }, (_, i) => { const t = -Math.PI / 2 + i * Math.PI * 2 / 24; return [CX + 270 * Math.cos(t), CY + 270 * Math.sin(t)]; });
  let out = '';
  for (let ring = 0; ring < 6; ring++) {
    out += `<path d="M${pts.map(p => f(p[0]) + ' ' + f(p[1])).join('L')}Z"/>`;
    pts = pts.map((p, i) => { const q = pts[(i + 1) % pts.length]; const mx = (p[0] + q[0]) / 2, my = (p[1] + q[1]) / 2; return [CX + (mx - CX) * 0.8, CY + (my - CY) * 0.8]; });
  }
  return out;
}

function svg(d, esc) {
  const threads = d.ties.map((t, i) => {
    const a = d.byId.get(t.a), b = d.byId.get(t.b);
    return `<path class="thread vis-${t.visibility}" data-a="${t.a}" data-b="${t.b}" style="--i:${i}" d="${threadPath(a, b)}"/>`;
  }).join('');
  const beads = d.nodes.map(n => {
    const deg = n.angle * 180 / Math.PI, left = Math.cos(n.angle) < 0;
    const lx = CX + R_LABEL * Math.cos(n.angle), ly = CY + R_LABEL * Math.sin(n.angle);
    const rot = left ? deg + 180 : deg;
    return `<g class="bead" data-id="${n.id}" data-cluster="${n.cluster}" tabindex="0" role="button" aria-label="${esc(n.name)}">
      <circle class="bead-halo" cx="${f(n.x)}" cy="${f(n.y)}" r="15"/>
      <circle class="bead-core" cx="${f(n.x)}" cy="${f(n.y)}" r="7.5" fill="${n.color}"/>
      <text x="${f(lx)}" y="${f(ly)}" transform="rotate(${f(rot)} ${f(lx)} ${f(ly)})" text-anchor="${left ? 'end' : 'start'}" dy="0.34em" ${left ? 'dx="-2"' : 'dx="2"'}>${esc(n.short)}</text>
    </g>`;
  }).join('');
  const anchors = [120, 105, 90, 75, 60];
  const drops = [104, 64, 46, 64, 104];
  const feathers = d.clusters.map((c, i) => {
    const t = anchors[i] * Math.PI / 180, ax = CX + R_HOOP * Math.cos(t), ay = CY + R_HOOP * Math.sin(t), top = ay + drops[i] - (anchors[i] === 90 ? 0 : 0);
    const col = FEATHER[c.id];
    return `<g class="feather" data-cluster="${c.id}" tabindex="0" role="button" aria-label="${esc(c.name)} circle" style="--feather:${col}">
      <line x1="${f(ax)}" y1="${f(ay + 9)}" x2="${f(ax)}" y2="${f(top)}" class="feather-string"/>
      <circle cx="${f(ax)}" cy="${f(top - 10)}" r="4.5" class="feather-bead"/>
      <path class="feather-vane" d="M${f(ax)} ${f(top)}C${f(ax + 17)} ${f(top + 26)} ${f(ax + 13)} ${f(top + 70)} ${f(ax)} ${f(top + 96)}C${f(ax - 13)} ${f(top + 70)} ${f(ax - 17)} ${f(top + 26)} ${f(ax)} ${f(top)}Z"/>
      <path class="feather-rachis" d="M${f(ax)} ${f(top + 4)}V${f(top + 104)}"/>
      <text x="${f(ax)}" y="${f(top + 126)}" text-anchor="middle">${esc(c.name)}</text>
    </g>`;
  }).join('');
  return `<svg class="weave-svg" viewBox="0 0 1000 1110" role="img" aria-label="The relationship web of Neonix: ${d.nodes.length} people joined by ${d.ties.length} ties">
    <defs>
      <radialGradient id="weave-core" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#cfeaff"/><stop offset=".45" stop-color="#3fa9ff"/><stop offset="1" stop-color="#3fa9ff" stop-opacity="0"/></radialGradient>
      <filter id="weave-glow" x="-20%" y="-20%" width="140%" height="140%"><feGaussianBlur stdDeviation="2.4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>
    </defs>
    <rect class="weave-bg" x="0" y="0" width="1000" height="1110"/>
    <circle class="hoop-aura" cx="${CX}" cy="${CY}" r="${R_HOOP}"/>
    <g class="web">${webRings()}</g>
    <g class="threads" filter="url(#weave-glow)">${threads}</g>
    <circle class="hoop" cx="${CX}" cy="${CY}" r="${R_HOOP}"/>
    <circle class="hoop-wrap" cx="${CX}" cy="${CY}" r="${R_HOOP}"/>
    <circle class="hoop-inner" cx="${CX}" cy="${CY}" r="${R_HOOP - 13}"/>
    <g class="feathers">${feathers}</g>
    <g class="beads">${beads}</g>
    <g class="core" tabindex="0" role="button" aria-label="The secret at the center: the Gloom">
      <circle cx="${CX}" cy="${CY}" r="34" fill="url(#weave-core)" class="core-glow"/>
      <circle cx="${CX}" cy="${CY}" r="9" class="core-bead"/>
    </g>
  </svg>`;
}

function tieList(d, id, esc) {
  const ties = d.ties.filter(t => (t.a === id || t.b === id) && state.show.has(t.visibility));
  const order = { secret: 0, private: 1, public: 2 };
  ties.sort((x, y) => order[x.visibility] - order[y.visibility]);
  if (!ties.length) return '<p class="weave-muted">No ties of the selected kinds.</p>';
  return `<ul class="tie-list">${ties.map(t => {
    const o = d.byId.get(t.a === id ? t.b : t.a);
    return `<li class="vis-${t.visibility}"><button class="tie-who" data-pick="${o.id}"><span class="dot" style="background:${o.color}"></span>${esc(o.name)}</button>
      <span class="tie-meta"><i class="vis-chip vis-${t.visibility}">${VIS[t.visibility].label}</i> ${esc(t.label)}</span>
      <p>${esc(t.description)}</p></li>`;
  }).join('')}</ul>`;
}

function panel(d, esc) {
  const legend = `<div class="weave-legend">${Object.entries(VIS).map(([k, v]) => `<button class="legend-key vis-${k}" data-vis="${k}" aria-pressed="${state.show.has(k)}"><svg viewBox="0 0 34 8" aria-hidden="true"><path d="M1 4H33"/></svg>${v.label}<small>${v.note}</small></button>`).join('')}</div>`;
  if (state.kind === 'node') {
    const n = d.byId.get(state.selected), c = d.clusters.find(c => c.id === n.cluster);
    const count = d.ties.filter(t => t.a === n.id || t.b === n.id).length;
    return `<div class="weave-card">
      <p class="eyebrow">${esc(n.people)} · ${esc(c.name)} circle</p>
      <h2>${esc(n.name)}</h2>
      <p class="weave-tagline">${esc(n.tagline)}</p>
      <p class="weave-muted">${esc(n.summary)}</p>
      <a class="ghost-button" href="#entry/${n.id}">Open the dossier ↗</a>
      <h3>${count} ties</h3>${tieList(d, n.id, esc)}
      ${legend}<button class="weave-clear" data-clear>Show the whole web</button></div>`;
  }
  if (state.kind === 'cluster') {
    const c = d.clusters.find(c => c.id === state.selected), members = new Set(c.members);
    const inner = d.ties.filter(t => members.has(t.a) && members.has(t.b)).length;
    const cross = d.ties.filter(t => members.has(t.a) !== members.has(t.b)).length;
    return `<div class="weave-card">
      <p class="eyebrow">A circle of ${c.members.length}</p>
      <h2>${esc(c.name)}</h2>
      <p class="weave-tagline">${esc(c.binds)}</p>
      <p class="weave-muted">${inner} ties inside the circle, ${cross} reaching out of it.</p>
      <div class="member-list">${c.members.map(id => { const n = d.byId.get(id); return `<button data-pick="${id}"><span class="dot" style="background:${n.color}"></span>${esc(n.name)}</button>`; }).join('')}</div>
      ${legend}<button class="weave-clear" data-clear>Show the whole web</button></div>`;
  }
  if (state.kind === 'core') {
    return `<div class="weave-card">
      <p class="eyebrow">The bead at the center</p>
      <h2>${esc(d.core.name)}</h2>
      ${d.core.body.split('\n\n').map(p => `<p class="weave-body">${esc(p)}</p>`).join('')}
      <h3>Who knows some of it</h3>
      <div class="member-list">${d.core.knowers.map(id => { const n = d.byId.get(id); return `<button data-pick="${id}"><span class="dot" style="background:${n.color}"></span>${esc(n.name)}</button>`; }).join('')}</div>
      <button class="weave-clear" data-clear>Show the whole web</button></div>`;
  }
  return `<div class="weave-card">
    <h2>Read the weave</h2>
    <p class="weave-body">Each bead is a person, colored by their people. Each thread is a tie between two of them, and its color tells you who knows about it. The feathers are the five circles the web falls into, and the bead at the center is the secret the whole city orbits.</p>
    <p class="weave-muted">Hover a bead to trace its threads. Select a bead, a feather or the center to read what binds them.</p>
    ${legend}
    <h3>The five circles</h3>
    <div class="circle-list">${d.clusters.map(c => `<button data-cluster-pick="${c.id}" style="--feather:${FEATHER[c.id]}"><b>${esc(c.name)}</b><span>${c.members.map(id => esc(d.byId.get(id).short)).join(', ')}</span></button>`).join('')}</div>
  </div>`;
}

function highlight(root, d, id, kind) {
  const stage = root.querySelector('.weave-stage');
  stage.classList.toggle('focusing', !!id);
  root.querySelectorAll('.thread').forEach(p => p.classList.remove('lit'));
  root.querySelectorAll('.bead').forEach(b => b.classList.remove('near', 'chosen'));
  root.querySelectorAll('.feather').forEach(b => b.classList.toggle('chosen', kind === 'cluster' && b.dataset.cluster === id));
  stage.classList.toggle('core-chosen', kind === 'core');
  if (!id) return;
  if (kind === 'core') {
    const set = new Set(d.core.knowers);
    root.querySelectorAll('.bead').forEach(b => b.classList.toggle('near', set.has(b.dataset.id)));
    root.querySelectorAll('.thread').forEach(p => { if (set.has(p.dataset.a) && set.has(p.dataset.b)) p.classList.add('lit'); });
    return;
  }
  const members = kind === 'cluster' ? new Set(d.clusters.find(c => c.id === id).members) : new Set([id]);
  root.querySelectorAll('.thread').forEach(p => {
    if (members.has(p.dataset.a) || members.has(p.dataset.b)) {
      p.classList.add('lit');
      root.querySelector(`.bead[data-id="${p.dataset.a}"]`).classList.add('near');
      root.querySelector(`.bead[data-id="${p.dataset.b}"]`).classList.add('near');
    }
  });
  members.forEach(m => root.querySelector(`.bead[data-id="${m}"]`).classList.add('chosen'));
}

function applyFilter(root) {
  root.querySelectorAll('.thread').forEach(p => p.classList.toggle('hidden', !state.show.has([...p.classList].find(c => c.startsWith('vis-')).slice(4))));
}

export function preselect(id) { state.selected = id; state.kind = 'node'; }

export async function mountWeave(main, ctx) {
  const { escape: esc, head } = ctx;
  main.innerHTML = '<p class="loading">Stringing the hoop…</p>';
  let d;
  try { d = await load(); } catch { main.innerHTML = '<div class="empty"><h2>The weave could not load.</h2><p>Refresh the page, or start the local server if you are previewing from disk.</p></div>'; return; }
  const root = document.createElement('div');
  root.className = 'weave-page';
  root.innerHTML = head('THE WEAVE / RELATIONSHIPS', 'Everyone is three threads from everyone.', `${d.nodes.length} people, ${d.ties.length} ties. Every pair in the city is within three steps of each other, and two in three are within two.`) +
    `<div class="weave-layout"><div class="weave-stage">${svg(d, esc)}</div><aside class="weave-panel" aria-live="polite"></aside></div>`;
  main.replaceChildren(root);
  const panelEl = root.querySelector('.weave-panel');
  const draw = () => { panelEl.innerHTML = panel(d, esc); applyFilter(root); highlight(root, d, state.selected, state.kind); };
  const select = (id, kind) => {
    if (state.selected === id && state.kind === kind) { state.selected = null; state.kind = null; }
    else { state.selected = id; state.kind = kind; }
    draw();
    if (window.matchMedia('(max-width: 900px)').matches && state.selected) panelEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  draw();
  const stage = root.querySelector('.weave-stage');
  stage.classList.add('weaving');
  setTimeout(() => stage.classList.remove('weaving'), 2400);
  root.addEventListener('mouseover', e => {
    const b = e.target.closest('.bead');
    if (b) highlight(root, d, b.dataset.id, 'node');
  });
  root.addEventListener('mouseout', e => {
    const b = e.target.closest('.bead');
    if (b && !b.contains(e.relatedTarget)) highlight(root, d, state.selected, state.kind);
  });
  const activate = e => {
    const bead = e.target.closest('.bead'), feather = e.target.closest('.feather'), core = e.target.closest('.core');
    const pick = e.target.closest('[data-pick]'), cpick = e.target.closest('[data-cluster-pick]');
    const vis = e.target.closest('[data-vis]'), clear = e.target.closest('[data-clear]');
    if (bead) return select(bead.dataset.id, 'node');
    if (feather) return select(feather.dataset.cluster, 'cluster');
    if (core) return select('core', 'core');
    if (pick) { state.selected = null; return select(pick.dataset.pick, 'node'); }
    if (cpick) return select(cpick.dataset.clusterPick, 'cluster');
    if (vis) { const k = vis.dataset.vis; state.show.has(k) && state.show.size > 1 ? state.show.delete(k) : state.show.add(k); return draw(); }
    if (clear) { state.selected = null; state.kind = null; return draw(); }
    if (e.target.closest('.weave-bg')) { state.selected = null; state.kind = null; draw(); }
  };
  root.addEventListener('click', activate);
  root.addEventListener('keydown', e => {
    if ((e.key === 'Enter' || e.key === ' ') && e.target.closest('.bead,.feather,.core')) { e.preventDefault(); activate(e); }
    if (e.key === 'Escape' && state.selected) { state.selected = null; state.kind = null; draw(); }
  });
}
