// The city files: everything the site knows about Neonix, flattened into searchable records.
// Used by the Speak page so the Sage, the Archive and the characters can look things up mid-conversation.
// Everything here runs in the browser; nothing is sent anywhere except the passages a speaker asks for.

const STOP = new Set('a an and are as at be but by for from had has have he her his i in is it its me my of on or our she so that the their them they this to was we were what when where which who why will with you your about does did do how just than then there these those into out up not no'.split(' '));
const stem = w => (w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w);
const tokens = text => (String(text).toLowerCase().replace(/[’']s\b/g, '').match(/[a-z0-9]+/g) || []).filter(w => w.length > 1 && !STOP.has(w)).map(stem);

let built = null;

async function json(path) {
  const res = await fetch(path);
  if (!res.ok) throw Error(`${path} unavailable`);
  return res.json();
}

export function loadCityFiles(byId) {
  return (built ??= build(byId).catch(err => { built = null; throw err; }));
}

async function build(byId) {
  const [chars, weave, story, sage, world] = await Promise.all(['data/characters-expanded.json', 'data/weave.json', 'data/story.json', 'data/sage.json', 'data/world-lore.json'].map(json));
  const name = id => story.names[id]?.name || byId.get(id)?.name || id;
  const clusterName = new Map(weave.clusters.map(c => [c.id, c.name]));
  const tieNote = new Map();
  weave.ties.forEach(t => { tieNote.set(`${t.a}|${t.b}`, t.description); tieNote.set(`${t.b}|${t.a}`, t.description); });
  const VIS = { public: 'known around the city', private: 'known only to those close', secret: 'SECRET, known to almost no one' };
  const docs = [];
  const add = (id, kind, title, text, link) => docs.push({ id, kind, title, text, link });

  // Characters: the original archive entry plus the expanded file.
  const people = new Map(chars.characters.map(c => [c.id, c]));
  for (const c of chars.characters) {
    const entry = byId.get(c.id);
    const ties = c.ties.map(t => `- ${name(t.id)} (${t.id}): ${t.label} [${VIS[t.visibility] || t.visibility}]${tieNote.get(`${c.id}|${t.id}`) ? ' ' + tieNote.get(`${c.id}|${t.id}`) : ''}`);
    add(c.id, 'person', `${c.name}`, [
      `${c.name}: ${c.summary}. "${c.tagline}"`,
      `Circle: ${clusterName.get(c.cluster) || c.cluster}.${c.group ? ' Group: ' + c.group + '.' : ''}${c.affiliations?.length ? ' Affiliations: ' + c.affiliations.join(', ') + '.' : ''}`,
      entry?.body ? `Archive entry: ${entry.body}` : '',
      entry?.visualDirection ? `Appearance (creator): ${entry.visualDirection.body}` : '',
      `Bio: ${c.bio.replace(/\n\n/g, ' ')}`,
      `Wants: ${c.wants}`,
      `Paradox: ${c.paradox}`,
      `How they read their own past: ${c.construal}`,
      `Secret (hidden; they guard it): ${c.secret}`,
      `How they cope: ${c.copes}`,
      c.sage ? `The Sage and them: ${c.sage}` : '',
      `Voice: ${c.voice}`,
      `Ties:\n${ties.join('\n')}`,
      `Could happen next (not yet happened):\n${c.hooks.map(h => '- ' + h).join('\n')}`,
    ].filter(Boolean).join('\n'), `#entry/${c.id}`);
  }

  // Ties, each on its own so "who is X to Y" finds them directly.
  for (const t of weave.ties) add(`tie:${t.a}+${t.b}`, 'tie', `${name(t.a)} and ${name(t.b)}`, `${name(t.a)} and ${name(t.b)}: ${t.label} [${VIS[t.visibility] || t.visibility}]. ${t.description || ''}`, `#entry/${t.a}`);

  // Places, factions, boroughs, peoples and the original lore notes.
  for (const e of byId.values()) {
    if (e.type === 'Characters') continue;
    const facts = [e.people && `People: ${e.people}`, e.borough && `Borough: ${e.borough}`, e.faction && `Affiliation: ${e.faction}`].filter(Boolean).join('. ');
    const links = (e.links || []).map(name).slice(0, 14).join(', ');
    add(e.id, e.type.toLowerCase(), `${e.name} (${e.type.replace(/s$/, '')})`, [`${e.name}. ${e.body}`, facts, e.visualDirection ? `Appearance (creator): ${e.visualDirection.body}` : '', links ? `Connected: ${links}` : ''].filter(Boolean).join('\n'), `#entry/${e.id}`);
  }

  // World lore, including the hidden truths.
  for (const e of world.entries) add(e.id, 'lore', e.name, `${e.spoiler ? '[HIDDEN TRUTH: few in the city know this] ' : ''}${e.name}. ${e.body}`, e.id === 'the-sage' ? '#sage' : null);
  add('timeline', 'lore', 'Timeline of Neonix', 'Timeline of Neonix, newest first:\n' + world.timeline.map(t => `- ${t.when}: ${t.event}`).join('\n'), null);
  add('prologue', 'story', 'Before the forty days', 'Before the forty days (the past):\n' + story.prologue.map(p => `- ${p.when}: ${p.text}`).join('\n'), '#story');

  // The Sage, in pieces fine enough to find.
  add('sage:laws', 'sage', "The Sage's three laws", "The Sage's three laws:\n" + sage.laws.map((l, i) => `${i + 1}. ${l.name} ${l.body}`).join('\n'), '#sage');
  add('sage:moves', 'sage', 'How the Sage moves', 'How the Sage moves (only through mana; it never walks into a room):\n' + sage.moves.map(m => `- ${m.name}: ${m.body}`).join('\n'), '#sage');
  add('sage:history', 'sage', "The Sage's hand in the city", "The Sage's hand in the city's history (what the city saw / what the Sage did beneath):\n" + sage.history.map(h => `- ${h.when}: ${h.surface} / Beneath: ${h.beneath}`).join('\n'), '#sage');
  add('sage:hearers', 'sage', 'Who hears the Sage', 'People who can hear the Sage (the Hum):\n' + sage.hearers.map(h => `- ${h.name} (${h.id}): ${h.hears}`).join('\n'), '#sage');

  // The forty days: one record per plotline, with its events in order.
  const arcEvents = new Map(story.arcs.map(a => [a.id, []]));
  story.events.forEach(e => arcEvents.get(e.arc)?.push(e));
  for (const a of story.arcs) {
    const evs = arcEvents.get(a.id).map(e => `- Day ${e.day}${e.kind === 'fork' ? ' (the fork)' : ''}: ${e.text}${e.open ? ' Left open: ' + e.open : ''}${e.cast?.length ? ' [' + e.cast.map(name).join(', ') + ']' : ''}`);
    add(`arc:${a.id}`, 'story', `${a.name} (plotline)`, `${a.name}: a plotline of the forty days before the Council vote.\nQuestion: ${a.question || ''}\n${a.premise || ''}\nCast: ${(a.cast || []).map(name).join(', ')}\nEvents:\n${evs.join('\n')}`, '#story');
  }
  for (const w of story.whispers) add(`whisper:${w.id}`, 'whisper', `A whisper about ${name(w.about)}`, `Whisper (could happen next; has NOT happened): about ${name(w.about)}: ${w.text}${w.cast.length > 1 ? ' [' + w.cast.map(name).join(', ') + ']' : ''}`, `#entry/${w.about}`);

  // Index for BM25.
  const df = new Map();
  for (const d of docs) {
    d.tf = new Map();
    const words = tokens(d.text);
    d.len = words.length;
    words.forEach(w => d.tf.set(w, (d.tf.get(w) || 0) + 1));
    d.titleWords = new Set(tokens(d.title));
    d.tf.forEach((_, w) => df.set(w, (df.get(w) || 0) + 1));
  }
  const avg = docs.reduce((s, d) => s + d.len, 0) / docs.length;
  const byDocId = new Map(docs.map(d => [d.id, d]));

  const roster = chars.characters.map(c => ({ id: c.id, name: c.name, short: story.names[c.id]?.short || c.name.split(' ')[0], summary: c.summary, tagline: c.tagline, cluster: c.cluster, clusterName: clusterName.get(c.cluster) || '' }));

  function search(query, limit = 6) {
    const q = [...new Set(tokens(query))];
    if (!q.length) return [];
    const N = docs.length;
    const scored = [];
    for (const d of docs) {
      let score = 0;
      for (const w of q) {
        const f = d.tf.get(w);
        if (!f) continue;
        const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
        score += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * d.len / avg));
        if (d.titleWords.has(w)) score += idf * 1.6;
      }
      if (score > 0) scored.push([score, d]);
    }
    scored.sort((a, b) => b[0] - a[0]);
    return scored.slice(0, limit).map(([, d]) => ({ id: d.id, kind: d.kind, title: d.title, text: snippet(d, q) }));
  }

  // The lines of a record that best match, kept in their original order.
  function snippet(d, q, max = 760) {
    if (d.text.length <= max) return d.text;
    const lines = d.text.split('\n');
    const ranked = lines.map((line, i) => [i, i === 0 ? 99 : tokens(line).filter(w => q.includes(w)).length]).filter(([, s]) => s > 0).sort((a, b) => b[1] - a[1]);
    const keep = new Set();
    let size = 0;
    for (const [i] of ranked) { if (size + lines[i].length > max && keep.size) continue; keep.add(i); size += lines[i].length; }
    return [...keep].sort((a, b) => a - b).map(i => (lines[i].length > max ? lines[i].slice(0, max) + '…' : lines[i])).join('\n') + '\n…';
  }

  function open(id) {
    const key = String(id).toLowerCase().trim();
    const d = byDocId.get(String(id).trim()) || docs.find(x => x.title.toLowerCase().replace(/ \(.*\)$/, '') === key) || docs.find(x => x.kind === 'person' && x.title.toLowerCase().includes(key));
    return d ? { id: d.id, kind: d.kind, title: d.title, text: d.text } : null;
  }

  return { search, open, roster, people, story, sage, world, weave, name, docs, link: id => byDocId.get(id)?.link || null, title: id => byDocId.get(id)?.title || id };
}
