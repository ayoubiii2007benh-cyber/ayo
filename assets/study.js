/* Study methods: Active Recall, the Feynman Technique, Blurting and Apex Flash (this site's flashcards).

   Fetched by `Methods` in assets/app.js the first time the Methods view opens, so none of it is part of the
   dashboard's first paint. A plain script like boot.js and consent.js, wrapped in a function so nothing leaks. It
   uses a few of the app's own top-level names -- state, Timer, UI, Icons, showToast, makeId, todayStr, clampInt --
   and exposes window.StudyMethods ({ show, onNavigate }).

   Everything the learner writes stays in this browser: localStorage keys studyDecks, studyFeynman and
   studyBlurting, validated on every load the way assets/app.js validates its own keys. Nothing is sent to the
   server. Edits are saved as you type; a change made in another tab reloads this one's copy instead of being
   overwritten by it. UI text is translated by I18n in app.js; everything the learner writes is marked
   data-i18n-skip so it is never touched, and examples are created in the language currently shown. */
(function () {
  'use strict';

  /* ============================== helpers ============================== */

  /** Small DOM builder: h('button', { class: 'btn', onclick }, 'Label', child). Strings are always added as text. */
  function h(tag, props, ...kids) {
    const el = document.createElement(tag);
    if (props) {
      for (const [key, val] of Object.entries(props)) {
        if (val === null || val === undefined || val === false) continue;
        if (key === 'class') el.className = val;
        else if (key.startsWith('on')) el.addEventListener(key.slice(2), val);
        else if (key === 'value' || key === 'checked' || key === 'disabled' || key === 'open') el[key] = val;
        else el.setAttribute(key, val === true ? '' : String(val));
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid === null || kid === undefined || kid === false) continue;
      el.append(kid instanceof Node ? kid : String(kid));
    }
    return el;
  }
  /** Replaces an element's content; like h(), it skips null/false and flattens arrays (replaceChildren doesn't). */
  function fill(el, ...kids) {
    el.replaceChildren(...kids.flat(Infinity).filter((kid) => kid !== null && kid !== undefined && kid !== false));
    return el;
  }
  let uid = 0;
  const nextId = (prefix) => `${prefix}-${++uid}`;
  /** Brings a tool card back into view when its top has scrolled above the screen (e.g. after a long answer). */
  function keepInView(container) {
    if (container.getBoundingClientRect().top < 0) container.scrollIntoView({ block: 'start' });
  }

  // Line icons in the app's style (20x20, .icon--stroke).
  const ICONS = {
    back: '<path d="M11.5 4.5 6 10l5.5 5.5"/>',
    plus: '<path d="M10 4.5v11M4.5 10h11"/>',
    close: '<path d="M5 5l10 10M15 5L5 15"/>',
    trash: '<path d="M4 6h12"/><path d="M7.5 6V4.3c0-.6.5-1.1 1.1-1.1h2.8c.6 0 1.1.5 1.1 1.1V6"/><path d="M5.5 6l.6 9.2c0 .7.6 1.3 1.3 1.3h5.2c.7 0 1.3-.6 1.3-1.3L14.5 6"/>',
    copy: '<rect x="6.5" y="6.5" width="10" height="10" rx="2"/><path d="M13.5 6.5V5A1.5 1.5 0 0 0 12 3.5H5A1.5 1.5 0 0 0 3.5 5v7A1.5 1.5 0 0 0 5 13.5h1.5"/>',
    clock: '<circle cx="10" cy="11" r="6.5"/><path d="M10 7.8V11l2.2 1.4M8 2.8h4"/>',
    recall: '<path d="M4 4.5h12A1.5 1.5 0 0 1 17.5 6v7a1.5 1.5 0 0 1-1.5 1.5H9.5L6 17.3v-2.8H4A1.5 1.5 0 0 1 2.5 13V6A1.5 1.5 0 0 1 4 4.5Z"/><path d="M8.2 8.1a1.8 1.8 0 1 1 2.5 1.6c-.5.2-.7.6-.7 1.1v.3M10 12.6v.1"/>',
    feynman: '<path d="M7.6 14.6h4.8M8.2 17h3.6M10 2.6a5.2 5.2 0 0 0-3 9.4c.5.4.8.9.8 1.5v1.1h4.4v-1.1c0-.6.3-1.1.8-1.5a5.2 5.2 0 0 0-3-9.4Z"/>',
    blurting: '<path d="M3.5 16.5l.9-3.6L12.6 4.7a1.6 1.6 0 0 1 2.3 0l.4.4a1.6 1.6 0 0 1 0 2.3L7.1 15.6z"/><path d="M11 16.5h5.5"/>',
    flash: '<rect x="2.5" y="6" width="11" height="11" rx="2.2"/><path d="M6.5 6v-.8A2.2 2.2 0 0 1 8.7 3h6.1A2.2 2.2 0 0 1 17 5.2v6.1a2.2 2.2 0 0 1-2.2 2.2h-1.3"/>',
  };
  function icon(name) {
    const holder = document.createElement('span');
    holder.innerHTML = `<svg class="icon icon--stroke" viewBox="0 0 20 20" aria-hidden="true">${ICONS[name]}</svg>`;
    return holder.firstChild;
  }

  const plural = (n, one, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
  const oneLine = (s) => s.replace(/\s+/g, ' ').trim();
  function shuffled(list) {
    const a = list.slice();
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }

  /* Debounced saves, tracked so they can be flushed when the page is hidden or closed, and dropped when another
     tab changes the same data. */
  const pending = new Set();
  function debounced(fn, ms = 400) {
    let timer = null;
    const run = () => { timer = null; pending.delete(api); fn(); };
    const api = () => { clearTimeout(timer); timer = setTimeout(run, ms); pending.add(api); };
    api.flush = () => { if (timer) { clearTimeout(timer); run(); } };
    api.cancel = () => { clearTimeout(timer); timer = null; pending.delete(api); };
    return api;
  }
  const flushAll = () => { for (const p of [...pending]) p.flush(); };
  window.addEventListener('pagehide', flushAll);
  document.addEventListener('visibilitychange', () => { if (document.hidden) flushAll(); });

  // Calendar days as 'YYYY-MM-DD' (local date, like todayStr), counted in UTC so daylight saving never skews them.
  const isDay = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const utc = (day) => { const [y, m, d] = day.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const addDays = (day, n) => new Date(utc(day) + n * 86400000).toISOString().slice(0, 10);
  const daysBetween = (a, b) => Math.round((utc(b) - utc(a)) / 86400000);
  function dayLabel(day) {
    const n = daysBetween(day, todayStr());
    if (n <= 0) return 'today';
    if (n === 1) return 'yesterday';
    if (n < 7) return `${n} days ago`;
    return new Date(utc(day)).toLocaleDateString(I18n.locale(), { day: 'numeric', month: 'short', timeZone: 'UTC' });
  }
  function dueLabel(day) {
    const n = daysBetween(todayStr(), day);
    return n <= 0 ? 'today' : n === 1 ? 'tomorrow' : `in ${n} days`;
  }

  /** Moves focus to a tool's heading after its screen changes (and brings the tool into view if it scrolled away). */
  function focusTitle(container) {
    const title = container.querySelector('.sm-tool__title');
    if (!title) return;
    title.focus({ preventScroll: true });
    const top = container.getBoundingClientRect().top;
    if (top < 0 || top > window.innerHeight * 0.6) container.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /** A button that asks before acting when confirmIf() says so, in place: "Question? [Yes] [Cancel]". */
  function actionButton(label, cls, run, { confirmIf, question, yes } = {}) {
    const wrap = h('span', { class: 'sm-confirm' });
    const plain = () => wrap.replaceChildren(h('button', { type: 'button', class: cls, onclick: click }, label));
    const click = () => {
      if (!confirmIf || !confirmIf()) { run(); return; }
      const yesBtn = h('button', { type: 'button', class: 'btn sm-btn-sm btn-danger-solid', onclick: run }, yes);
      wrap.replaceChildren(h('span', { class: 'sm-confirm__q' }, question), yesBtn,
        h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm', onclick: () => { plain(); wrap.querySelector('button').focus(); } }, 'Cancel'));
      yesBtn.focus();
    };
    plain();
    return wrap;
  }
  const confirmButton = (label, question, yes, run) => actionButton(label, 'btn btn-secondary sm-btn-sm btn-danger', run, { confirmIf: () => true, question, yes });

  /** On/off switch styled like the settings toggles. */
  function toggle(label, on, onChange) {
    const btn = h('button', { type: 'button', class: 'sm-toggle', 'aria-pressed': String(on) }, h('span', { class: 'sm-toggle__track', 'aria-hidden': 'true' }), label);
    btn.addEventListener('click', () => {
      const next = btn.getAttribute('aria-pressed') !== 'true';
      btn.setAttribute('aria-pressed', String(next));
      onChange(next);
    });
    return btn;
  }

  /** Round checkbox like the planner's, with its label text. */
  function checkbox(text, checked, onChange) {
    return h('label', { class: 'sm-checkbox' }, h('input', { type: 'checkbox', checked, onchange: (e) => onChange(e.target.checked) }), h('span', { 'data-i18n-skip': '' }, text));
  }

  /** Pill-shaped single choice, like the timer's mode tabs. options: [[value, label], ...] */
  function segmented(label, options, value, onChange) {
    const group = h('div', { class: 'sm-seg', role: 'radiogroup', 'aria-label': label });
    const draw = () => group.replaceChildren(...options.map(([v, text]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(v === value), tabindex: v === value ? '0' : '-1',
      onclick: () => { value = v; draw(); group.querySelector('[aria-checked="true"]').focus(); onChange(v); },
    }, text)));
    group.addEventListener('keydown', (e) => {
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      e.preventDefault();
      const i = options.findIndex(([v]) => v === value);
      const next = options[(i + (e.key === 'ArrowRight' ? 1 : options.length - 1)) % options.length][0];
      value = next; draw(); group.querySelector('[aria-checked="true"]').focus(); onChange(next);
    });
    draw();
    return group;
  }

  /** "1 Concept · 2 Explain · ..." progress pill for the step-by-step tools. */
  function stepper(labels, current) {
    return h('ol', { class: 'sm-steps', 'aria-label': `Step ${current} of ${labels.length}` }, labels.map((text, i) => h('li', {
      class: `sm-step${i + 1 === current ? ' is-current' : ''}${i + 1 < current ? ' is-done' : ''}`,
      'aria-current': i + 1 === current ? 'step' : null,
    }, h('span', { class: 'sm-step__num', 'aria-hidden': 'true' }, String(i + 1)), h('span', { class: 'sm-step__label' }, text))));
  }

  function progressBar(fraction, label) {
    const pct = Math.round(Math.max(0, Math.min(1, fraction)) * 100);
    const fill = h('div', { class: 'skill-row__fill' });
    fill.style.width = `${pct}%`;
    return h('div', { class: 'skill-row__bar sm-progress', role: 'progressbar', 'aria-label': label, 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, fill);
  }

  /** A gap list with an "add" field; gaps: [{ id, text, done }] (edited in place); onChange persists. */
  function gapEditor(gaps, onChange, { placeholder, checkable }) {
    const list = h('ul', { class: 'sm-gaps' });
    const empty = h('p', { class: 'field-hint' }, 'No gaps listed yet.');
    const input = h('input', { class: 'sm-input', type: 'text', maxlength: LIMITS.gap, placeholder, 'aria-label': 'Describe a gap' });
    const draw = () => {
      list.replaceChildren(...gaps.map((g) => h('li', { class: 'sm-gap' },
        checkable ? checkbox(g.text, g.done, (on) => { g.done = on; onChange(); }) : h('span', { 'data-i18n-skip': '' }, g.text),
        h('button', { type: 'button', class: 'icon-btn sm-icon-btn', 'aria-label': `Remove “${g.text}”`, onclick: () => { gaps.splice(gaps.indexOf(g), 1); onChange(); draw(); } }, icon('close')))));
      empty.hidden = gaps.length > 0;
    };
    const add = (text) => {
      const t = oneLine(text).slice(0, LIMITS.gap);
      if (!t || gaps.length >= LIMITS.gaps || gaps.some((g) => g.text.toLowerCase() === t.toLowerCase())) return false;
      gaps.push({ id: makeId(), text: t, done: false });
      onChange(); draw();
      return true;
    };
    draw();
    const form = h('form', { class: 'sm-inline-form', onsubmit: (e) => { e.preventDefault(); if (add(input.value)) input.value = ''; input.focus(); } },
      input, h('button', { type: 'submit', class: 'btn btn-secondary sm-btn-sm sm-btn-icon' }, icon('plus'), 'Add'));
    return { nodes: [form, list, empty], add, has: (text) => gaps.some((g) => g.text.toLowerCase() === text.toLowerCase()), redraw: draw };
  }

  /* ============================== text analysis (rough, on purpose) ============================== */

  const STOPWORDS = new Set(('a about above after again against all almost along also although always am among an and another any anyone anything are '
    + 'around as at back be became because become been before being below between both but by can cannot could did does doing done down during each '
    + 'either else enough etc even ever every few for from further get gets getting give given go goes going gone got had has have having he her here '
    + 'hers him his how however i if in into is it its itself just keep know known last least less let like made make makes making many may me might '
    + 'more most much must my near need never new next no nor not now of off often on once one only onto or other others our out over own part per '
    + 'perhaps quite rather really said same say says see seen several shall she should show shown since so some something sometimes still such take '
    + 'than that the their them themselves then there these they thing things this those though through thus to together too took toward under until '
    + 'up upon us use used uses using usually very via was way ways we well went were what whatever when where whether which while who whole whom whose '
    + 'why will with within without would yes yet you your yours lot lots put try big bit becomes').split(' '));
  // Long words that are still everyday language, so the plain-language check doesn't flag them.
  const EVERYDAY_LONG = new Set(('absolutely actually additional available basically beautiful beginning carefully certainly community comparison '
    + 'completely conversation definitely describe described describing description development difference differences different directions '
    + 'education environment especially eventually everybody everyday everyone everything everywhere example examples experience explaining '
    + 'explanation explanations generally government happening however immediately important importantly including increasing individual '
    + 'information interested interesting international literally naturally obviously opportunity organisation organization particular '
    + 'particularly personally physically population professional relationship remembering remembered situation something sometimes '
    + 'specifically successful technology temperature themselves therefore together traditional ultimately understand understanding '
    + 'unfortunately university usually vegetables yourselves').split(' '));

  const WORD_RE = /[\p{L}\p{N}]+(?:['’][\p{L}]+)?/gu;
  const tokens = (text) => text.match(WORD_RE) || [];
  const norm = (w) => w.toLowerCase().replace(/['’]s$/, '');
  /** Very light stemming so "cells"/"cell" and "evaporates"/"evaporated" count as the same word. */
  function stem(w) {
    if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`;
    if (w.length > 5 && w.endsWith('ing')) return w.slice(0, -3);
    if (w.length > 4 && w.endsWith('ed')) return w.slice(0, -2);
    if (w.length > 4 && /(?:ches|shes|sses|xes|zes)$/.test(w)) return w.slice(0, -2);
    if (w.length > 3 && w.endsWith('s') && !/(?:ss|us|is)$/.test(w)) return w.slice(0, -1);
    return w;
  }
  const sameWord = (a, b) => a === b || (a.length >= 7 && b.length >= 7 && a.slice(0, 6) === b.slice(0, 6));

  /** The words in a text that are most likely to matter: not filler words, longer or more frequent ones first. */
  function keyTerms(text, limit = 30) {
    const seen = new Map();
    tokens(text).forEach((raw, i) => {
      const w = norm(raw);
      if (STOPWORDS.has(w) || (w.length < 3 && !/^\d{2,}$/.test(w))) return;
      const s = stem(w);
      const entry = seen.get(s);
      if (entry) entry.count += 1; else seen.set(s, { stem: s, word: w, count: 1, first: i });
    });
    return [...seen.values()]
      .map((t) => ({ ...t, score: t.count + (t.word.length >= 8 ? 0.5 : 0) }))
      .sort((a, b) => b.score - a.score || a.first - b.first)
      .slice(0, limit);
  }
  /** A test for "does this text mention that term?" (stem match, or the same first six letters for long words). */
  function mentionedIn(text) {
    const stems = new Set(tokens(text).map((w) => stem(norm(w))));
    const long = [...stems].filter((s) => s.length >= 7);
    return (term) => stems.has(term.stem) || (term.stem.length >= 7 && long.some((s) => sameWord(s, term.stem)));
  }

  function sentences(text) {
    return text.replace(/([.!?])\s+/g, '$1\n').split(/\n+/).map((s) => s.trim()).filter((s) => tokens(s).length > 0);
  }
  function syllables(word) {
    let w = word.toLowerCase().replace(/[^a-z]/g, '');
    if (w.length <= 3) return 1;
    w = w.replace(/(?:[^laeiouy]es|ed|[^laeiouy]e)$/, '').replace(/^y/, '');
    const groups = w.match(/[aeiouy]{1,2}/g);
    return groups ? groups.length : 1;
  }
  /** Word and sentence counts, very long sentences, and words a beginner may not know (long, many syllables).
      `topic` words (the concept being explained) are never flagged: that's the word you're explaining. */
  function plainCheck(text, topic = '') {
    const sents = sentences(text);
    const words = tokens(text);
    const skip = new Set(tokens(topic).map((w) => stem(norm(w))));
    const hard = [];
    for (const raw of words) {
      const w = norm(raw);
      if (hard.includes(w) || EVERYDAY_LONG.has(w) || skip.has(stem(w)) || /\d/.test(w)) continue;
      const syl = syllables(w);
      if (w.length >= 13 || (w.length >= 10 && syl >= 3) || (w.length >= 8 && syl >= 4)) hard.push(w);
      if (hard.length >= 8) break;
    }
    return { words: words.length, sentences: sents.length, avg: sents.length ? Math.round(words.length / sents.length) : 0, long: sents.filter((s) => tokens(s).length > 25), hard };
  }
  /** The text with the given words wrapped in <mark>. */
  function highlighted(text, words) {
    const marks = new Set(words);
    const frag = document.createDocumentFragment();
    let last = 0;
    for (const m of text.matchAll(WORD_RE)) {
      if (!marks.has(norm(m[0]))) continue;
      frag.append(text.slice(last, m.index), h('mark', { class: 'sm-mark' }, m[0]));
      last = m.index + m[0].length;
    }
    frag.append(text.slice(last));
    return frag;
  }

  /* ============================== storage ============================== */

  const KEYS = { decks: 'studyDecks', feynman: 'studyFeynman', blurting: 'studyBlurting' };
  const LIMITS = { name: 80, q: 1000, a: 2000, cards: 1000, decks: 100, concept: 120, topic: 120, text: 20000, gap: 200, gaps: 60, notes: 100, sessions: 60 };
  const RATINGS = ['again', 'hard', 'good', 'easy'];
  const RATING_LABEL = { again: 'Again', hard: 'Hard', good: 'Good', easy: 'Easy' };

  function read(key) {
    try { const raw = localStorage.getItem(key); return raw ? JSON.parse(raw) : null; } catch { return null; }
  }
  let warnedAt = 0;
  function write(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); return true; } catch {
      if (Date.now() - warnedAt > 60000) { warnedAt = Date.now(); showToast('Couldn’t save: this browser’s storage is full or turned off.', 'error'); }
      return false;
    }
  }
  const str = (v, max) => (typeof v === 'string' ? v.slice(0, max) : '');
  const idOf = (v) => (typeof v === 'string' && v ? v.slice(0, 64) : makeId());

  function cleanCard(c) {
    if (!c || typeof c !== 'object') return null;
    return {
      id: idOf(c.id), q: str(c.q, LIMITS.q), a: str(c.a, LIMITS.a),
      box: clampInt(c.box, 0, 5, 0), due: isDay(c.due) ? c.due : '', last: RATINGS.includes(c.last) ? c.last : '',
      reps: clampInt(c.reps, 0, 999999, 0), lapses: clampInt(c.lapses, 0, 999999, 0),
    };
  }
  function cleanDeck(d) {
    if (!d || typeof d !== 'object') return null;
    const r = d.recall && typeof d.recall === 'object' && isDay(d.recall.at) ? d.recall : null;
    return {
      id: idOf(d.id), name: str(d.name, LIMITS.name).trim() || 'Untitled deck',
      cards: (Array.isArray(d.cards) ? d.cards : []).map(cleanCard).filter(Boolean).slice(0, LIMITS.cards),
      recall: r ? { at: r.at, got: clampInt(r.got, 0, 99999, 0), partly: clampInt(r.partly, 0, 99999, 0), missed: clampInt(r.missed, 0, 99999, 0) } : null,
    };
  }
  function cleanGaps(list) {
    return (Array.isArray(list) ? list : [])
      .filter((g) => g && typeof g.text === 'string' && g.text.trim())
      .slice(0, LIMITS.gaps)
      .map((g) => ({ id: idOf(g.id), text: oneLine(g.text).slice(0, LIMITS.gap), done: g.done === true }));
  }
  function cleanNote(n) {
    if (!n || typeof n !== 'object') return null;
    return {
      id: idOf(n.id), concept: str(n.concept, LIMITS.concept), explanation: str(n.explanation, LIMITS.text),
      revised: str(n.revised, LIMITS.text), gaps: cleanGaps(n.gaps), step: clampInt(n.step, 1, 4, 1), saved: isDay(n.saved) ? n.saved : '',
    };
  }
  function cleanBlurt(b) {
    if (!b || typeof b !== 'object') return null;
    return {
      id: idOf(b.id), topic: str(b.topic, LIMITS.topic), text: str(b.text, LIMITS.text), notes: str(b.notes, LIMITS.text),
      gaps: cleanGaps(b.gaps), minutes: [0, 5, 10, 15].includes(b.minutes) ? b.minutes : 5, step: clampInt(b.step, 1, 4, 1),
      startedAt: Number.isFinite(b.startedAt) ? b.startedAt : 0, terms: clampInt(b.terms, 0, 999, 0), hits: clampInt(b.hits, 0, 999, 0),
      saved: isDay(b.saved) ? b.saved : '',
    };
  }

  const Store = {
    decks: [],
    feynman: { draft: null, notes: [] },
    blurting: { draft: null, sessions: [] },
    load() {
      const d = read(KEYS.decks);
      Store.decks = (d && Array.isArray(d.decks) ? d.decks : []).map(cleanDeck).filter(Boolean).slice(0, LIMITS.decks);
      const f = read(KEYS.feynman) || {};
      Store.feynman = { draft: cleanNote(f.draft), notes: (Array.isArray(f.notes) ? f.notes : []).map(cleanNote).filter(Boolean).slice(0, LIMITS.notes) };
      const b = read(KEYS.blurting) || {};
      Store.blurting = { draft: cleanBlurt(b.draft), sessions: (Array.isArray(b.sessions) ? b.sessions : []).map(cleanBlurt).filter(Boolean).slice(0, LIMITS.sessions) };
    },
    saveDecks() { return write(KEYS.decks, { v: 1, decks: Store.decks }); },
    saveFeynman() { return write(KEYS.feynman, { v: 1, draft: Store.feynman.draft, notes: Store.feynman.notes }); },
    saveBlurting() { return write(KEYS.blurting, { v: 1, draft: Store.blurting.draft, sessions: Store.blurting.sessions }); },
  };

  /* ============================== decks (shared by Active Recall and Apex Flash) ============================== */

  const EXAMPLE_DECK = {
    name: 'Example: The water cycle',
    cards: [
      ['What is evaporation?', 'Water from oceans, lakes and rivers is warmed by the sun and turns into water vapour.'],
      ['What is condensation?', 'Water vapour cools as it rises and turns into tiny droplets, which form clouds.'],
      ['What is precipitation?', 'Water falling from clouds as rain, snow, sleet or hail.'],
      ['What is transpiration?', 'Plants giving off water vapour through tiny pores in their leaves.'],
      ['What is runoff?', 'Water that flows over the ground into streams, rivers, lakes and the sea.'],
      ['What powers the water cycle?', 'Energy from the sun, with gravity pulling rain and rivers back down.'],
    ],
  };

  const newCard = (q = '', a = '') => ({ id: makeId(), q: q.slice(0, LIMITS.q), a: a.slice(0, LIMITS.a), box: 0, due: '', last: '', reps: 0, lapses: 0 });
  function newDeck(name, pairs = []) {
    if (Store.decks.length >= LIMITS.decks) { showToast(`You can keep up to ${LIMITS.decks} decks.`, 'error'); return null; }
    const deck = { id: makeId(), name: name.slice(0, LIMITS.name), cards: pairs.map(([q, a]) => newCard(q, a)), recall: null };
    Store.decks.unshift(deck);
    Store.saveDecks();
    return deck;
  }
  const exampleDeck = () => {
    const name = I18n.t(EXAMPLE_DECK.name);
    return Store.decks.find((d) => d.name === name) || newDeck(name, EXAMPLE_DECK.cards.map(([q, a]) => [I18n.t(q), I18n.t(a)]));
  };
  const usable = (deck) => deck.cards.filter((c) => c.q.trim());

  /** Cards pasted as text: one per line, question then answer, split at the first tab, " :: ", " | " or " - ". */
  function parseCards(text) {
    const SEPARATORS = ['\t', ' :: ', '::', ' | ', ' - ', ' – ', ' — '];
    const out = [];
    for (const line of text.split(/\r?\n/)) {
      const t = line.trim();
      if (!t) continue;
      const sep = SEPARATORS.find((s) => t.includes(s));
      if (!sep) { out.push([t, '']); continue; }
      const i = t.indexOf(sep);
      out.push([t.slice(0, i).trim(), t.slice(i + sep.length).trim()]);
    }
    return out.filter(([q]) => q);
  }
  function copyDeck(deck) {
    const lines = usable(deck).map((c) => `${oneLine(c.q)}\t${oneLine(c.a)}`);
    if (!lines.length) { showToast('This deck has no cards to copy yet.', 'error'); return; }
    const done = () => showToast(`Copied ${plural(lines.length, 'card')}. Paste them anywhere to keep a copy.`);
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lines.join('\n')).then(done, () => showToast('Couldn’t copy. Your browser blocked it.', 'error'));
    else showToast('Copying isn’t available in this browser.', 'error');
  }

  /** The deck list both tools start from. meta(deck) -> string, actions(deck) -> buttons. */
  function deckRows({ meta, actions, onExample }) {
    if (!Store.decks.length) {
      return h('div', { class: 'sm-empty' },
        h('p', null, 'No decks yet. Try the example deck about the water cycle, or make your own.'),
        h('button', { type: 'button', class: 'btn btn-primary sm-btn-sm', onclick: () => { exampleDeck(); onExample(); } }, 'Add the example deck'));
    }
    return h('ul', { class: 'sm-list' }, Store.decks.map((deck) => h('li', { class: 'sm-row' },
      h('div', { class: 'sm-row__main' }, h('strong', { 'data-i18n-skip': '' }, deck.name), h('span', { class: 'sm-row__meta' }, meta(deck))),
      h('div', { class: 'sm-row__actions' }, actions(deck)))));
  }

  /** Deck editor (nodes for a tool card). Every edit is saved as you type; "Done" tidies up and returns. */
  function deckEditor(deck, onDone) {
    const save = debounced(() => Store.saveDecks());
    const count = h('span', { class: 'sm-row__meta' });
    const recount = () => { count.textContent = plural(deck.cards.length, 'card'); };
    const list = h('ol', { class: 'sm-cards' });
    const row = (card) => {
      const li = h('li', { class: 'sm-card-edit' },
        h('div', { class: 'sm-card-edit__fields' },
          h('textarea', { class: 'sm-textarea sm-textarea--sm', rows: 2, maxlength: LIMITS.q, placeholder: 'Question', 'aria-label': 'Question', value: card.q, oninput: (e) => { card.q = e.target.value; save(); } }),
          h('textarea', { class: 'sm-textarea sm-textarea--sm', rows: 2, maxlength: LIMITS.a, placeholder: 'Answer', 'aria-label': 'Answer', value: card.a, oninput: (e) => { card.a = e.target.value; save(); } })),
        h('button', { type: 'button', class: 'icon-btn sm-icon-btn', 'aria-label': 'Delete this card', onclick: () => { deck.cards.splice(deck.cards.indexOf(card), 1); li.remove(); recount(); save(); } }, icon('trash')));
      return li;
    };
    const addCard = () => {
      if (deck.cards.length >= LIMITS.cards) { showToast(`A deck can hold up to ${LIMITS.cards} cards.`, 'error'); return; }
      const card = newCard();
      deck.cards.push(card);
      const li = row(card);
      list.append(li);
      recount();
      li.querySelector('textarea').focus();
    };
    if (!deck.cards.length) deck.cards.push(newCard());
    list.append(...deck.cards.map(row));
    recount();

    const paste = h('textarea', { class: 'sm-textarea', rows: 5, 'aria-label': 'Cards to add, one per line', placeholder: 'What is the capital of France? :: Paris\nla bibliothèque :: the library' });
    const addPasted = () => {
      const pairs = parseCards(paste.value).slice(0, Math.max(0, LIMITS.cards - deck.cards.length));
      if (!pairs.length) { paste.focus(); return; }
      // a single untouched blank card (a brand-new deck) is replaced rather than left at the top
      if (deck.cards.length === 1 && !deck.cards[0].q && !deck.cards[0].a) { deck.cards.length = 0; list.replaceChildren(); }
      for (const [q, a] of pairs) { const card = newCard(q, a); deck.cards.push(card); list.append(row(card)); }
      paste.value = '';
      recount(); save.cancel(); Store.saveDecks();
      showToast(`Added ${plural(pairs.length, 'card')}`);
    };
    const name = h('input', { class: 'sm-input', type: 'text', maxlength: LIMITS.name, value: deck.name, oninput: (e) => { deck.name = e.target.value; save(); } });
    const done = () => {
      deck.name = deck.name.trim() || I18n.t('Untitled deck');
      deck.cards = deck.cards.filter((c) => c.q.trim() || c.a.trim());
      save.cancel(); Store.saveDecks();
      onDone();
    };
    return [
      h('div', { class: 'sm-tool__head' }, h('h3', { class: 'sm-tool__title', tabindex: '-1' }, 'Edit deck'), count),
      h('label', { class: 'sm-label' }, 'Deck name', name),
      list,
      h('div', { class: 'sm-actions' }, h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm sm-btn-icon', onclick: addCard }, icon('plus'), 'Add card')),
      h('details', { class: 'sm-disclosure' },
        h('summary', null, 'Add several cards at once'),
        h('div', { class: 'sm-disclosure__body' },
          h('p', { class: 'field-hint' }, 'One card per line: the question, then the answer, separated by a tab, “ :: ”, “ | ” or “ - ”. Rows copied from a spreadsheet work too.'),
          paste,
          h('div', { class: 'sm-actions' }, h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm', onclick: addPasted }, 'Add these cards')))),
      h('div', { class: 'sm-actions sm-actions--end' },
        h('button', { type: 'button', class: 'btn btn-primary', onclick: done }, 'Done'),
        h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm sm-btn-icon', onclick: () => copyDeck(deck) }, icon('copy'), 'Copy as text'),
        confirmButton('Delete deck', 'Delete this deck and its cards?', 'Delete', () => {
          save.cancel();
          Store.decks = Store.decks.filter((d) => d !== deck);
          Store.saveDecks();
          onDone();
        })),
    ];
  }

  /* Apex Flash scheduling: a simple Leitner box system. Again -> box 1 (due today, and back later in this
     session), Hard -> same box (tomorrow, and once more at the end of this session), Good -> next box,
     Easy -> two boxes up. A card in box n waits INTERVAL[n] days. */
  const INTERVAL = [0, 0, 1, 3, 7, 14];
  const NEW_PER_SESSION = 20;
  function nextBox(card, rating) {
    if (rating === 'again') return 1;
    if (rating === 'hard') return Math.max(1, card.box);
    if (rating === 'good') return Math.min(5, Math.max(2, card.box + 1));
    return Math.min(5, Math.max(3, card.box + 2));
  }
  function nextDue(card, rating) {
    const today = todayStr();
    if (rating === 'again') return today;
    if (rating === 'hard') return addDays(today, 1);
    return addDays(today, INTERVAL[nextBox(card, rating)]);
  }
  /** When the card shows up next: Again a few cards from now, Hard at the end of this session, else its due day. */
  function whenLabel(card, rating) {
    if (rating === 'again') return 'soon';
    if (rating === 'hard') return 'later';
    const days = daysBetween(todayStr(), nextDue(card, rating));
    return days === 1 ? 'tomorrow' : `in ${days} days`;
  }
  /** Cards to study now: reviews that are due (oldest first), then up to 20 cards never studied. */
  function dueCards(deck, today = todayStr()) {
    const cards = usable(deck);
    const reviews = cards.filter((c) => c.reps > 0 && c.due && c.due <= today).sort((a, b) => (a.due < b.due ? -1 : a.due > b.due ? 1 : 0));
    return reviews.concat(cards.filter((c) => c.reps === 0).slice(0, NEW_PER_SESSION));
  }
  const difficultCards = (deck) => usable(deck).filter((c) => c.last === 'again' || c.last === 'hard');

  /* ============================== the method guides ============================== */

  const ORDER = ['recall', 'feynman', 'blurting', 'flash'];
  const METHODS = {
    recall: {
      name: 'Active Recall',
      icon: 'recall',
      tagline: 'Answer from memory first, then check.',
      goodFor: 'finding out what has really stuck after a lesson or a chapter.',
      what: 'Instead of re-reading your notes, you quiz yourself: read a question, try to answer it from memory, and only then look at the answer. The effort of remembering is the practice, and it shows you clearly what you know and what you don’t know yet.',
      when: 'After a class or a reading, while revising for a test, or whenever re-reading feels easy but you’re not sure you could explain it without your notes.',
      steps: [
        'Pick a deck of questions about what you’re studying, or write a few of your own.',
        'Read a question and type what you remember. No peeking.',
        'Reveal the answer and compare it with yours.',
        'Mark how you did, then practise the ones you missed again.',
      ],
      exampleLabel: 'Example',
      example: 'Question: What are the three main stages of the water cycle?\nFrom memory: “evaporation, clouds… rain?”\nThen check: evaporation, condensation and precipitation.',
      exampleAction: 'Try it with the example deck',
    },
    feynman: {
      name: 'Feynman Technique',
      icon: 'feynman',
      tagline: 'Explain it simply to find what you don’t understand yet.',
      goodFor: 'checking that you understand an idea, not just its definition.',
      what: 'You explain a topic in plain words, as if teaching someone who has never studied it. Wherever you get stuck, fall back on jargon or skip a step, you’ve found a gap. Then you fill the gaps and explain it again, more simply. It’s named after the physicist Richard Feynman, who was known for explaining hard ideas in everyday language.',
      when: 'When you can repeat a definition but aren’t sure you could explain why or how it works, or before a test where you’ll have to write explanations.',
      steps: [
        'Choose one concept.',
        'Explain it in simple words, as if to a 12-year-old.',
        'Mark the gaps: terms you didn’t explain, steps you skipped, places you got stuck.',
        'Check your notes for each gap, then rewrite your explanation more simply.',
      ],
      exampleLabel: 'Starter prompt',
      example: 'Explain photosynthesis to a friend who has never taken biology. Use one everyday comparison, and avoid any word you couldn’t define yourself.',
      exampleAction: 'Use this prompt',
    },
    blurting: {
      name: 'Blurting',
      icon: 'blurting',
      tagline: 'Write down everything you remember, then find the gaps.',
      goodFor: 'reviewing a topic you studied a few days ago.',
      what: 'You put your notes away and quickly write everything you can remember about a topic: facts, names, steps and examples, in any order. Then you compare what you wrote with your notes to see what you missed, and study those parts.',
      when: 'When reviewing a topic you’ve already learned, for example at the end of a week or before a test, to see how much you can recall without help.',
      steps: [
        'Choose a topic and put your notes away.',
        'Set a short timer (5–10 minutes is plenty) and write everything you remember.',
        'If you like, paste your notes in to compare.',
        'List what you missed, review it, and blurt the topic again another day.',
      ],
      exampleLabel: 'Example',
      example: 'Topic: the water cycle. Write every stage, process and example you can think of, then compare it with your notes.',
      exampleAction: 'Use this topic',
    },
    flash: {
      name: 'Apex Flash',
      icon: 'flash',
      tagline: 'Flashcards that bring back the cards you find hard.',
      goodFor: 'facts, vocabulary, definitions and formulas.',
      note: 'Apex Flash is the name of this site’s flashcard tool. It isn’t a separate scientific method: it combines two well-studied ideas, answering from memory (retrieval practice) and spreading reviews out over time (spaced review).',
      what: 'Each card has a question on the front and the answer on the back. You answer in your head (or type it), flip the card, and rate how well you knew it. Cards you rate Again or Hard come back sooner; cards you know well wait longer before they’re due again.',
      when: 'For material with clear answers that you want to keep fresh over days and weeks, a few minutes at a time.',
      steps: [
        'Make a deck: one question and answer per card. You can paste many at once.',
        'Read the question and answer it before you reveal the card.',
        'Rate it: Again, Hard, Good or Easy.',
        'Revisit the difficult cards, and come back when cards are due.',
      ],
      exampleLabel: 'Example card',
      example: 'Front: What does a mitochondrion do?\nBack: It turns energy from food into a form the cell can use (ATP).',
      exampleAction: 'Try it with the example deck',
    },
  };

  /* ============================== Active Recall ============================== */

  function recallTool() {
    const el = h('section', { class: 'sm-tool glass', 'aria-label': 'Active Recall practice' });
    let screen = null;
    let run = null; // { deck, cards, i, results: [{ card, attempt, mark }] }
    let shuffle = true;

    function pick(focus) {
      screen = 'pick';
      run = null;
      fill(el,
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, 'Choose questions to practise'),
        h('p', { class: 'field-hint' }, 'Your decks are shared with Apex Flash, so you can practise the same questions both ways.'),
        deckRows({
          onExample: () => pick(true),
          meta: (deck) => {
            const n = plural(usable(deck).length, 'question');
            const r = deck.recall;
            return r ? `${n} · last round ${dayLabel(r.at)}: ${r.got} of ${r.got + r.partly + r.missed} recalled` : n;
          },
          actions: (deck) => [
            h('button', { type: 'button', class: 'btn btn-primary sm-btn-sm', disabled: !usable(deck).length, onclick: () => start(deck, usable(deck)) }, 'Practise'),
            h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm', onclick: () => edit(deck) }, 'Edit'),
          ],
        }),
        h('div', { class: 'sm-actions' },
          h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm sm-btn-icon', onclick: () => { const d = newDeck(I18n.t('My questions')); if (d) edit(d); } }, icon('plus'), 'New deck'),
          toggle('Shuffle questions', shuffle, (on) => { shuffle = on; })));
      if (focus) focusTitle(el);
    }

    function edit(deck) {
      screen = 'edit';
      fill(el, ...deckEditor(deck, () => pick(true)));
      focusTitle(el);
      if (!deck.cards.some((c) => c.q || c.a)) el.querySelector('.sm-input').select();
    }

    function start(deck, cards) {
      run = { deck, cards: shuffle ? shuffled(cards) : cards.slice(), i: 0, results: [] };
      ask();
    }

    function header() {
      const total = run.cards.length;
      return h('div', { class: 'sm-run' },
        h('div', { class: 'sm-run__top' },
          h('span', { class: 'sm-run__title', 'data-i18n-skip': '' }, run.deck.name),
          h('span', { class: 'sm-run__count' }, `Question ${Math.min(run.i + 1, total)} of ${total}`),
          h('button', { type: 'button', class: 'sm-link', onclick: () => (run.results.length ? summary() : pick(true)) }, 'End round')),
        progressBar(run.i / total, 'Round progress'));
    }

    function ask() {
      screen = 'run';
      const card = run.cards[run.i];
      const questionId = nextId('sm-question');
      const attempt = h('textarea', { class: 'sm-textarea', rows: 4, maxlength: LIMITS.a, placeholder: 'Type what you remember…', 'aria-describedby': questionId });
      const reveal = () => check(card, attempt.value.trim());
      attempt.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); reveal(); } });
      fill(el,
        header(),
        h('div', { class: 'sm-prompt' }, h('span', { class: 'sm-prompt__label' }, 'Question'), h('p', { class: 'sm-prompt__text', id: questionId, 'data-i18n-skip': '' }, card.q)),
        h('label', { class: 'sm-label' }, 'Your answer, from memory (no peeking)', attempt),
        h('div', { class: 'sm-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: reveal }, 'Check my answer'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => check(card, '') }, 'I don’t know, show me')));
      keepInView(el);
      attempt.focus({ preventScroll: true });
    }

    function check(card, attempt) {
      const marks = [['got', 'Got it'], ['partly', 'Partly'], ['missed', 'Missed it']];
      fill(el,
        header(),
        h('div', { class: 'sm-prompt' }, h('span', { class: 'sm-prompt__label' }, 'Question'), h('p', { class: 'sm-prompt__text', 'data-i18n-skip': '' }, card.q)),
        h('div', { class: 'sm-compare' },
          h('div', { class: 'sm-compare__col' },
            h('span', { class: 'sm-prompt__label' }, 'You wrote'),
            h('p', { class: `sm-compare__text${attempt ? '' : ' sm-muted'}`, 'data-i18n-skip': attempt ? '' : null }, attempt || 'Nothing this time, and that’s fine: now you know what to review.')),
          h('div', { class: 'sm-compare__col sm-compare__col--answer' },
            h('span', { class: 'sm-prompt__label' }, 'Answer'),
            h('p', { class: `sm-compare__text${card.a.trim() ? '' : ' sm-muted'}`, 'data-i18n-skip': card.a.trim() ? '' : null }, card.a.trim() || 'No answer saved on this card. Check your notes.'))),
        h('p', { class: 'sm-question' }, 'How did you do?'),
        h('div', { class: 'sm-actions', role: 'group', 'aria-label': 'How did you do?' }, marks.map(([key, label]) => h('button', {
          type: 'button', class: `btn btn-secondary sm-mark-btn sm-tone-${key}`, onclick: () => mark(card, attempt, key),
        }, label))));
      el.querySelector('.sm-mark-btn').focus({ preventScroll: true });
    }

    function mark(card, attempt, key) {
      run.results.push({ card, attempt, mark: key });
      run.i += 1;
      if (run.i < run.cards.length) ask(); else summary();
    }

    function summary() {
      screen = 'summary';
      const count = (k) => run.results.filter((r) => r.mark === k).length;
      const got = count('got'), partly = count('partly'), missed = count('missed');
      if (run.results.length) { run.deck.recall = { at: todayStr(), got, partly, missed }; Store.saveDecks(); }
      const review = run.results.filter((r) => r.mark !== 'got').map((r) => r.card);
      const { deck } = run;
      fill(el,
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, run.results.length === run.cards.length ? 'Round complete' : 'Round ended'),
        h('div', { class: 'sm-tallies' }, tally(got, 'Got it', 'got'), tally(partly, 'Partly', 'partly'), tally(missed, 'Missed', 'missed')),
        review.length
          ? [h('h4', { class: 'sm-subtitle' }, 'Worth another look'), reviewList(review)]
          : h('p', { class: 'field-hint' }, 'You recalled every answer. Try this deck again in a day or two to check it has stuck.'),
        h('div', { class: 'sm-actions' },
          review.length > 0 && h('button', { type: 'button', class: 'btn btn-primary', onclick: () => start(deck, review) }, `Practise ${review.length === 1 ? 'this one' : `these ${review.length}`} again`),
          h('button', { type: 'button', class: review.length ? 'btn btn-secondary' : 'btn btn-primary', onclick: () => start(deck, usable(deck)) }, 'Practise all again'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => pick(true) }, 'Choose another deck')));
      focusTitle(el);
    }

    return {
      el,
      onShow() { if (!screen || screen === 'pick') pick(false); },
      useExample() { const deck = exampleDeck(); if (deck) start(deck, usable(deck)); },
    };
  }

  const tally = (n, label, tone) => h('span', { class: `sm-tally sm-tone-${tone}` }, h('b', null, String(n)), label);
  const reviewList = (cards) => h('ul', { class: 'sm-review' }, cards.map((c) => h('li', null, h('strong', { 'data-i18n-skip': '' }, c.q), h('span', { 'data-i18n-skip': c.a.trim() ? '' : null }, c.a.trim() || 'No answer saved. Check your notes.'))));

  /* ============================== Apex Flash ============================== */

  function flashTool() {
    const el = h('section', { class: 'sm-tool glass', 'aria-label': 'Apex Flash flashcards' });
    let screen = null;
    let s = null; // session: { deck, queue, done, counts, requeued: Map, difficult: Set, revealed }

    function decks(focus) {
      screen = 'decks';
      s = null;
      const today = todayStr();
      fill(el,
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, 'Your decks'),
        h('p', { class: 'field-hint' }, 'Cards you find hard come back sooner, and the ones you know wait longer. Decks are shared with Active Recall.'),
        deckRows({
          onExample: () => decks(true),
          meta: (deck) => {
            const cards = usable(deck);
            if (!cards.length) return 'No cards yet';
            const due = dueCards(deck, today).length;
            if (due) return `${plural(cards.length, 'card')} · ${due} to study now`;
            const next = cards.map((c) => c.due).filter(Boolean).sort()[0];
            return `${plural(cards.length, 'card')} · all caught up${next ? `, next cards due ${dueLabel(next)}` : ''}`;
          },
          actions: (deck) => {
            const due = dueCards(deck, today);
            const hard = difficultCards(deck);
            return [
              h('button', { type: 'button', class: `btn ${due.length ? 'btn-primary' : 'btn-secondary'} sm-btn-sm`, disabled: !usable(deck).length, onclick: () => begin(deck, due.length ? due : usable(deck)) }, due.length ? `Study ${due.length}` : 'Practise anyway'),
              hard.length > 0 && h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm', onclick: () => begin(deck, hard) }, `Difficult (${hard.length})`),
              h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm', onclick: () => edit(deck) }, 'Edit'),
            ];
          },
        }),
        h('div', { class: 'sm-actions' }, h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm sm-btn-icon', onclick: () => { const d = newDeck(I18n.t('New deck')); if (d) edit(d); } }, icon('plus'), 'New deck')));
      if (focus) focusTitle(el);
    }

    function edit(deck) {
      screen = 'edit';
      fill(el, ...deckEditor(deck, () => decks(true)));
      focusTitle(el);
      if (!deck.cards.some((c) => c.q || c.a)) el.querySelector('.sm-input').select();
    }

    function begin(deck, cards) {
      s = { deck, queue: cards.slice(), done: 0, counts: { again: 0, hard: 0, good: 0, easy: 0 }, requeued: new Map(), difficult: new Set(), revealed: false };
      card();
    }

    function header() {
      const left = s.queue.length;
      return h('div', { class: 'sm-run' },
        h('div', { class: 'sm-run__top' },
          h('span', { class: 'sm-run__title', 'data-i18n-skip': '' }, s.deck.name),
          h('span', { class: 'sm-run__count' }, `${plural(left, 'card')} to go`),
          h('button', { type: 'button', class: 'sm-link', onclick: () => (s.done ? finish() : decks(true)) }, 'End session')),
        progressBar(s.done / (s.done + left || 1), 'Session progress'));
    }

    function card() {
      if (!s.queue.length) { finish(); return; }
      screen = 'study';
      const c = s.queue[0];
      s.revealed = false;
      const typed = h('input', { class: 'sm-input', type: 'text', maxlength: '300', autocomplete: 'off', placeholder: 'Your answer (optional)', 'aria-label': 'Your answer (optional)' });
      const face = h('div', { class: 'sm-flashcard', 'aria-live': 'polite' },
        h('span', { class: 'sm-prompt__label' }, 'Question'),
        h('p', { class: 'sm-flashcard__text', 'data-i18n-skip': '' }, c.q));
      const show = h('button', { type: 'button', class: 'btn btn-primary', onclick: () => reveal(c, face, typed) }, 'Show answer');
      typed.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); reveal(c, face, typed); } });
      fill(el, header(), face,
        h('div', { class: 'sm-flash-actions' }, typed, show),
        h('p', { class: 'field-hint sm-keys' }, 'Keyboard: Space shows the answer, then 1–4 rates it.'));
      keepInView(el);
      show.focus({ preventScroll: true });
    }

    function reveal(c, face, typed) {
      if (!s || s.revealed) return;
      s.revealed = true;
      const said = typed.value.trim();
      face.append(h('div', { class: 'sm-flashcard__back' },
        h('span', { class: 'sm-prompt__label' }, 'Answer'),
        h('p', { class: 'sm-flashcard__text', 'data-i18n-skip': c.a.trim() ? '' : null }, c.a.trim() || 'No answer saved on this card. Check your notes.'),
        said && h('p', { class: 'sm-flashcard__said' }, `You wrote: ${said}`)));
      const rates = h('div', { class: 'sm-rate', role: 'group', 'aria-label': 'How well did you know it?' }, RATINGS.map((r, i) => h('button', {
        type: 'button', class: `sm-rate__btn sm-tone-${r}`, 'data-rating': r, onclick: () => rate(c, r),
      }, h('strong', null, RATING_LABEL[r]), h('span', null, whenLabel(c, r)), h('kbd', { class: 'sm-kbd', 'aria-hidden': 'true' }, String(i + 1)))));
      el.querySelector('.sm-flash-actions').replaceWith(h('div', { class: 'sm-flash-actions sm-flash-actions--rate' }, h('p', { class: 'sm-question' }, 'How well did you know it?'), rates));
      rates.querySelector('[data-rating="good"]').focus({ preventScroll: true });
    }

    function rate(c, r) {
      if (!s || !s.revealed) return;
      s.revealed = false;
      const due = nextDue(c, r);
      c.box = nextBox(c, r);
      c.due = due;
      c.last = r;
      c.reps += 1;
      if (r === 'again') c.lapses += 1;
      Store.saveDecks(); // straight away, so a session left halfway still counts
      s.counts[r] += 1;
      s.done += 1;
      s.queue.shift();
      if (r === 'again' || r === 'hard') {
        s.difficult.add(c);
        const times = s.requeued.get(c) || 0;
        if (times < 3) {
          s.requeued.set(c, times + 1);
          if (r === 'again') s.queue.splice(Math.min(3, s.queue.length), 0, c); // back in a few cards
          else s.queue.push(c); // back at the end
        }
      }
      card();
    }

    function finish() {
      screen = 'summary';
      const { deck, counts } = s;
      const total = RATINGS.reduce((n, r) => n + counts[r], 0);
      const difficult = [...s.difficult].filter((c) => deck.cards.includes(c));
      const today = todayStr();
      const tomorrow = addDays(today, 1);
      const dueTomorrow = usable(deck).filter((c) => c.due === tomorrow).length;
      fill(el,
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, total ? `Session done: ${plural(total, 'review')}` : 'Session ended'),
        h('div', { class: 'sm-tallies' }, RATINGS.map((r) => tally(counts[r], RATING_LABEL[r], r))),
        difficult.length
          ? [h('h4', { class: 'sm-subtitle' }, 'Cards you found difficult'), reviewList(difficult)]
          : h('p', { class: 'field-hint' }, 'No difficult cards this time.'),
        dueTomorrow > 0 && h('p', { class: 'field-hint' }, `${plural(dueTomorrow, 'card')} will be due again tomorrow.`),
        h('div', { class: 'sm-actions' },
          difficult.length > 0 && h('button', { type: 'button', class: 'btn btn-primary', onclick: () => begin(deck, difficult) }, `Revisit ${plural(difficult.length, 'difficult card')}`),
          h('button', { type: 'button', class: `btn ${difficult.length ? 'btn-secondary' : 'btn-primary'}`, onclick: () => decks(true) }, 'Back to decks')));
      focusTitle(el);
    }

    // Space shows the answer, 1-4 rate it -- only while this card is on screen and nobody is typing.
    document.addEventListener('keydown', (e) => {
      if (screen !== 'study' || !s || !el.isConnected || el.offsetParent === null || state.currentView !== 'methods') return;
      if (e.ctrlKey || e.metaKey || e.altKey || e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (!s.revealed && (e.key === ' ' || e.key === 'Enter') && !e.target.closest('button')) {
        e.preventDefault();
        el.querySelector('.sm-flash-actions .btn-primary').click();
      } else if (s.revealed && /^[1-4]$/.test(e.key)) {
        e.preventDefault();
        el.querySelector(`[data-rating="${RATINGS[Number(e.key) - 1]}"]`).click();
      }
    });

    return {
      el,
      onShow() { if (!screen || screen === 'decks') decks(false); },
      useExample() { const deck = exampleDeck(); if (deck) begin(deck, dueCards(deck).length ? dueCards(deck) : usable(deck)); },
    };
  }

  /* ============================== Feynman Technique ============================== */

  function feynmanTool() {
    const el = h('section', { class: 'sm-tool glass', 'aria-label': 'Feynman Technique' });
    const STEPS = ['Concept', 'Explain', 'Find gaps', 'Simplify'];
    const IDEAS = ['Photosynthesis', 'Supply and demand', 'Compound interest', 'How vaccines work'];
    let mounted = false;
    let note = null;
    const blank = (concept = '') => ({ id: makeId(), concept, explanation: '', revised: '', gaps: [], step: 1, saved: '' });
    const hasContent = (n) => !!n && !!(n.concept.trim() || n.explanation.trim() || n.revised.trim() || n.gaps.length);
    const persist = debounced(() => { Store.feynman.draft = hasContent(note) ? note : null; Store.saveFeynman(); });

    function go(step) { note.step = step; persist(); persist.flush(); render(true); }
    const back = (step) => h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => go(step) }, 'Back');

    function render(focus) {
      if (!note) note = blank();
      const steps = [stepConcept, stepExplain, stepGaps, stepSimplify];
      fill(el,
        h('div', { class: 'sm-tool__top' },
          stepper(STEPS, note.step),
          actionButton('Start over', 'sm-link', () => { persist.cancel(); note = blank(); Store.feynman.draft = null; Store.saveFeynman(); render(true); },
            { confirmIf: () => hasContent(note), question: 'Clear this explanation?', yes: 'Clear' })),
        ...steps[note.step - 1](),
        savedList());
      if (focus) focusTitle(el);
    }

    function stepConcept() {
      const next = h('button', { type: 'button', class: 'btn btn-primary', disabled: !note.concept.trim(), onclick: () => go(2) }, 'Next: explain it');
      const input = h('input', { class: 'sm-input', type: 'text', maxlength: LIMITS.concept, value: note.concept, placeholder: 'e.g. Photosynthesis', oninput: (e) => { note.concept = e.target.value; persist(); next.disabled = !note.concept.trim(); } });
      input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && note.concept.trim()) go(2); });
      return [
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, 'What do you want to understand better?'),
        h('label', { class: 'sm-label' }, 'Concept', input),
        h('div', { class: 'sm-chips', role: 'group', 'aria-label': 'Ideas to try' },
          h('span', { class: 'sm-chips__label' }, 'Ideas:'),
          IDEAS.map((idea) => h('button', { type: 'button', class: 'sm-chip', onclick: () => { note.concept = I18n.t(idea); input.value = note.concept; next.disabled = false; persist(); input.focus(); } }, idea))),
        h('div', { class: 'sm-actions' }, next),
      ];
    }

    function stepExplain() {
      const check = h('div', { class: 'sm-check', 'aria-live': 'polite' });
      const drawCheck = () => {
        const r = plainCheck(note.explanation, note.concept);
        if (!r.words) { check.replaceChildren(); return; }
        check.replaceChildren(
          h('p', { class: 'sm-check__title' }, 'Plain-language check ', h('span', { class: 'sm-muted' }, '(a rough guide, not a grade)')),
          h('ul', { class: 'sm-check__list' },
            h('li', null, `${plural(r.words, 'word')} in ${plural(r.sentences, 'sentence')}, about ${r.avg} words per sentence.`),
            h('li', null, r.long.length ? `${plural(r.long.length, 'sentence')} over 25 words. Try splitting ${r.long.length === 1 ? 'it' : 'them'} up.` : 'No very long sentences.'),
            r.hard.length > 0 && h('li', null, 'Words a beginner might not know (explain them, or use simpler ones): ', r.hard.map((w) => h('span', { class: 'sm-term', 'data-i18n-skip': '' }, w)))));
      };
      const scheduleCheck = debounced(drawCheck, 300);
      const next = h('button', { type: 'button', class: 'btn btn-primary', disabled: !note.explanation.trim(), onclick: () => { scheduleCheck.cancel(); go(3); } }, 'Next: find the gaps');
      const area = h('textarea', { class: 'sm-textarea sm-textarea--lg', rows: 9, maxlength: LIMITS.text, value: note.explanation, placeholder: `${note.concept || 'It'} is… (keep your sentences short)` });
      area.addEventListener('input', () => { note.explanation = area.value; persist(); next.disabled = !note.explanation.trim(); scheduleCheck(); });
      drawCheck();
      return [
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, `Explain “${note.concept}” in plain words`),
        h('p', { class: 'field-hint' }, 'Write as if you were teaching a curious 12-year-old: short sentences, everyday words, and one example or comparison. If you get stuck, keep going. That’s a gap, and finding gaps is the point.'),
        h('label', { class: 'sm-label' }, 'Your explanation', area),
        check,
        h('div', { class: 'sm-actions' }, back(1), next),
      ];
    }

    function stepGaps() {
      const r = plainCheck(note.explanation, note.concept);
      const gaps = gapEditor(note.gaps, persist, { placeholder: 'e.g. I couldn’t say where the oxygen comes from' });
      const suggestions = r.hard.map((w) => {
        const text = `Explain “${w}” more simply`;
        return h('button', { type: 'button', class: 'sm-chip', disabled: gaps.has(text), onclick: (e) => { if (gaps.add(text)) e.currentTarget.disabled = true; } }, h('span', { 'data-i18n-skip': '' }, `“${w}”`));
      });
      return [
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, 'Find the gaps'),
        h('p', { class: 'field-hint' }, 'Read your explanation as if you knew nothing about the topic. Where would you get lost?'),
        h('div', { class: 'sm-readback', 'data-i18n-skip': '' }, highlighted(note.explanation, r.hard)),
        h('ul', { class: 'sm-prompts' },
          h('li', null, 'Where did you get stuck, go vague, or say “it just happens”?'),
          h('li', null, 'Which words would a beginner not know?'),
          h('li', null, 'Did you skip a step between a cause and its effect?'),
          h('li', null, 'Could you give a real example?'),
          r.long.length > 0 && h('li', null, `${plural(r.long.length, 'sentence')} ${r.long.length === 1 ? 'is' : 'are'} over 25 words. Could a beginner follow ${r.long.length === 1 ? 'it' : 'them'}?`)),
        suggestions.length > 0 && h('div', { class: 'sm-chips' }, h('span', { class: 'sm-chips__label' }, 'Add as a gap:'), suggestions),
        h('h4', { class: 'sm-subtitle' }, 'Your gaps'),
        gaps.nodes,
        h('div', { class: 'sm-actions' }, back(2), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go(4) }, 'Next: simplify')),
      ];
    }

    function stepSimplify() {
      if (!note.revised.trim()) note.revised = note.explanation;
      const stats = h('p', { class: 'field-hint', 'aria-live': 'polite' });
      const drawStats = () => {
        const a = plainCheck(note.explanation), b = plainCheck(note.revised);
        stats.textContent = `First version: ${plural(a.words, 'word')}, about ${a.avg} per sentence. Now: ${plural(b.words, 'word')}, about ${b.avg} per sentence.`;
      };
      const scheduleStats = debounced(drawStats, 300);
      const area = h('textarea', { class: 'sm-textarea sm-textarea--lg', rows: 9, maxlength: LIMITS.text, value: note.revised });
      area.addEventListener('input', () => { note.revised = area.value; persist(); scheduleStats(); });
      drawStats();
      return [
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, 'Fill the gaps and simplify'),
        h('p', { class: 'field-hint' }, note.gaps.length
          ? 'Look up each gap in your notes or textbook, then rewrite your explanation below. Tick a gap once your new version covers it.'
          : 'You didn’t list any gaps. Read it once more and make it as clear and simple as you can.'),
        note.gaps.length > 0 && h('ul', { class: 'sm-gaps' }, note.gaps.map((g) => h('li', { class: 'sm-gap' }, checkbox(g.text, g.done, (on) => { g.done = on; persist(); })))),
        h('label', { class: 'sm-label' }, 'Your improved explanation', area),
        stats,
        h('div', { class: 'sm-actions' }, back(3), h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, 'Save explanation')),
      ];
    }

    function save() {
      persist.cancel();
      note.saved = todayStr();
      note.step = 4;
      const i = Store.feynman.notes.findIndex((n) => n.id === note.id);
      if (i >= 0) Store.feynman.notes[i] = note; else Store.feynman.notes.unshift(note);
      Store.feynman.notes = Store.feynman.notes.slice(0, LIMITS.notes);
      Store.feynman.draft = null;
      Store.saveFeynman();
      const saved = note;
      note = null;
      fill(el,
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, `Saved: ${saved.concept}`),
        h('p', { class: 'field-hint' }, 'In a few days, try explaining it again from memory. It’s a quick way to check whether it has stuck.'),
        h('div', { class: 'sm-readback', 'data-i18n-skip': '' }, saved.revised || saved.explanation),
        h('div', { class: 'sm-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => { note = blank(); render(true); } }, 'Explain another concept'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => open(saved) }, 'Keep editing')),
        savedList());
      focusTitle(el);
    }

    function open(saved) {
      persist.cancel();
      note = JSON.parse(JSON.stringify(saved));
      note.step = 4;
      Store.feynman.draft = note;
      Store.saveFeynman();
      render(true);
    }

    function savedList() {
      const notes = Store.feynman.notes;
      if (!notes.length) return null;
      return h('details', { class: 'sm-disclosure sm-saved' },
        h('summary', null, `Your saved explanations (${notes.length})`),
        h('ul', { class: 'sm-list sm-disclosure__body' }, notes.map((n) => h('li', { class: 'sm-row' },
          h('div', { class: 'sm-row__main' },
            h('strong', { 'data-i18n-skip': n.concept ? '' : null }, n.concept || 'Untitled'),
            h('span', { class: 'sm-row__meta' }, `Saved ${dayLabel(n.saved)} · ${n.gaps.length ? `${n.gaps.filter((g) => g.done).length} of ${plural(n.gaps.length, 'gap')} filled` : 'no gaps listed'}`)),
          h('div', { class: 'sm-row__actions' },
            actionButton('Open', 'btn btn-secondary sm-btn-sm', () => open(n), { confirmIf: () => hasContent(note) && note.id !== n.id, question: 'Replace your current draft?', yes: 'Replace' }),
            confirmButton('Delete', 'Delete it?', 'Delete', () => {
              Store.feynman.notes = Store.feynman.notes.filter((x) => x !== n);
              Store.saveFeynman();
              if (note) render(false); else el.querySelector('.sm-saved')?.replaceWith(savedList() || '');
            }))))));
    }

    return {
      el,
      onShow() { if (!mounted) { mounted = true; note = Store.feynman.draft; render(false); } },
      useExample() {
        if (hasContent(note)) { showToast('Finish or start over on your current explanation first.', 'error'); return; }
        note = blank(I18n.t('Photosynthesis'));
        go(2);
      },
    };
  }

  /* ============================== Blurting ============================== */

  function blurtingTool() {
    const el = h('section', { class: 'sm-tool glass', 'aria-label': 'Blurting' });
    const STEPS = ['Topic', 'Blurt', 'Compare', 'Gaps'];
    const IDEAS = ['The water cycle', 'Causes of World War I', 'Parts of a cell'];
    let mounted = false;
    let cur = null;
    let tick = null;
    const blank = (topic = '') => ({ id: makeId(), topic, text: '', notes: '', gaps: [], minutes: 5, step: 1, startedAt: 0, terms: 0, hits: 0, saved: '' });
    const hasContent = (b) => !!b && !!(b.text.trim() || b.notes.trim() || b.gaps.length);
    const persist = debounced(() => { Store.blurting.draft = cur && (cur.topic.trim() || hasContent(cur)) ? cur : null; Store.saveBlurting(); });
    const fmt = (ms) => { const t = Math.max(0, Math.floor(ms / 1000)); return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
    const stopClock = () => { if (tick) { clearInterval(tick); tick = null; } };
    const lastOn = (topic) => Store.blurting.sessions.find((x) => x.topic.trim().toLowerCase() === topic.trim().toLowerCase() && x.gaps.length);

    function go(step) { stopClock(); cur.step = step; persist(); persist.flush(); render(true); }
    const back = (step) => h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => go(step) }, 'Back');

    function render(focus) {
      stopClock();
      if (!cur) cur = blank();
      const steps = [stepTopic, stepBlurt, stepCompare, stepGaps];
      fill(el,
        h('div', { class: 'sm-tool__top' },
          stepper(STEPS, cur.step),
          actionButton('Start over', 'sm-link', () => { persist.cancel(); cur = blank(); Store.blurting.draft = null; Store.saveBlurting(); render(true); },
            { confirmIf: () => hasContent(cur), question: 'Clear this blurt?', yes: 'Clear' })),
        ...steps[cur.step - 1](),
        history());
      if (focus) focusTitle(el);
    }

    function stepTopic() {
      const start = h('button', { type: 'button', class: 'btn btn-primary', disabled: !cur.topic.trim(), onclick: () => { cur.startedAt = Date.now(); go(2); } }, 'Start blurting');
      const reminder = h('div');
      const drawReminder = () => {
        const last = cur.topic.trim() && lastOn(cur.topic);
        reminder.replaceChildren(last ? h('p', { class: 'sm-callout' }, `Last time on this topic (${dayLabel(last.saved)}) you planned to review: `, last.gaps.map((g) => h('span', { class: 'sm-term', 'data-i18n-skip': '' }, g.text))) : '');
      };
      const topic = h('input', { class: 'sm-input', type: 'text', maxlength: LIMITS.topic, value: cur.topic, placeholder: 'e.g. The water cycle', oninput: (e) => { cur.topic = e.target.value; persist(); start.disabled = !cur.topic.trim(); drawReminder(); } });
      topic.addEventListener('keydown', (e) => { if (e.key === 'Enter' && cur.topic.trim()) start.click(); });
      drawReminder();
      return [
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, 'What topic will you blurt?'),
        h('label', { class: 'sm-label' }, 'Topic', topic),
        h('div', { class: 'sm-chips', role: 'group', 'aria-label': 'Ideas to try' },
          h('span', { class: 'sm-chips__label' }, 'Ideas:'),
          IDEAS.map((idea) => h('button', { type: 'button', class: 'sm-chip', onclick: () => { cur.topic = I18n.t(idea); topic.value = cur.topic; start.disabled = false; persist(); drawReminder(); topic.focus(); } }, idea))),
        h('div', { class: 'sm-field' }, h('span', { class: 'sm-label' }, 'Timer'),
          segmented('Timer', [[0, 'No timer'], [5, '5 min'], [10, '10 min'], [15, '15 min']], cur.minutes, (v) => { cur.minutes = v; persist(); })),
        reminder,
        h('p', { class: 'sm-callout' }, 'Put your notes away before you start: no peeking. Write anything you remember, even half-remembered bits. Order and spelling don’t matter.'),
        h('div', { class: 'sm-actions' }, start),
      ];
    }

    function stepBlurt() {
      if (!cur.startedAt) cur.startedAt = Date.now();
      const clock = h('span', { class: 'sm-clock', role: 'timer', 'aria-label': cur.minutes ? 'Time left' : 'Time spent' });
      const status = h('p', { class: 'sm-timeup', 'aria-live': 'polite' });
      const words = h('span', { class: 'sm-row__meta' });
      const drawWords = () => { words.textContent = plural(tokens(cur.text).length, 'word'); };
      const area = h('textarea', { class: 'sm-textarea sm-textarea--xl', rows: 12, maxlength: LIMITS.text, value: cur.text, placeholder: 'Write everything you remember…', 'aria-label': `Everything you remember about ${cur.topic}` });
      area.addEventListener('input', () => { cur.text = area.value; persist(); drawWords(); });
      const draw = () => {
        if (!clock.isConnected) { stopClock(); return; }
        const spent = Date.now() - cur.startedAt;
        if (!cur.minutes) { clock.textContent = fmt(spent); return; }
        const left = cur.minutes * 60000 - spent;
        clock.textContent = fmt(left);
        if (left <= 0 && !clock.classList.contains('is-over')) {
          clock.classList.add('is-over');
          status.textContent = 'Time’s up. Finish your thought, then press “I’m done”.';
        }
      };
      drawWords();
      // started once the screen is in the page (render() appends it right after this returns)
      requestAnimationFrame(() => { draw(); stopClock(); tick = setInterval(draw, 1000); area.focus({ preventScroll: true }); });
      return [
        h('div', { class: 'sm-blurt-head' }, h('h3', { class: 'sm-tool__title', tabindex: '-1', 'data-i18n-skip': '' }, cur.topic), clock),
        h('p', { class: 'field-hint' }, 'Keep writing until you run dry. Lists, keywords and half sentences are all fine.'),
        area,
        h('div', { class: 'sm-blurt-foot' }, words, status),
        h('div', { class: 'sm-actions' }, back(1), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go(3) }, 'I’m done')),
      ];
    }

    function stepCompare() {
      const results = h('div', { class: 'sm-results', 'aria-live': 'polite' });
      const gapChip = (word) => {
        const has = () => cur.gaps.some((g) => g.text.toLowerCase() === word.toLowerCase());
        const chip = h('button', { type: 'button', class: 'sm-chip', 'aria-pressed': String(has()), 'data-i18n-skip': '' }, word);
        chip.addEventListener('click', () => {
          if (has()) cur.gaps = cur.gaps.filter((g) => g.text.toLowerCase() !== word.toLowerCase());
          else if (cur.gaps.length < LIMITS.gaps) cur.gaps.push({ id: makeId(), text: word, done: false });
          chip.setAttribute('aria-pressed', String(has()));
          persist();
        });
        return chip;
      };
      const compare = () => {
        const terms = keyTerms(cur.notes);
        if (!terms.length) { fill(results, h('p', { class: 'field-hint' }, 'Paste some notes above first.')); return; }
        const mentioned = mentionedIn(cur.text);
        const hit = terms.filter(mentioned);
        const miss = terms.filter((t) => !mentioned(t));
        cur.terms = terms.length;
        cur.hits = hit.length;
        persist();
        const chips = miss.map((t) => gapChip(t.word));
        fill(results,
          h('p', { class: 'sm-score' }, h('b', null, `${hit.length} of ${terms.length}`), ' key words from your notes appear in what you wrote.'),
          miss.length
            ? [h('p', { class: 'sm-chips__label' }, 'Possibly missing. Tap the ones you really missed to add them to your gaps:'),
              h('div', { class: 'sm-chips' }, chips),
              miss.length > 1 && h('button', { type: 'button', class: 'sm-link', onclick: () => { for (const c of chips) if (c.getAttribute('aria-pressed') !== 'true') c.click(); } }, 'Add all of them')]
            : h('p', { class: 'field-hint' }, 'Every key word from your notes shows up in what you wrote.'),
          hit.length > 0 && h('details', { class: 'sm-disclosure' }, h('summary', null, `Words you remembered (${hit.length})`), h('div', { class: 'sm-chips sm-disclosure__body' }, hit.map((t) => h('span', { class: 'sm-term', 'data-i18n-skip': '' }, t.word)))));
      };
      const notes = h('textarea', { class: 'sm-textarea', rows: 7, maxlength: LIMITS.text, value: cur.notes, placeholder: 'Paste your notes, a textbook summary or the key points here.' });
      notes.addEventListener('input', () => { cur.notes = notes.value; persist(); });
      if (cur.notes.trim()) compare();
      return [
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, 'Compare with your notes (optional)'),
        h('p', { class: 'field-hint' }, 'Now you can look. Paste your notes and you’ll see which of their key words don’t appear in what you wrote. It’s a rough word match, so trust your own judgement too.'),
        h('label', { class: 'sm-label' }, 'Your notes', notes),
        h('div', { class: 'sm-actions' }, h('button', { type: 'button', class: 'btn btn-secondary', onclick: compare }, 'Compare')),
        results,
        h('div', { class: 'sm-actions' }, back(2), h('button', { type: 'button', class: 'btn btn-primary', onclick: () => go(4) }, 'Next: your gaps')),
      ];
    }

    function stepGaps() {
      const gaps = gapEditor(cur.gaps, persist, { placeholder: 'e.g. The difference between weather and climate', checkable: true });
      return [
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, 'Your gaps'),
        h('p', { class: 'field-hint' }, 'These are the parts to review. Add anything else you missed or got wrong, and tick each one once you’ve gone over it in your notes. Then blurt this topic again in a day or two.'),
        gaps.nodes,
        h('div', { class: 'sm-actions' }, back(3), h('button', { type: 'button', class: 'btn btn-primary', onclick: save }, 'Save session')),
      ];
    }

    function summaryText(b) {
      const parts = [`${dayLabel(b.saved)}`, plural(tokens(b.text).length, 'word')];
      if (b.terms) parts.push(`${b.hits} of ${b.terms} key words`);
      parts.push(b.gaps.length ? `${b.gaps.filter((g) => g.done).length} of ${plural(b.gaps.length, 'gap')} reviewed` : 'no gaps listed');
      return parts.join(' · ');
    }

    function save() {
      persist.cancel();
      stopClock();
      cur.saved = todayStr();
      cur.step = 4;
      Store.blurting.sessions = [cur, ...Store.blurting.sessions.filter((x) => x.id !== cur.id)].slice(0, LIMITS.sessions);
      Store.blurting.draft = null;
      Store.saveBlurting();
      const saved = cur;
      cur = null;
      fill(el,
        h('h3', { class: 'sm-tool__title', tabindex: '-1' }, `Saved: ${saved.topic}`),
        h('p', { class: 'field-hint' }, summaryText(saved)),
        h('p', { class: 'field-hint' }, 'Review your gaps, then blurt this topic again in a day or two and see what you can add.'),
        h('div', { class: 'sm-actions' },
          h('button', { type: 'button', class: 'btn btn-primary', onclick: () => again(saved.topic) }, 'Blurt this topic again'),
          h('button', { type: 'button', class: 'btn btn-secondary', onclick: () => { cur = blank(); render(true); } }, 'New topic')),
        history());
      focusTitle(el);
    }

    function again(topic) {
      if (hasContent(cur)) { showToast('Finish or start over on your current blurt first.', 'error'); return; }
      persist.cancel();
      cur = blank(topic);
      go(1);
    }

    function view(b) {
      stopClock();
      fill(el,
        h('button', { type: 'button', class: 'sm-back', onclick: () => render(true) }, icon('back'), 'Back'),
        h('h3', { class: 'sm-tool__title', tabindex: '-1', 'data-i18n-skip': b.topic ? '' : null }, b.topic || 'Untitled'),
        h('p', { class: 'field-hint' }, summaryText(b)),
        h('h4', { class: 'sm-subtitle' }, 'What you wrote'),
        h('div', { class: 'sm-readback', 'data-i18n-skip': b.text.trim() ? '' : null }, b.text.trim() || 'Nothing written.'),
        h('h4', { class: 'sm-subtitle' }, 'Gaps to review'),
        b.gaps.length
          ? h('ul', { class: 'sm-gaps' }, b.gaps.map((g) => h('li', { class: 'sm-gap' }, checkbox(g.text, g.done, (on) => { g.done = on; Store.saveBlurting(); }))))
          : h('p', { class: 'field-hint' }, 'No gaps listed.'),
        h('div', { class: 'sm-actions' }, h('button', { type: 'button', class: 'btn btn-primary', onclick: () => again(b.topic) }, 'Blurt this topic again')));
      focusTitle(el);
    }

    function history() {
      const list = Store.blurting.sessions;
      if (!list.length) return null;
      return h('details', { class: 'sm-disclosure sm-saved' },
        h('summary', null, `Past sessions (${list.length})`),
        h('ul', { class: 'sm-list sm-disclosure__body' }, list.map((b) => h('li', { class: 'sm-row' },
          h('div', { class: 'sm-row__main' }, h('strong', { 'data-i18n-skip': b.topic ? '' : null }, b.topic || 'Untitled'), h('span', { class: 'sm-row__meta' }, summaryText(b))),
          h('div', { class: 'sm-row__actions' },
            h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm', onclick: () => view(b) }, 'Open'),
            confirmButton('Delete', 'Delete it?', 'Delete', () => {
              Store.blurting.sessions = Store.blurting.sessions.filter((x) => x !== b);
              Store.saveBlurting();
              if (cur) render(false); else el.querySelector('.sm-saved')?.replaceWith(history() || '');
            }))))));
    }

    return {
      el,
      onShow() {
        if (!mounted) { mounted = true; cur = Store.blurting.draft; render(false); }
        else if (cur && cur.step === 2 && !tick) render(false); // back on the writing screen: restart its clock
      },
      useExample() {
        if (hasContent(cur)) { showToast('Finish or start over on your current blurt first.', 'error'); return; }
        cur = blank(I18n.t('The water cycle'));
        go(1);
      },
    };
  }

  /* ============================== pages ============================== */

  const TOOLS = { recall: recallTool, feynman: feynmanTool, blurting: blurtingTool, flash: flashTool };
  const pages = {};
  let root = null;
  let current = 'hub';

  function metaFor(id) {
    if (id === 'recall') return Store.decks.length ? plural(Store.decks.length, 'deck') : '';
    if (id === 'flash') {
      if (!Store.decks.length) return '';
      const due = Store.decks.reduce((n, d) => n + dueCards(d).length, 0);
      return due ? `${plural(due, 'card')} to study today` : 'All caught up today';
    }
    const box = id === 'feynman' ? Store.feynman : Store.blurting;
    const draft = box.draft;
    const title = draft && (id === 'feynman' ? draft.concept : draft.topic).trim();
    if (title) return `In progress: ${title}`;
    const saved = id === 'feynman' ? box.notes.length : box.sessions.length;
    return saved ? `${plural(saved, id === 'feynman' ? 'explanation' : 'session')} saved` : '';
  }

  function buildHub() {
    const metas = {};
    const el = h('div', { class: 'sm-hub' },
      h('div', { class: 'page-head' },
        h('div', { class: 'page-head__text' },
          h('h2', { class: 'page-title', tabindex: '-1' }, 'Study'),
          h('p', { class: 'page-desc' }, 'Four ways to study, each with a short how-to and a tool to try it right here. What you write is saved in this browser only.')),
        h('div', { class: 'page-head__aside' },
          h('a', { class: 'page-help', href: '/help', 'data-route': '', 'aria-label': 'Help & guides', title: 'Help & guides' }, '?'))),
      h('div', { class: 'sm-grid' }, ORDER.map((id) => {
        const m = METHODS[id];
        metas[id] = h('span', { class: 'sm-method__meta' });
        return h('section', { class: 'sm-method glass', 'aria-labelledby': `sm-title-${id}` },
          h('span', { class: `sm-icon sm-tone-${id}`, 'aria-hidden': 'true' }, icon(m.icon)),
          h('h3', { id: `sm-title-${id}` }, m.name),
          h('p', null, m.tagline),
          h('p', { class: 'sm-good' }, h('b', null, 'Good for '), m.goodFor),
          metas[id],
          h('button', { type: 'button', class: 'btn btn-primary sm-btn-sm', 'aria-label': `Start ${m.name}`, onclick: () => go(id) }, 'Start'));
      })));
    return {
      el,
      refresh() {
        for (const id of ORDER) metas[id].textContent = metaFor(id);
      },
    };
  }

  function buildMethod(id) {
    const m = METHODS[id];
    const tool = TOOLS[id]();
    const guide = h('details', { class: 'sm-guide glass', open: window.matchMedia('(min-width: 1000px)').matches },
      h('summary', null, 'How it works'),
      h('div', { class: 'sm-guide__body' },
        m.note && h('p', { class: 'sm-note' }, m.note),
        h('h4', null, 'What it is'), h('p', null, m.what),
        h('h4', null, 'When it can help'), h('p', null, m.when),
        h('h4', null, 'How to try it'), h('ol', null, m.steps.map((step) => h('li', null, step))),
        h('h4', null, m.exampleLabel), h('p', { class: 'sm-example' }, m.example),
        h('div', { class: 'sm-actions' }, h('button', { type: 'button', class: 'btn btn-secondary sm-btn-sm', onclick: () => { tool.useExample(); } }, m.exampleAction))));
    const el = h('div', { class: 'sm-page' },
      h('div', { class: 'page-head' },
        h('div', { class: 'page-head__text' },
          h('button', { type: 'button', class: 'sm-back', onclick: () => go('hub') }, icon('back'), 'All methods'),
          h('h2', { class: 'page-title', tabindex: '-1' }, m.name),
          h('p', { class: 'page-desc' }, m.tagline))),
      h('div', { class: 'sm-layout' }, guide, tool.el));
    return { el, refresh: () => tool.onShow() };
  }

  function page(id) {
    if (!pages[id]) pages[id] = id === 'hub' ? buildHub() : buildMethod(id);
    return pages[id];
  }

  function go(id, focus = true, notify = true) {
    if (!METHODS[id]) id = 'hub';
    current = id;
    const p = page(id);
    root.replaceChildren(p.el);
    p.refresh();
    if (notify && window.StudyMethods.onNavigate) window.StudyMethods.onNavigate(id); // keeps the address in step
    if (focus) {
      p.el.querySelector('h2').focus({ preventScroll: true });
      window.scrollTo(0, 0);
    }
  }

  // Another tab changed the same data: reload it (dropping this tab's open screens) rather than overwrite it later.
  window.addEventListener('storage', (e) => {
    if (!root || !Object.values(KEYS).includes(e.key)) return;
    for (const p of [...pending]) p.cancel();
    Store.load();
    for (const id of Object.keys(pages)) delete pages[id];
    go(current, false, false);
  });

  window.StudyMethods = {
    /** Shows the hub or one tool (id: hub, recall, feynman, blurting, flash) -- e.g. from /study/flashcards. */
    show(el, id = 'hub') {
      if (root !== el) { root = el; Store.load(); go(id, false, false); return; }
      if (id !== current) { go(id, false, false); return; }
      page(current).refresh();
    },
    onNavigate: null, // set by the app: told when the learner moves between the hub and a tool
  };
})();
