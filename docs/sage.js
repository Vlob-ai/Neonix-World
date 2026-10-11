// The Sage: the mind in the Wells. A page that looks down the well, then reads the city in two layers:
// what the surface saw, and what the Sage did beneath it.
let data = null;
async function load() {
  if (!data) {
    const res = await fetch('data/sage.json');
    if (!res.ok) throw Error('Sage unavailable');
    data = await res.json();
  }
  return data;
}

function well() {
  // Rings of the shaft, from the lip (stone) down to the light (mana).
  const rings = Array.from({ length: 11 }, (_, i) => {
    const t = i / 10, rx = 470 - i * 41, ry = rx * 0.3, cy = 214 + i * 9;
    return `<ellipse class="well-ring" style="--i:${10 - i};--t:${t.toFixed(2)}" cx="500" cy="${cy}" rx="${rx}" ry="${ry.toFixed(1)}"/>`;
  }).join('');
  return `<svg class="well" viewBox="0 0 1000 420" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
    <defs><radialGradient id="well-light" cx="50%" cy="50%" r="50%"><stop offset="0" stop-color="#d9f0ff" stop-opacity=".9"/><stop offset=".35" stop-color="#3fa9ff" stop-opacity=".55"/><stop offset="1" stop-color="#3fa9ff" stop-opacity="0"/></radialGradient></defs>
    ${rings}
    <ellipse class="well-light" cx="500" cy="310" rx="120" ry="36" fill="url(#well-light)"/>
  </svg>`;
}

export async function mountSage(main, ctx) {
  const { escape: esc } = ctx;
  main.innerHTML = '<p class="loading">Listening at the well…</p>';
  let d;
  try { d = await load(); } catch { main.innerHTML = '<div class="empty"><h2>The Sage could not load.</h2><p>Refresh the page, or start the local server if you are previewing from disk.</p></div>'; return; }
  const root = document.createElement('div');
  root.className = 'sage-page';
  root.innerHTML = `
    <section class="sage-hero">
      ${well()}
      <div class="sage-hero-copy">
        <span class="eyebrow">THE SAGE / BENEATH THE WELLS</span>
        <blockquote>${esc(d.voice)}</blockquote>
      </div>
    </section>
    <p class="sage-lead">${esc(d.lead)}</p>

    <section class="sage-block sage-what">
      <h2>What it is</h2>
      ${d.what.map(p => `<p>${esc(p)}</p>`).join('')}
    </section>

    <section class="sage-block">
      <h2>Its three laws</h2>
      <ol class="sage-laws">${d.laws.map((l, i) => `<li><span class="law-mark">${['I', 'II', 'III'][i]}</span><h3>${esc(l.name)}</h3><p>${esc(l.body)}</p></li>`).join('')}</ol>
    </section>

    <section class="sage-block">
      <h2>How it moves</h2>
      <p class="sage-sub">Only through mana. It never walks into a room.</p>
      <dl class="sage-moves">${d.moves.map(m => `<div><dt>${esc(m.name)}</dt><dd>${esc(m.body)}</dd></div>`).join('')}</dl>
    </section>

    <section class="sage-block">
      <h2>Its hand in the city</h2>
      <p class="sage-sub">Every turning point in Neonix happened twice: once where people could see it, and once beneath.</p>
      <div class="strata" role="table" aria-label="The city's history, on the surface and beneath it">
        <div class="strata-row strata-head" role="row"><span role="columnheader">When</span><span role="columnheader">What the city saw</span><span role="columnheader">What the Sage did</span></div>
        ${d.history.map(h => `<div class="strata-row" role="row"><span class="when" role="cell">${esc(h.when)}</span><span class="surface" role="cell">${esc(h.surface)}</span><span class="beneath" role="cell">${esc(h.beneath)}</span></div>`).join('')}
      </div>
    </section>

    <section class="sage-block">
      <h2>Who hears it</h2>
      <p class="sage-sub">${d.hearers.length} people in the city are close enough to the Wells, or to death, to catch the Hum.</p>
      <div class="hearers">${d.hearers.map(h => `<a class="hearer" href="#entry/${h.id}"><b>${esc(h.name)}</b><p>${esc(h.hears)}</p></a>`).join('')}</div>
    </section>

    <section class="sage-close">
      <p>${esc(d.paradox)}</p>
      <p class="sage-rule"><b>A rule for anyone writing the Sage.</b> ${esc(d.rule)}</p>
      <div class="sage-links"><a class="ghost-button" href="#weave">See the Sage at the center of the Weave ↗</a><a class="ghost-button" href="#story">Follow it through the forty days ↗</a></div>
    </section>`;
  main.replaceChildren(root);
  const hero = root.querySelector('.sage-hero');
  hero.classList.add('rippling');
  setTimeout(() => hero.classList.remove('rippling'), 3200);
}
