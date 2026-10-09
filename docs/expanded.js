import { preselect } from './weave.js';
// Adds the expanded character file (bio, paradox, secret, ties) to a character's dossier.
let cache = null;
const load = () => (cache ??= fetch('data/characters-expanded.json').then(r => (r.ok ? r.json() : null)).then(d => (d ? new Map(d.characters.map(c => [c.id, c])) : null)).catch(() => null));

export async function enrichDossier(entry, container, ctx) {
  if (entry.type !== 'Characters') return;
  const map = await load();
  const c = map && map.get(entry.id);
  const actions = container.querySelector('.dossier-actions');
  if (!c || !actions || container.querySelector('.expanded-file')) return;
  if (container.querySelector('#dossier-title')?.textContent !== entry.name) return;
  const { escape: esc, byId } = ctx;
  const rows = [['Wants', c.wants], ['Paradox', c.paradox], ['How they read their past', c.construal], ['Secret', c.secret], ['How they cope', c.copes]];
  const section = document.createElement('section');
  section.className = 'expanded-file';
  section.innerHTML = `<p class="expanded-tagline">${esc(c.tagline)}</p>
    ${c.bio.split('\n\n').map(p => `<p>${esc(p)}</p>`).join('')}
    <dl>${rows.map(([k, v]) => `<div><dt>${k}</dt><dd>${esc(v)}</dd></div>`).join('')}</dl>
    <blockquote>${esc(c.voice)}</blockquote>
    <h3>TIES / ${c.ties.length}</h3>
    <div class="related">${c.ties.map(t => `<a href="#entry/${t.id}" class="vis-${t.visibility}" title="${esc(t.visibility)}">${esc(byId.get(t.id)?.name || t.id)} <small>${esc(t.label)}</small></a>`).join('')}</div>
    <h3>COULD HAPPEN NEXT</h3>
    <ul class="expanded-hooks">${c.hooks.map(h => `<li>${esc(h)}</li>`).join('')}</ul>
    <a class="weave-link" href="#weave">Trace these ties in the Weave ↗</a>`;
  section.querySelector('.weave-link').addEventListener('click', () => preselect(c.id));
  actions.before(section);
}
