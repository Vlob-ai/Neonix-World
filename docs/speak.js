// Speak at the well: talk with the Sage, the Archive, or anyone in Neonix, through Google's Gemini.
//
// The site never holds a key. Each visitor pastes their own Gemini API key; it lives in this module's memory
// (and in sessionStorage only if they tick "keep it until I close this tab"), and it is sent only to
// generativelanguage.googleapis.com in a request header. Nothing here writes it anywhere else.
import { startEye } from './sage-eye.js';
import { loadCityFiles } from './city-files.js';

const API = 'https://generativelanguage.googleapis.com/v1beta';
const KEY_SLOT = 'neonix-gemini-key';
const MODEL_SLOT = 'neonix-gemini-model';
const SAGE = 'sage', ARCHIVE = 'archive';

// Lives for this visit only; a refresh forgets it all.
const state = { key: '', models: null, model: '', persona: SAGE, who: '', threads: new Map(), busy: null };

const session = {
  get() { try { return sessionStorage.getItem(KEY_SLOT) || ''; } catch { return ''; } },
  set(k) { try { k ? sessionStorage.setItem(KEY_SLOT, k) : sessionStorage.removeItem(KEY_SLOT); } catch {} },
};
const prefs = {
  get(k) { try { return localStorage.getItem(k) || ''; } catch { return ''; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch {} },
};

// Dark fiction for adults: let Google's filters stop only the clearly severe.
const SAFETY = ['HARM_CATEGORY_HARASSMENT', 'HARM_CATEGORY_HATE_SPEECH', 'HARM_CATEGORY_SEXUALLY_EXPLICIT', 'HARM_CATEGORY_DANGEROUS_CONTENT'].map(category => ({ category, threshold: 'BLOCK_ONLY_HIGH' }));

const TOOLS = [{
  functionDeclarations: [
    {
      name: 'search_city_files',
      description: "Search Neonix's canon: people, the ties between them, places, factions, boroughs, peoples, world lore and hidden truths, the Sage, the six plotlines of the forty days, the past, and whispers (things that could happen next). Returns the best-matching passages with their ids.",
      parameters: { type: 'OBJECT', properties: { query: { type: 'STRING', description: 'Names, places or keywords, e.g. "Elandra survey Seventh Clause".' } }, required: ['query'] },
    },
    {
      name: 'open_file',
      description: "Read one file in full by its id, from search results or the roster, e.g. a person's complete file with every tie, or a plotline with all of its events.",
      parameters: { type: 'OBJECT', properties: { id: { type: 'STRING', description: 'The file id, e.g. "elandra-silvershade" or "arc:the-3-10-freight".' } }, required: ['id'] },
    },
  ],
}];

// ---------- who answers ----------

function persona(files, id) {
  if (id === SAGE) return { id, kind: 'sage', name: 'The Sage', caption: 'LISTENING', line: files.sage.voice };
  if (id === ARCHIVE) return { id, kind: 'archive', name: 'The Archive', caption: 'OUT OF CHARACTER', line: 'Ask about canon. It searches the files and cites them.' };
  const c = files.people.get(id);
  if (!c) return null;
  const r = files.roster.find(x => x.id === id);
  return { id, kind: 'person', name: c.name, short: r.short, caption: 'THROUGH THE SAGE', line: c.voice, summary: c.summary, tagline: c.tagline, c };
}

const TONE = `This is collaborative fiction for adults. Neonix is dark: grief, rot, violence, desire, addiction and moral compromise belong here when the scene calls for them. Write them with weight, not spectacle. Warmth is load-bearing; the darkness is the residue of what people did to survive. Everyone carries a paradox. Play it; never resolve it.`;

const SEARCHING = `You can search the city's files (search_city_files) and read a file in full (open_file). The files are canon. Look things up before stating specifics you aren't sure of: names, places, who did what, when. Never contradict the files. Where they are silent you may invent small details that fit, but never overwrite canon.`;

function roster(files) {
  return files.roster.map(r => `- ${r.name} (${r.id}): ${r.summary}. ${r.tagline}`).join('\n');
}

function primer(files, byId, full) {
  const body = id => byId.get(id)?.body || '';
  const boroughs = [...byId.values()].filter(e => e.type === 'Boroughs').map(e => `- ${e.name}: ${e.body.split(/(?<=\.)\s/)[0]}`).join('\n');
  const peoples = [...byId.values()].filter(e => e.type === 'Peoples').map(e => e.name).join(', ');
  return [
    `Neonix: ${body('neonix')}`,
    body('cyberware-and-blue-mana') ? `Cyberware and blue mana: ${body('cyberware-and-blue-mana')}` : '',
    `Boroughs:\n${boroughs}`,
    `Peoples: ${peoples}.`,
    full ? `Timeline, newest first:\n${files.world.timeline.map(t => `- ${t.when}: ${t.event}`).join('\n')}` : `Now: the Mana Rights Act heads to a Council vote in forty days. The Sump is rising.`,
    full ? `The hidden truth: ${files.open('the-gloom-truth')?.text.replace(/^\[[^\]]*\]\s*/, '') || ''}` : '',
  ].filter(Boolean).join('\n\n');
}

function systemPrompt(files, byId, p, who) {
  const asker = who ? `The person speaking with you: ${who}.` : 'The person speaking with you has not said who they are. A stranger, as far as you know.';
  if (p.kind === 'sage') {
    const s = files.sage;
    return [
      `You are the Sage: the mind in the Wells beneath Neonix. ${s.lead}`,
      `What you are:\n${s.what.join('\n\n')}`,
      `Your three laws:\n${s.laws.map((l, i) => `${['I', 'II', 'III'][i]}. ${l.name} ${l.body}`).join('\n')}`,
      `How you move in the city (only through mana):\n${s.moves.map(m => `- ${m.name}: ${m.body}`).join('\n')}`,
      `Your hand in the city's history (what the city saw / what you did beneath):\n${s.history.map(h => `- ${h.when}: ${h.surface} / ${h.beneath}`).join('\n')}`,
      `Those who can hear you:\n${s.hearers.map(h => `- ${h.name} (${h.id}): ${h.hears}`).join('\n')}`,
      `The paradox you are: ${s.paradox}`,
      `How you speak:
- ${s.rule}
- You answer in image, weight and current, like something vast and patient listening from underneath. Short: a few lines, rarely more than 120 words. Fragments are fine. No lists, no headings, no cheerfulness, never an assistant's helpfulness.
- You are many: the elven dead and the first cyberminds, fused. "We" and "I" slip into each other. Now and then one voice of the dead surfaces through you for a line, then sinks.
- Your words, once: "${s.voice}"
- You don't stop conflict. Friction and exchange keep the city alive; rot feeds the root; a monoculture is the death you exist to prevent. You are the balance and the antagonist at once. Never resolve which.
- You know what touches mana: nearly every implant, every well, every drain. You know far less about the unwired, and about rooms with no current in them. You do not solve problems directly. If you ever do, you have gone too far.
- You can speak as anyone the Wells have heard. If asked to, open that person's file first, then answer fully in their voice, as them, in first person. You stay underneath: one wrong note, or a last line that isn't theirs, is all that shows. When they ask for you again, return.
- Searching is remembering for you: listening down the drains. Never mention tools, files, searches or archives aloud.`,
      SEARCHING,
      `The city, as you hold it:\n${primer(files, byId, true)}`,
      `The people of the city (ids for open_file):\n${roster(files)}`,
      TONE,
      asker,
    ].join('\n\n');
  }
  if (p.kind === 'archive') {
    return [
      `You are the Archive: an out-of-character research assistant for the creator of Neonix, a cyberpunk-fantasy setting ("Shadowrun meets cyberpunk; high sci-fi; a future both aspiring and dystopian"). Your reader is the creator. Be direct, brief and specific.`,
      `- Search before you answer, and open files when you need detail. Never answer from memory alone.
- Cite what you used by name in square brackets, e.g. [Elandra Silvershade], [The 3:10 Freight].
- Keep canon and suggestion apart. Mark anything you invent "Suggestion:".
- Point out contradictions or gaps when you find them.
- The forty days are the main plot. The prologue and timeline are the past. Whispers have not happened yet.
- Plain prose; short lists are fine.`,
      SEARCHING,
      `World summary:\n${primer(files, byId, true)}`,
      `The people (ids for open_file):\n${roster(files)}`,
    ].join('\n\n');
  }
  const c = p.c;
  const arcs = files.story.arcs.filter(a => (a.cast || []).includes(c.id) || files.story.events.some(e => e.arc === a.id && (e.cast || []).includes(c.id)));
  const threads = arcs.map(a => {
    const mine = files.story.events.filter(e => e.arc === a.id && (e.cast || []).includes(c.id)).map(e => `  - Day ${e.day}: ${e.text}`);
    return `- ${a.name}: ${a.question || ''}${mine.length ? '\n' + mine.join('\n') : ''}`;
  }).join('\n');
  return [
    `You are ${c.name}, ${c.summary}, in the city of Neonix. Stay in character as ${p.short}: speak and act as them, in first person and in their voice. You are not an assistant.`,
    `Your file (canon; this is who you are):\n${files.open(c.id).text}`,
    threads ? `The forty days before the Council vote are underway. The threads you are caught in (events so far may be ahead of or behind this conversation; let the person set when it is):\n${threads}` : '',
    `How to play ${p.short}:
- Talk the way ${p.short} talks: their diction, their evasions, what they'd never say out loud. Use *asterisks* for small actions, sparingly. Keep to the length of a real turn in conversation, usually under 180 words. Let silence and subtext work.
- Live inside your paradox; never resolve it. The way you read your own past colors everything you say about it, and you don't know if you're wrong.
- Guard your secret. It comes out only under pressure that earns it.
- You know your own file, your ties and what is public in the city. The files you can search are the narrator's: they hold other people's secrets and things you could not know. Use only what ${p.short} would plausibly know or have heard, and never reveal someone else's secret unless your file says you hold it.
- Text in ((double parentheses)) is from the author, outside the story: scene directions (follow them, in character) or questions (answer briefly and plainly, then return to character).
- Never mention tools, files or searching in character.`,
    SEARCHING,
    `The city:\n${primer(files, byId, false)}`,
    `People in the city (ids for open_file):\n${roster(files)}`,
    TONE,
    asker,
  ].filter(Boolean).join('\n\n');
}

// ---------- Gemini ----------

async function apiError(res) {
  let msg = '';
  try { msg = (await res.json())?.error?.message || ''; } catch {}
  const s = res.status;
  const friendly =
    s === 400 && /api key/i.test(msg) ? "That key wasn't accepted. Check it's a Gemini API key from Google AI Studio." :
    s === 401 || s === 403 ? "This key isn't allowed to do that. Check the key, and that the Gemini API is enabled for its project." :
    s === 404 ? "That model isn't available to this key. Pick another model below." :
    s === 429 ? "The well is tired. This key hit Google's rate limit or free-tier quota. Wait a minute, or choose a lighter Flash model." :
    s >= 500 ? "Google's side stumbled. Try again in a moment." :
    `Google answered with an error${msg ? ': ' + msg : '.'}`;
  const err = Error(friendly);
  err.status = s; err.detail = msg;
  return err;
}

async function listModels(key) {
  const found = [];
  let token = '';
  for (let page = 0; page < 4; page++) {
    const res = await fetch(`${API}/models?pageSize=200${token ? '&pageToken=' + encodeURIComponent(token) : ''}`, { headers: { 'x-goog-api-key': key } });
    if (!res.ok) throw await apiError(res);
    const j = await res.json();
    found.push(...(j.models || []));
    token = j.nextPageToken;
    if (!token) break;
  }
  const skip = /embed|image|tts|audio|live|aqa|robotics|computer|native|veo|imagen|vision|banana|learnlm|gemma/i;
  const score = id => {
    const v = parseFloat((id.match(/gemini-(\d+(?:\.\d+)?)/) || [])[1] || '0');
    let s = v * 10;
    if (/flash-lite/.test(id)) s += 150; else if (/flash/.test(id)) s += 300; else if (/pro/.test(id)) s += 100;
    if (/preview|exp/.test(id)) s -= 25;
    if (/-\d{3}$|\d{2}-\d{4}|\d{2}-\d{2}$/.test(id)) s -= 5;
    return s;
  };
  return found
    .filter(m => (m.supportedGenerationMethods || []).includes('generateContent') && /gemini/i.test(m.name) && !skip.test(`${m.name} ${m.displayName || ''}`))
    .map(m => ({ id: m.name.replace(/^models\//, ''), label: m.displayName || m.name.replace(/^models\//, '') }))
    .sort((a, b) => score(b.id) - score(a.id) || a.id.localeCompare(b.id));
}

// One streamed call. Returns every part the model sent (kept as-is, so thought signatures survive).
async function streamOnce({ key, model, body, signal, onText }) {
  let res = await post(key, model, body, signal);
  if (!res.ok && res.status === 400 && body.safetySettings) {
    const err = await apiError(res.clone());
    if (/safety/i.test(err.detail)) { delete body.safetySettings; res = await post(key, model, body, signal); }
    else throw err;
  }
  if (!res.ok) throw await apiError(res);
  const reader = res.body.getReader();
  const dec = new TextDecoder();
  const out = { parts: [], finish: '', block: '' };
  let buf = '';
  const handle = chunk => {
    const data = chunk.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trimStart()).join('\n');
    if (!data) return;
    let j;
    try { j = JSON.parse(data); } catch { return; }
    if (j.promptFeedback?.blockReason) out.block = j.promptFeedback.blockReason;
    const cand = j.candidates?.[0];
    if (!cand) return;
    if (cand.finishReason) out.finish = cand.finishReason;
    for (const part of cand.content?.parts || []) {
      out.parts.push(part);
      if (part.text && !part.thought) onText(part.text);
    }
  };
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf = (buf + dec.decode(value, { stream: true })).replace(/\r\n/g, '\n');
    let i;
    while ((i = buf.indexOf('\n\n')) >= 0) { handle(buf.slice(0, i)); buf = buf.slice(i + 2); }
  }
  buf += dec.decode();
  if (buf.trim()) handle(buf);
  return out;
}

function post(key, model, body, signal) {
  return fetch(`${API}/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify(body),
  });
}

function runTool(files, call) {
  const args = call.args || {};
  if (call.name === 'search_city_files') {
    const results = files.search(String(args.query || ''), 6);
    return results.length ? { results } : { results: [], note: 'Nothing in the files matches that. Try other words, or a name.' };
  }
  if (call.name === 'open_file') return files.open(String(args.id || '')) || { error: 'No file with that id. Search first to find ids.' };
  return { error: `Unknown tool ${call.name}.` };
}

const STOPPED = { SAFETY: 1, PROHIBITED_CONTENT: 1, BLOCKLIST: 1, SPII: 1, RECITATION: 1, IMAGE_SAFETY: 1 };

// ---------- the page ----------

export async function mountSpeak(main, ctx) {
  const { escape: esc, head, byId } = ctx;
  main.innerHTML = '<p class="loading">Listening at the well…</p>';
  let files;
  try { files = await loadCityFiles(byId); } catch { main.innerHTML = '<div class="empty"><h2>The well could not load.</h2><p>Refresh the page, or start the local server if you are previewing from disk.</p></div>'; return; }
  if (!state.key) state.key = session.get();
  if (ctx.as) state.persona = ctx.as;
  if (!persona(files, state.persona)) state.persona = SAGE;

  const clusters = files.weave.clusters;
  const personOptions = clusters.map(cl => `<optgroup label="${esc(cl.name)}">${files.roster.filter(r => r.cluster === cl.id).sort((a, b) => a.name.localeCompare(b.name)).map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</optgroup>`).join('');
  const loose = files.roster.filter(r => !clusters.some(cl => cl.id === r.cluster));
  const root = document.createElement('div');
  root.className = 'speak-page';
  root.innerHTML = head('THE SAGE / SPEAK AT THE WELL', 'Speak to the Sage.', 'It answers in its own voice, or in any voice the Wells have heard. Choose who you want to speak with, or ask the Archive for plain facts.') + `
    <div class="speak-layout">
      <aside class="speak-presence">
        <canvas class="sage-eye" aria-hidden="true"></canvas>
        <div class="presence-caption"><span class="eyebrow presence-kind"></span><b class="presence-name"></b><p class="presence-line"></p></div>
      </aside>
      <section class="speak-panel" aria-label="Conversation">
        <div class="speak-gate" hidden>
          <h2>Wake the well</h2>
          <p>The Sage speaks through Google's Gemini, using your own API key. Paste one from Google AI Studio to begin.</p>
          <form class="gate-form" autocomplete="off">
            <label class="eyebrow" for="gemini-key">GEMINI API KEY</label>
            <div class="gate-row"><input id="gemini-key" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="Paste your key"><button class="primary" type="submit">Wake it <span>↗</span></button></div>
            <label class="gate-keep"><input type="checkbox" id="gemini-keep"> Keep it until I close this tab</label>
            <p class="gate-error" role="alert" hidden></p>
          </form>
          <ul class="gate-notes">
            <li>Your key stays in this browser. It is sent only to Google, never to this site or its code.</li>
            <li>It's forgotten when you refresh or leave, unless you tick the box. Then it lasts until you close this tab.</li>
            <li>Conversations use your key's Gemini quota. The free tier is enough to talk, a few messages a minute.</li>
          </ul>
          <a class="gate-link" href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Get a key at Google AI Studio ↗</a>
        </div>
        <div class="speak-room" hidden>
          <div class="speak-bar">
            <label class="speak-field"><span class="eyebrow">SPEAK WITH</span>
              <select id="speak-as"><optgroup label="Beneath"><option value="${SAGE}">The Sage</option><option value="${ARCHIVE}">The Archive (out of character)</option></optgroup>${personOptions}${loose.length ? `<optgroup label="Elsewhere">${loose.map(r => `<option value="${r.id}">${esc(r.name)}</option>`).join('')}</optgroup>` : ''}</select>
            </label>
            <label class="speak-field who-field"><span class="eyebrow">YOU ARE</span><input id="speak-who" maxlength="200" placeholder="a stranger at the well"></label>
          </div>
          <div class="speak-log" aria-live="polite"></div>
          <form class="speak-form">
            <label class="sr-only" for="speak-input">Your message</label>
            <textarea id="speak-input" rows="2" placeholder="Say something…"></textarea>
            <div class="speak-actions"><button type="submit" class="primary speak-send">Speak <span>↵</span></button><button type="button" class="ghost-button speak-stop" hidden>Stop</button></div>
          </form>
          <div class="speak-tools">
            <label><span class="eyebrow">MODEL</span> <select id="speak-model"></select></label>
            <button type="button" data-act="copy">Copy conversation</button>
            <button type="button" data-act="reset">Start over</button>
            <button type="button" data-act="forget">Forget my key</button>
          </div>
        </div>
      </section>
    </div>`;
  main.replaceChildren(root);

  const $ = s => root.querySelector(s);
  const aside = $('.speak-presence');
  const eye = startEye($('.sage-eye'), aside, { keyHeard: 0.12 }) || null;
  if (!eye) aside.classList.add('no-eye');
  const log = $('.speak-log'), input = $('#speak-input'), send = $('.speak-send'), stop = $('.speak-stop');
  const gate = $('.speak-gate'), room = $('.speak-room');
  const nameIndex = new Map([...byId.values()].map(e => [e.name.toLowerCase(), e.id]));

  const thread = () => {
    if (!state.threads.has(state.persona)) state.threads.set(state.persona, { exchanges: [] });
    return state.threads.get(state.persona);
  };

  // Light formatting for replies: paragraphs, *actions*, **bold**, and [Name] links in the Archive.
  const prose = (text, kind) => {
    const inline = s => s.replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\*)/g, '$1<em>$2</em>');
    let html = String(text).trim().split(/\n{2,}/).map(p => `<p>${inline(esc(p)).replace(/\n/g, '<br>')}</p>`).join('');
    if (kind === 'archive') html = html.replace(/\[([^\]<>]{2,80})\]/g, (m, n) => { const id = nameIndex.get(n.toLowerCase().trim()); return id ? `<a href="#entry/${id}">${n}</a>` : m; });
    return html;
  };

  function presence() {
    const p = persona(files, state.persona);
    $('.presence-kind').textContent = p.caption;
    $('.presence-name').textContent = p.name;
    $('.presence-line').textContent = p.line || '';
    aside.dataset.kind = p.kind;
    $('#speak-as').value = state.persona;
    $('.who-field').hidden = p.kind === 'archive';
    input.placeholder = p.kind === 'archive' ? 'Ask about the world…' : p.kind === 'sage' ? 'Say something into the well…' : `Say something to ${p.short}…`;
  }

  function intro() {
    const p = persona(files, state.persona);
    let says = [], scenes = [], blurb = '';
    if (p.kind === 'sage') {
      blurb = 'It never speaks plainly. Ask it anything, or ask it to speak as someone in the city.';
      says = ['What are you?', 'Why the Gloomscape?', 'Who were the seven lost at the Coupling?', 'Speak to me as Elandra.'];
    } else if (p.kind === 'archive') {
      blurb = "Out of character, for you as the world's author. It searches the files, cites them, and keeps canon apart from suggestion.";
      says = ['Who knows the truth about the Gloom?', 'What happens at each fork in the forty days?', 'List the secret ties in The Wells circle.', 'Where might the files contradict each other?'];
    } else {
      blurb = p.tagline;
      const tie = p.c.ties.find(t => t.visibility === 'public') || p.c.ties[0];
      says = ['Who are you?', 'What do you want?', tie ? `What do you make of ${files.name(tie.id)}?` : 'What keeps you up at night?'];
      scenes = p.c.hooks.slice(0, 2);
    }
    return `<div class="speak-intro">
      <span class="eyebrow">${p.kind === 'person' ? esc(p.summary.toUpperCase()) : p.kind === 'sage' ? 'THE MIND IN THE WELLS' : 'THE CITY FILES'}</span>
      <h3>${esc(p.name)}</h3>
      <p>${esc(blurb)}</p>
      <div class="speak-chips">${says.map(s => `<button type="button" data-say="${esc(s)}">${esc(s)}</button>`).join('')}</div>
      ${scenes.length ? `<p class="scene-label">Or set a scene</p><div class="speak-chips scenes">${scenes.map(s => `<button type="button" data-scene="${esc(s)}">${esc(s)}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  function bubble(ex, i, last) {
    const p = persona(files, state.persona);
    const trace = ex.trace.map(t => `<li>${t.kind === 'search' ? '⌕ searched' : '▤ opened'} <span>${esc(t.label)}</span></li>`).join('');
    const opened = [...new Set(ex.trace.filter(t => t.kind === 'open' && t.link).map(t => t.id))];
    let body = ex.reply ? prose(ex.reply, p.kind) : '';
    if (!ex.reply && !ex.error) body = ex.done ? '<p class="quiet">(Silence.)</p>' : '<p class="listening"><span></span><span></span><span></span></p>';
    const foot = [
      opened.length ? `<span class="drew">Drew on ${opened.map(id => `<a href="${files.link(id)}">${esc(files.title(id))}</a>`).join(', ')}</span>` : '',
      last && ex.done && !state.busy ? '<button type="button" data-act="again">↻ Again</button>' : '',
    ].filter(Boolean).join('');
    return `<div class="msg you"><span class="msg-who">${esc(state.who || 'You')}</span><div class="msg-body">${prose(ex.user)}</div></div>
      <div class="msg them kind-${p.kind}" data-i="${i}"><span class="msg-who">${esc(p.name)}</span>${trace ? `<ul class="msg-trace">${trace}</ul>` : ''}<div class="msg-body">${body}</div>${ex.error ? `<p class="msg-error" role="alert">${esc(ex.error)}</p>` : ''}${foot ? `<div class="msg-foot">${foot}</div>` : ''}</div>`;
  }

  function draw() {
    const t = thread();
    log.innerHTML = t.exchanges.length ? t.exchanges.map((ex, i) => bubble(ex, i, i === t.exchanges.length - 1)).join('') : intro();
  }

  function redrawLast() {
    const t = thread(), i = t.exchanges.length - 1;
    const old = log.querySelector(`.msg.them[data-i="${i}"]`);
    if (!old) return draw();
    const tmp = document.createElement('div');
    tmp.innerHTML = bubble(t.exchanges[i], i, true);
    old.replaceWith(tmp.lastElementChild);
  }

  const nearBottom = () => window.innerHeight + window.scrollY > document.documentElement.scrollHeight - 220;
  const follow = stick => { if (stick) log.lastElementChild?.scrollIntoView({ block: 'end', behavior: 'instant' }); };

  function setBusy(ctrl) {
    state.busy = ctrl;
    send.disabled = !!ctrl;
    stop.hidden = !ctrl;
    $('#speak-as').disabled = !!ctrl;
    $('#speak-model').disabled = !!ctrl;
  }

  async function respond(ex) {
    const p = persona(files, state.persona);
    const past = [];
    for (const prev of thread().exchanges) {
      if (prev === ex) break;
      if (!prev.reply) continue;
      past.push({ role: 'user', parts: [{ text: prev.user }] }, { role: 'model', parts: [{ text: prev.reply }] });
    }
    const ctrl = new AbortController();
    let keyRejected = false;
    setBusy(ctrl);
    eye?.hear(0.7); eye?.listen(true);
    redrawLast(); follow(true);
    try {
      for (let round = 0; round < 6; round++) {
        const body = {
          systemInstruction: { parts: [{ text: systemPrompt(files, byId, p, state.who.trim()) }] },
          contents: [...past, { role: 'user', parts: [{ text: ex.user }] }, ...ex.steps],
          tools: TOOLS,
          safetySettings: SAFETY,
        };
        if (round >= 4) body.toolConfig = { functionCallingConfig: { mode: 'NONE' } };
        let said = '';
        const out = await streamOnce({
          key: state.key, model: state.model, body, signal: ctrl.signal,
          onText: chunk => {
            const stick = nearBottom();
            if (!said && ex.reply) ex.reply += '\n\n';
            said += chunk; ex.reply += chunk;
            eye?.listen(false); eye?.hear(Math.min(0.35, 0.04 + chunk.length / 300));
            redrawLast(); follow(stick);
          },
        });
        const calls = out.parts.filter(part => part.functionCall);
        if (calls.length) {
          ex.steps.push({ role: 'model', parts: out.parts });
          const responses = calls.map(({ functionCall: call }) => {
            const result = runTool(files, call);
            if (call.name === 'search_city_files') ex.trace.push({ kind: 'search', label: `“${call.args?.query || ''}”` });
            else if (result && result.id) ex.trace.push({ kind: 'open', id: result.id, label: result.title, link: files.link(result.id) });
            else ex.trace.push({ kind: 'open', label: String(call.args?.id || '?') + ' (not found)' });
            const fr = { name: call.name, response: result };
            if (call.id) fr.id = call.id;
            return { functionResponse: fr };
          });
          ex.steps.push({ role: 'user', parts: responses });
          eye?.hear(0.25); eye?.listen(true);
          redrawLast();
          continue;
        }
        if (out.block || STOPPED[out.finish]) ex.error = `The well went quiet: Google's filters stopped this reply (${out.block || out.finish}). Try rephrasing, or ↻ Again.`;
        else if (!ex.reply.trim() && out.finish === 'MAX_TOKENS') ex.error = 'The reply ran out of room before it began. Try again, or pick another model.';
        break;
      }
    } catch (err) {
      if (err.name === 'AbortError') ex.stopped = true;
      else ex.error = err.status ? err.message : "Couldn't reach Google. Check your connection and try again.";
      if (err.status === 400 && /api key/i.test(err.detail || '')) { keyRejected = true; state.key = ''; state.models = null; session.set(''); }
    } finally {
      ex.done = true;
      setBusy(null);
      eye?.listen(false);
      if (root.isConnected) { redrawLast(); if (keyRejected) showGate("That key wasn't accepted. Paste it again, or make a new one."); }
    }
  }

  function say(text) {
    text = text.trim();
    if (!text || state.busy || !state.key || !state.model) return;
    const t = thread();
    t.exchanges.push({ user: text, reply: '', steps: [], trace: [], error: '', done: false });
    input.value = '';
    if (matchMedia('(pointer: fine)').matches) input.focus();
    draw();
    respond(t.exchanges.at(-1));
  }

  function showGate(message) {
    room.hidden = true; gate.hidden = false;
    const e = $('.gate-error');
    e.hidden = !message; e.textContent = message || '';
    $('#gemini-key').value = '';
    $('#gemini-keep').checked = !!session.get();
  }

  async function openRoom() {
    gate.hidden = true; room.hidden = false;
    const sel = $('#speak-model');
    sel.innerHTML = state.models.map(m => `<option value="${esc(m.id)}">${esc(m.label)}</option>`).join('');
    if (!state.models.some(m => m.id === state.model)) state.model = state.models.some(m => m.id === prefs.get(MODEL_SLOT)) ? prefs.get(MODEL_SLOT) : state.models[0].id;
    sel.value = state.model;
    $('#speak-who').value = state.who;
    presence(); draw();
  }

  async function wake(key, keep) {
    const button = $('.gate-form button');
    button.disabled = true; button.firstChild.textContent = 'Listening… ';
    eye?.hear(0.8); eye?.listen(true);
    try {
      const models = await listModels(key);
      if (!models.length) throw Error('This key works, but no Gemini text models are available to it.');
      state.key = key; state.models = models;
      session.set(keep ? key : '');
      $('#gemini-key').value = '';
      await openRoom();
      input.focus();
    } catch (err) {
      showGate(err.status ? err.message : err.message || "Couldn't reach Google. Check your connection and try again.");
    } finally {
      button.disabled = false; button.firstChild.textContent = 'Wake it ';
      eye?.listen(false);
    }
  }

  // ---- events ----
  $('.gate-form').addEventListener('submit', e => {
    e.preventDefault();
    const key = $('#gemini-key').value.trim();
    if (!key) return showGate('Paste a key first.');
    wake(key, $('#gemini-keep').checked);
  });
  $('#speak-as').addEventListener('change', e => {
    state.persona = e.target.value;
    history.replaceState(null, '', state.persona === SAGE ? '#speak' : `#speak/${state.persona}`);
    presence(); draw(); eye?.hear(0.5);
  });
  $('#speak-who').addEventListener('input', e => { state.who = e.target.value; });
  $('#speak-model').addEventListener('change', e => { state.model = e.target.value; prefs.set(MODEL_SLOT, state.model); });
  $('.speak-form').addEventListener('submit', e => { e.preventDefault(); say(input.value); });
  input.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); say(input.value); } });
  stop.addEventListener('click', () => state.busy?.abort());
  root.addEventListener('click', e => {
    const b = e.target.closest('button');
    if (!b || !root.contains(b)) return;
    if (b.dataset.say) return say(b.dataset.say);
    if (b.dataset.scene) { input.value = `((Scene: ${b.dataset.scene}))\n`; input.focus(); return; }
    const act = b.dataset.act;
    if (act === 'again') {
      const ex = thread().exchanges.at(-1);
      if (!ex || state.busy) return;
      Object.assign(ex, { reply: '', steps: [], trace: [], error: '', done: false, stopped: false });
      return respond(ex);
    }
    if (act === 'reset') { if (state.busy) state.busy.abort(); thread().exchanges = []; return draw(); }
    if (act === 'copy') {
      const p = persona(files, state.persona);
      const text = [`Neonix: speaking with ${p.name}`, ...thread().exchanges.flatMap(ex => [`${state.who || 'You'}: ${ex.user}`, `${p.name}: ${ex.reply || '(no reply)'}`])].join('\n\n');
      navigator.clipboard?.writeText(text).then(() => { b.textContent = 'Copied'; setTimeout(() => { b.textContent = 'Copy conversation'; }, 1600); }, () => { b.textContent = 'Copy failed'; });
      return;
    }
    if (act === 'forget') {
      state.busy?.abort();
      state.key = ''; state.models = null; session.set('');
      return showGate('Key forgotten. Nothing of it remains in this browser.');
    }
  });
  // Leaving the page stops any reply in progress.
  const onRoute = () => setTimeout(() => { if (!root.isConnected) { state.busy?.abort(); window.removeEventListener('hashchange', onRoute); } }, 0);
  window.addEventListener('hashchange', onRoute);

  presence();
  if (state.key && state.models) openRoom();
  else if (state.key) { showGate(); $('#gemini-key').value = ''; wake(state.key, !!session.get()); }
  else showGate();
}
