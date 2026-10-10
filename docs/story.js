// Story: the forty days, as a feed of events, plus the whispers (roleplay openers).
let data = null;
const state = { view: 'days', arcs: null, circle: '' };

async function load() {
  if (!data) {
    const res = await fetch('data/story.json');
    if (!res.ok) throw Error('Story unavailable');
    data = await res.json();
    data.arcById = new Map(data.arcs.map(a => [a.id, a]));
  }
  return data;
}

const pad = n => String(n).padStart(2, '0');

function chips(d, ids, esc) {
  if (!ids || !ids.length) return '';
  return `<div class="cast">${ids.map(id => `<a href="#entry/${id}">${esc(d.names[id]?.name || id)}</a>`).join('')}</div>`;
}

function daysView(d, esc) {
  const on = state.arcs;
  const shown = d.events.filter(e => on.has(e.arc));
  const seen = new Set();
  const byDay = new Map();
  shown.forEach(e => { if (!byDay.has(e.day)) byDay.set(e.day, []); byDay.get(e.day).push(e); });
  const prologue = on.size === d.arcs.length ? `<section class="prologue" aria-label="Before the forty days">
      <h2>Before the forty days</h2>
      <ol>${d.prologue.map(p => `<li><span class="when">${esc(p.when)}</span><p>${esc(p.text)}</p></li>`).join('')}</ol>
    </section>` : '';
  const days = [...byDay.entries()].map(([day, evs]) => `<section class="day" aria-label="Day ${day}">
      <div class="day-mark"><b>${pad(day)}</b><span>Day</span></div>
      <div class="day-events">${evs.map(e => {
        const arc = d.arcById.get(e.arc);
        let opener = '';
        if (!seen.has(e.arc) && e.kind === 'beat') {
          seen.add(e.arc);
          opener = `<article class="event thread-start" style="--arc:${arc.color}"><header><span class="arc-dot"></span><span>A thread begins</span></header><h3>${esc(arc.name)}</h3><p class="question">${esc(arc.question)}</p><p>${esc(arc.premise)}</p></article>`;
        }
        if (e.kind === 'fork') return opener + `<article class="event fork" style="--arc:${arc.color}"><header><span class="arc-dot"></span><button class="arc-name" data-only="${arc.id}">${esc(arc.name)}</button><span class="fork-tag">The fork</span></header><p>${esc(e.text)}</p><p class="left-open"><b>Left open:</b> ${esc(e.open)}</p>${chips(d, e.cast, esc)}</article>`;
        return opener + `<article class="event" style="--arc:${arc.color}"><header><span class="arc-dot"></span><button class="arc-name" data-only="${arc.id}">${esc(arc.name)}</button></header><p>${esc(e.text)}</p>${chips(d, e.cast, esc)}</article>`;
      }).join('')}</div>
    </section>`).join('');
  const filters = `<div class="filters story-filters" role="group" aria-label="Filter by plotline">${d.arcs.map(a => `<button class="arc-toggle" data-arc="${a.id}" aria-pressed="${on.has(a.id)}" style="--arc:${a.color}"><span class="arc-dot"></span>${esc(a.name)}</button>`).join('')}${on.size < d.arcs.length ? '<button class="ghost-button" data-all>Show every thread</button>' : ''}<span class="result-count" aria-live="polite">${shown.length} events</span></div>`;
  return filters + `<div class="feed">${prologue}${days}${shown.length ? '' : '<div class="empty"><h2>No thread selected.</h2><p>Pick a plotline above to follow it through the forty days.</p></div>'}</div>`;
}

function whispersView(d, esc) {
  const list = d.whispers.filter(w => !state.circle || w.cluster === state.circle);
  const filters = `<div class="filters story-filters" role="group" aria-label="Filter by circle"><button class="arc-toggle plain" data-circle="" aria-pressed="${!state.circle}">Everyone</button>${d.clusters.map(c => `<button class="arc-toggle plain" data-circle="${c.id}" aria-pressed="${state.circle === c.id}">${esc(c.name)}</button>`).join('')}<span class="result-count" aria-live="polite">${list.length} whispers</span></div>`;
  return filters + `<p class="whisper-note">Whispers are things that could happen next: openers for a scene or a session. None of them has happened yet.</p><div class="whispers">${list.map(w => `<article class="whisper"><a class="whisper-who" href="#entry/${w.about}">${esc(d.names[w.about].name)}</a><p>${esc(w.text)}</p>${chips(d, w.cast.filter(id => id !== w.about), esc)}</article>`).join('')}</div>`;
}

export async function mountStory(main, ctx) {
  const { escape: esc, head } = ctx;
  main.innerHTML = '<p class="loading">Opening the city files…</p>';
  let d;
  try { d = await load(); } catch { main.innerHTML = '<div class="empty"><h2>The story could not load.</h2><p>Refresh the page, or start the local server if you are previewing from disk.</p></div>'; return; }
  if (!state.arcs) state.arcs = new Set(d.arcs.map(a => a.id));
  const root = document.createElement('div');
  root.className = 'story-page';
  const draw = () => {
    root.innerHTML = head('STORY / THE FORTY DAYS', 'Forty days that could break the city.', 'Six plotlines run at once and collide before the Council votes. Read them day by day, follow a single thread, or browse the whispers for what could happen next.') +
      `<div class="story-tabs" role="tablist"><button role="tab" aria-selected="${state.view === 'days'}" data-view="days">The forty days</button><button role="tab" aria-selected="${state.view === 'whispers'}" data-view="whispers">Whispers <small>${d.whispers.length}</small></button></div>` +
      (state.view === 'days' ? daysView(d, esc) : whispersView(d, esc));
  };
  draw();
  main.replaceChildren(root);
  root.addEventListener('click', e => {
    const view = e.target.closest('[data-view]'), arc = e.target.closest('[data-arc]'), only = e.target.closest('[data-only]');
    const all = e.target.closest('[data-all]'), circle = e.target.closest('[data-circle]');
    if (view) { state.view = view.dataset.view; return draw(); }
    if (arc) {
      const id = arc.dataset.arc;
      if (state.arcs.size === d.arcs.length) state.arcs = new Set([id]);
      else if (state.arcs.has(id)) state.arcs.delete(id);
      else state.arcs.add(id);
      if (!state.arcs.size) state.arcs = new Set(d.arcs.map(a => a.id));
      return draw();
    }
    if (only) { state.arcs = new Set([only.dataset.only]); draw(); return root.scrollIntoView({ behavior: 'smooth' }); }
    if (all) { state.arcs = new Set(d.arcs.map(a => a.id)); return draw(); }
    if (circle) { state.circle = circle.dataset.circle; return draw(); }
  });
}
