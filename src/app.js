/* ============================================================
   app.js — main application: routing, parser, preview renderer,
            library, editor, transposition, popovers
   ============================================================ */

(function () {
  'use strict';

  // -------- API helpers --------
  const API = {
    csrfToken: null,
    async getCsrf() {
      if (this.csrfToken) return this.csrfToken;
      const r = await fetch('/api/csrf', { credentials: 'same-origin' });
      const j = await r.json();
      this.csrfToken = j.token;
      return this.csrfToken;
    },
    async req(method, path, body) {
      const opts = { method, credentials: 'same-origin', headers: {} };
      if (body !== undefined && !(body instanceof FormData)) {
        opts.headers['Content-Type'] = 'application/json';
        opts.body = JSON.stringify(body);
      } else if (body instanceof FormData) {
        opts.body = body;
      }
      if (method !== 'GET') {
        opts.headers['X-CSRF-Token'] = await this.getCsrf();
      }
      const r = await fetch(path, opts);
      const isJson = (r.headers.get('content-type') || '').includes('application/json');
      const data = isJson ? await r.json() : await r.text();
      if (!r.ok) {
        const err = new Error((data && data.error) || ('HTTP ' + r.status));
        err.status = r.status;
        err.data = data;
        throw err;
      }
      return data;
    },
    me()                  { return this.req('GET', '/api/me'); },
    listSongs(params)     {
      const qs = new URLSearchParams(params || {}).toString();
      return this.req('GET', '/api/songs' + (qs ? '?' + qs : ''));
    },
    getSong(id)           { return this.req('GET', '/api/songs/' + id); },
    createSong(data)      { return this.req('POST', '/api/songs', data); },
    updateSong(id, data)  { return this.req('PUT', '/api/songs/' + id, data); },
    deleteSong(id)        { return this.req('DELETE', '/api/songs/' + id); },
    listChords()          { return this.req('GET', '/api/chords'); },
    addChord(data)        { return this.req('POST', '/api/chords', data); },
    deleteChord(id)       { return this.req('DELETE', '/api/chords/' + id); },
    logout()              { return this.req('POST', '/api/auth/logout'); },
  };

  // -------- Toast --------
  const toastEl = document.getElementById('toast');
  let toastTimer = null;
  function toast(msg, kind = '') {
    toastEl.className = 'toast ' + kind;
    toastEl.textContent = msg;
    toastEl.classList.remove('hidden');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.add('hidden'), 2800);
  }

  // -------- Parser --------
  function parseSongBody(text) {
    const lines = (text || '').split('\n');
    const out = [];
    for (let i = 0; i < lines.length; i++) {
      const raw = lines[i];
      const trimmed = raw.trim();
      if (trimmed === '') {
        out.push({ type: 'break' });
        continue;
      }
      if (/^\[.+\]$/.test(trimmed)) {
        out.push({ type: 'section', label: trimmed.slice(1, -1) });
        continue;
      }
      if (Chords.isTabLine(raw)) {
        const block = [raw];
        while (i + 1 < lines.length && Chords.isTabLine(lines[i + 1])) {
          block.push(lines[++i]);
        }
        out.push({ type: 'tab_block', lines: block });
        continue;
      }
      if (Chords.isChordLine(raw)) {
        // Pair with next line if it's a lyric (not a chord/tab/section/break)
        const next = lines[i + 1];
        const nextTrim = (next || '').trim();
        const isLyric = next !== undefined &&
                        nextTrim !== '' &&
                        !/^\[.+\]$/.test(nextTrim) &&
                        !Chords.isTabLine(next) &&
                        !Chords.isChordLine(next);
        if (isLyric) {
          out.push({ type: 'chord_lyric', chords: raw, lyrics: next });
          i++;
        } else {
          out.push({ type: 'chord_only', chords: raw });
        }
        continue;
      }
      out.push({ type: 'lyric', text: raw });
    }
    return out;
  }

  // -------- Preview renderer --------
  function escapeHtml(s) {
    return s.replace(/[&<>"']/g, c => ({
      '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'
    })[c]);
  }

  function renderChordRow(chordsLine) {
    // Wrap each chord token in a clickable span while preserving the original spacing.
    const escaped = escapeHtml(chordsLine);
    return escaped.replace(Chords.CHORD_GLOBAL_RE,
      (full, tok) => `<span class="chord-token" data-chord="${tok}">${tok}</span>`);
  }

  function renderParsed(parsed, container) {
    const html = [];
    for (const block of parsed) {
      if (block.type === 'break') {
        html.push('<div class="br"></div>');
      } else if (block.type === 'section') {
        html.push(`<h3 class="section-label">[${escapeHtml(block.label)}]</h3>`);
      } else if (block.type === 'chord_lyric') {
        html.push(
          '<div class="chord-lyric-pair">' +
            `<div class="chord-row">${renderChordRow(block.chords)}</div>` +
            `<div class="lyric-row">${escapeHtml(block.lyrics)}</div>` +
          '</div>'
        );
      } else if (block.type === 'chord_only') {
        html.push(`<div class="chord-lyric-pair"><div class="chord-row">${renderChordRow(block.chords)}</div></div>`);
      } else if (block.type === 'tab_block') {
        html.push(`<pre class="tab-block">${escapeHtml(block.lines.join('\n'))}</pre>`);
      } else if (block.type === 'lyric') {
        html.push(`<div class="lyric">${escapeHtml(block.text)}</div>`);
      }
    }
    container.innerHTML = html.join('');
  }

  // -------- Chord popover --------
  const popover = document.getElementById('chord-popover');
  let popoverTarget = null;

  function buildPopoverHTML(chordName) {
    const variants = Chords.getVariants(chordName);
    const def = variants[0];
    if (!def) {
      return `<div class="popover-title">${escapeHtml(chordName)}</div>` +
             '<div class="muted">No diagram in library. ' +
             '<a href="#chords">Add one →</a></div>';
    }
    const diagram = Chords.renderDiagram(chordName, def.frets, def.barre_fret);
    const notes = Chords.chordNotes(chordName, def.frets);
    let variantBtns = '';
    if (variants.length > 1) {
      variantBtns = variants.map((v, i) =>
        `<button class="variant-btn" data-variant="${i}">${i + 1}</button>`
      ).join(' ');
    }
    return [
      `<div class="popover-title">${escapeHtml(chordName)}</div>`,
      `<div class="muted" style="font-family: -apple-system, sans-serif;">Notes: ${notes.join(', ')}</div>`,
      `<pre data-diagram>${escapeHtml(diagram)}</pre>`,
      '<div class="popover-actions">',
        variantBtns ? `Variants: ${variantBtns}` : '',
        '<button data-copy>Copy diagram</button>',
        '<button data-close>Close</button>',
      '</div>',
    ].join('\n');
  }

  function showPopover(targetEl, chordName) {
    popover.innerHTML = buildPopoverHTML(chordName);
    popover.classList.remove('hidden');
    const rect = targetEl.getBoundingClientRect();
    const top  = window.scrollY + rect.bottom + 6;
    const left = Math.min(window.scrollX + rect.left,
                          window.scrollX + window.innerWidth - 280);
    popover.style.top = top + 'px';
    popover.style.left = left + 'px';
    popoverTarget = targetEl;

    const variants = Chords.getVariants(chordName);

    popover.querySelectorAll('.variant-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = parseInt(btn.dataset.variant, 10);
        const v = variants[idx];
        if (!v) return;
        const diagram = Chords.renderDiagram(chordName, v.frets, v.barre_fret);
        popover.querySelector('[data-diagram]').textContent = diagram;
      });
    });
    const copyBtn = popover.querySelector('[data-copy]');
    if (copyBtn) {
      copyBtn.addEventListener('click', () => {
        const diagram = popover.querySelector('[data-diagram]').textContent;
        copyToCursor(diagram);
        toast('Diagram inserted at cursor', 'success');
      });
    }
    popover.querySelector('[data-close]').addEventListener('click', hidePopover);
  }
  function hidePopover() {
    popover.classList.add('hidden');
    popoverTarget = null;
  }

  document.addEventListener('click', (e) => {
    if (e.target.closest('#chord-popover')) return;
    if (e.target.classList.contains('chord-token')) {
      showPopover(e.target, e.target.dataset.chord);
      e.stopPropagation();
    } else {
      hidePopover();
    }
  });

  function copyToCursor(text) {
    const ta = document.getElementById('raw-editor');
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const v = ta.value;
    const insert = '\n' + text + '\n';
    ta.value = v.slice(0, start) + insert + v.slice(end);
    ta.selectionStart = ta.selectionEnd = start + insert.length;
    ta.dispatchEvent(new Event('input'));
  }

  // -------- Routing --------
  const routes = [
    { match: /^#?$|^#library$/,        handler: viewLibrary },
    { match: /^#song\/new$/,           handler: () => viewEditor(null) },
    { match: /^#song\/(\d+)\/edit$/,   handler: m => viewEditor(parseInt(m[1], 10)) },
    { match: /^#song\/(\d+)$/,         handler: m => viewEditor(parseInt(m[1], 10), { readOnly: true }) },
    { match: /^#chords$/,              handler: viewChords },
  ];
  function navigate() {
    const hash = window.location.hash || '#library';
    for (const r of routes) {
      const m = hash.match(r.match);
      if (m) { r.handler(m); return; }
    }
    window.location.hash = '#library';
  }
  window.addEventListener('hashchange', navigate);

  // -------- Library view --------
  let _libCache = [];
  async function viewLibrary() {
    const root = document.getElementById('view-root');
    root.innerHTML = '';
    const tpl = document.getElementById('tpl-library').content.cloneNode(true);
    root.appendChild(tpl);

    const search   = document.getElementById('lib-search');
    const diff     = document.getElementById('lib-difficulty');
    const sort     = document.getElementById('lib-sort');

    async function refresh() {
      try {
        const params = {};
        if (search.value.trim())  params.q = search.value.trim();
        if (diff.value)           params.difficulty = diff.value;
        if (sort.value)           params.sort = sort.value;
        const data = await API.listSongs(params);
        _libCache = data.songs;
        renderLibList(_libCache);
      } catch (e) { toast(e.message, 'error'); }
    }
    let typingTimer;
    search.addEventListener('input', () => {
      clearTimeout(typingTimer);
      typingTimer = setTimeout(refresh, 200);
    });
    diff.addEventListener('change', refresh);
    sort.addEventListener('change', refresh);

    refresh();
  }

  function renderLibList(songs) {
    const grid = document.getElementById('lib-list');
    const empty = document.getElementById('lib-empty');
    if (!songs.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    grid.innerHTML = songs.map(s => `
      <article class="song-card" data-id="${s.id}">
        <h3>🎸 ${escapeHtml(s.title)}</h3>
        <div class="meta-row">
          ${escapeHtml(s.artist || '')}
          ${s.year ? ' · ' + s.year : ''}
          ${s.genre ? ' · ' + escapeHtml(s.genre) : ''}
        </div>
        <div class="meta-row">
          Key: ${escapeHtml(s.original_key || '–')} ·
          Capo: ${s.capo ? s.capo : 'none'} ·
          Tuning: ${escapeHtml(s.tuning || 'Standard')} ·
          ${s.tempo_bpm} BPM
        </div>
        <div class="badges">
          <span class="badge diff-${s.difficulty}">${s.difficulty}</span>
          ${(s.tags || []).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join('')}
        </div>
        <div class="actions">
          <a class="primary" href="#song/${s.id}/edit">Edit</a>
          <a href="#song/${s.id}">View</a>
          <button data-act="json">JSON</button>
          <button data-act="txt">TXT</button>
          <button data-act="dup">Duplicate</button>
          <button class="danger" data-act="del">🗑</button>
        </div>
      </article>
    `).join('');

    grid.querySelectorAll('.song-card').forEach(card => {
      const id = parseInt(card.dataset.id, 10);
      card.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const act = btn.dataset.act;
          if (act === 'json') window.location.href = '/api/songs/' + id + '/export/json';
          else if (act === 'txt') window.location.href = '/api/songs/' + id + '/export/txt';
          else if (act === 'dup') {
            try {
              const data = await API.getSong(id);
              const s = data.song;
              const dup = { ...s, title: s.title + ' (copy)' };
              delete dup.id; delete dup.user_id; delete dup.created_at; delete dup.updated_at;
              await API.createSong(dup);
              toast('Duplicated', 'success');
              navigate();
            } catch (e) { toast(e.message, 'error'); }
          } else if (act === 'del') {
            if (!confirm('Delete this song?')) return;
            try { await API.deleteSong(id); toast('Deleted', 'success'); navigate(); }
            catch (e) { toast(e.message, 'error'); }
          }
        });
      });
    });
  }

  // -------- Editor view --------
  let _editorState = null;

  // Draft persistence — keeps the unsaved new song in sessionStorage so
  // navigating away and back does not lose typed content.
  const DRAFT_KEY = 'asciichords:draft:new';
  function readDraft() {
    try { return JSON.parse(sessionStorage.getItem(DRAFT_KEY) || 'null'); }
    catch (e) { return null; }
  }
  function writeDraft(data) {
    try { sessionStorage.setItem(DRAFT_KEY, JSON.stringify(data)); } catch (e) {}
  }
  function clearDraft() {
    try { sessionStorage.removeItem(DRAFT_KEY); } catch (e) {}
  }

  async function viewEditor(songId, opts = {}) {
    const root = document.getElementById('view-root');
    root.innerHTML = '';
    const tpl = document.getElementById('tpl-editor').content.cloneNode(true);
    root.appendChild(tpl);

    // Default empty state
    let song = {
      id: null, title: '', artist: '', album: '', year: '',
      original_key: 'C', capo: 0, tuning: 'Standard', tempo_bpm: 120,
      difficulty: 'Intermediate', genre: '', strumming: '',
      notes: '', body: '', tags: [],
    };
    if (songId) {
      try {
        const data = await API.getSong(songId);
        song = data.song;
      } catch (e) { toast(e.message, 'error'); window.location.hash = '#library'; return; }
    } else {
      // New-song view: restore unsaved draft if present
      const draft = readDraft();
      if (draft) {
        song = Object.assign(song, draft);
        toast('Restored unsaved draft', '');
      }
    }
    _editorState = { song, semitones: 0, useFlats: false, readOnly: !!opts.readOnly };

    fillMetaForm(song);
    const ta      = document.getElementById('raw-editor');
    const preview = document.getElementById('preview');
    ta.value = song.body || '';
    if (opts.readOnly) ta.setAttribute('readonly', '');

    // Live preview with debounce
    let renderTimer;
    function rerender() {
      const text = applyTransposition(ta.value, _editorState.semitones, _editorState.useFlats);
      const parsed = parseSongBody(text);
      renderParsed(parsed, preview);
    }
    function scheduleRender() {
      clearTimeout(renderTimer);
      renderTimer = setTimeout(rerender, 150);
    }
    ta.addEventListener('input', scheduleRender);
    rerender();

    // Persist draft on every change while editing an unsaved new song.
    if (!_editorState.song.id && !opts.readOnly) {
      let draftTimer;
      const persist = () => {
        clearTimeout(draftTimer);
        draftTimer = setTimeout(() => writeDraft(readMetaForm()), 200);
      };
      ta.addEventListener('input', persist);
      [
        'meta-title','meta-artist','meta-album','meta-year','meta-key','meta-capo',
        'meta-tuning','meta-bpm','meta-difficulty','meta-genre','meta-tags','meta-notes',
      ].forEach(id => {
        const el = document.getElementById(id);
        if (el) {
          el.addEventListener('input', persist);
          el.addEventListener('change', persist);
        }
      });
    }

    // Wire toolbar
    wireToolbar(rerender);
    updateCapoInfo();
  }

  function fillMetaForm(s) {
    document.getElementById('meta-title').value      = s.title || '';
    document.getElementById('meta-artist').value     = s.artist || '';
    document.getElementById('meta-album').value      = s.album || '';
    document.getElementById('meta-year').value       = s.year || '';
    document.getElementById('meta-key').value        = s.original_key || '';
    document.getElementById('meta-capo').value       = s.capo || 0;
    document.getElementById('meta-tuning').value     = s.tuning || 'Standard';
    document.getElementById('meta-bpm').value        = s.tempo_bpm || 120;
    document.getElementById('meta-difficulty').value = s.difficulty || 'Intermediate';
    document.getElementById('meta-genre').value      = s.genre || '';
    document.getElementById('meta-tags').value       = (s.tags || []).join(', ');
    document.getElementById('meta-notes').value      = s.notes || '';
    const bpmDisplay = document.getElementById('bpm-display');
    document.getElementById('bpm-slider').value      = s.tempo_bpm || 120;
    bpmDisplay.value = s.tempo_bpm || 120;
  }

  function readMetaForm() {
    return {
      title:        document.getElementById('meta-title').value.trim(),
      artist:       document.getElementById('meta-artist').value.trim() || 'Unknown Artist',
      album:        document.getElementById('meta-album').value.trim() || null,
      year:         document.getElementById('meta-year').value || null,
      original_key: document.getElementById('meta-key').value.trim() || 'C',
      capo:         parseInt(document.getElementById('meta-capo').value, 10) || 0,
      tuning:       document.getElementById('meta-tuning').value,
      tempo_bpm:    parseInt(document.getElementById('meta-bpm').value, 10) || 120,
      difficulty:   document.getElementById('meta-difficulty').value,
      genre:        document.getElementById('meta-genre').value.trim() || null,
      tags:         document.getElementById('meta-tags').value
                      .split(',').map(s => s.trim()).filter(Boolean),
      notes:        document.getElementById('meta-notes').value,
      body:         document.getElementById('raw-editor').value,
    };
  }

  function applyTransposition(text, semitones, useFlats) {
    if (!semitones) return text;
    const lines = text.split('\n');
    return lines.map(line => {
      if (Chords.isTabLine(line)) return Chords.transposeTabFretLine(line, semitones);
      if (Chords.isChordLine(line)) return Chords.transposeChordName(line, semitones, useFlats);
      return line;
    }).join('\n');
  }

  function updateCapoInfo() {
    const capo = parseInt(document.getElementById('meta-capo').value, 10) || 0;
    const key  = document.getElementById('meta-key').value.trim() || '–';
    const info = document.getElementById('capo-info');
    if (!info) return;
    info.textContent = capo
      ? `Capo ${capo} → Sounds in ${Chords.transposeChordName(key, capo, false)}`
      : '';
  }

  function wireToolbar(rerender) {
    const ta = document.getElementById('raw-editor');

    document.getElementById('meta-capo').addEventListener('input', updateCapoInfo);
    document.getElementById('meta-key').addEventListener('input', updateCapoInfo);

    // Transposition
    document.getElementById('transpose-up').addEventListener('click', () => {
      _editorState.semitones += 1; rerender();
    });
    document.getElementById('transpose-down').addEventListener('click', () => {
      _editorState.semitones -= 1; rerender();
    });
    document.getElementById('accidental-select').addEventListener('change', e => {
      _editorState.useFlats = e.target.value === 'flat'; rerender();
    });

    // BPM slider + manual entry
    const bpmSlider  = document.getElementById('bpm-slider');
    const bpmDisplay = document.getElementById('bpm-display');
    const clampBpm = v => Math.max(40, Math.min(240, parseInt(v, 10) || 120));
    const applyBpm = (v, opts = {}) => {
      const n = clampBpm(v);
      if (!opts.fromSlider) bpmSlider.value = n;
      if (!opts.fromInput)  bpmDisplay.value = n;
      document.getElementById('meta-bpm').value = n;
      if (window.Player) window.Player.setBpm(n);
    };
    bpmSlider.addEventListener('input', () => applyBpm(bpmSlider.value, { fromSlider: true }));
    bpmDisplay.addEventListener('input', () => {
      // Don't clamp/snap on every keystroke — let the user type freely
      const n = parseInt(bpmDisplay.value, 10);
      if (!isNaN(n) && n >= 40 && n <= 240) {
        bpmSlider.value = n;
        document.getElementById('meta-bpm').value = n;
        if (window.Player) window.Player.setBpm(n);
      }
    });
    bpmDisplay.addEventListener('change', () => applyBpm(bpmDisplay.value, { fromInput: true }));

    // Playback
    document.getElementById('play-btn').addEventListener('click', () => {
      const text = applyTransposition(ta.value, _editorState.semitones, _editorState.useFlats);
      window.Player.play(text, parseInt(bpmSlider.value, 10));
    });
    document.getElementById('pause-btn').addEventListener('click', () => window.Player.pause());
    document.getElementById('stop-btn').addEventListener('click',  () => window.Player.stop());
    document.getElementById('metronome-toggle').addEventListener('change', e => {
      window.Player.setMetronome(e.target.checked);
    });

    // Autoscroll
    const asBtn      = document.getElementById('autoscroll-btn');
    const asSpeed    = document.getElementById('autoscroll-speed');
    const asDisplay  = document.getElementById('autoscroll-display');
    asBtn.addEventListener('click', () => {
      window.Autoscroll.toggle(document.getElementById('preview'),
                               parseFloat(asSpeed.value));
    });
    asSpeed.addEventListener('input', () => {
      asDisplay.textContent = parseFloat(asSpeed.value).toFixed(1) + '×';
      window.Autoscroll.setSpeed(parseFloat(asSpeed.value));
    });

    // Save / Export / Delete / Print
    document.getElementById('save-btn').addEventListener('click', saveSong);
    document.getElementById('export-json-btn').addEventListener('click', () => exportSong('json'));
    document.getElementById('export-txt-btn').addEventListener('click', () => exportSong('txt'));
    document.getElementById('print-btn').addEventListener('click', () => window.print());
    document.getElementById('delete-btn').addEventListener('click', deleteCurrentSong);
  }

  async function saveSong() {
    const status = document.getElementById('save-status');
    const data = readMetaForm();
    if (!data.title) { toast('Title is required', 'error'); return; }
    status.textContent = 'Saving…';
    try {
      let result;
      if (_editorState.song.id) {
        result = await API.updateSong(_editorState.song.id, data);
      } else {
        result = await API.createSong(data);
      }
      _editorState.song = result.song;
      clearDraft();
      status.textContent = 'Saved.';
      toast('Saved', 'success');
      // Update hash for new songs
      if (window.location.hash === '#song/new') {
        window.history.replaceState(null, '', '#song/' + result.song.id + '/edit');
      }
      setTimeout(() => status.textContent = '', 2000);
    } catch (e) { status.textContent = ''; toast(e.message, 'error'); }
  }

  function exportSong(format) {
    if (!_editorState.song.id) {
      toast('Save first, then export', 'error');
      return;
    }
    window.location.href = '/api/songs/' + _editorState.song.id + '/export/' + format;
  }

  async function deleteCurrentSong() {
    if (!_editorState.song.id) {
      // New-song view: treat Delete as "discard draft"
      const draft = readDraft();
      if (draft) {
        if (!confirm('Discard the unsaved draft?')) return;
        clearDraft();
        toast('Draft discarded', '');
      }
      window.location.hash = '#library';
      return;
    }
    if (!confirm('Delete this song?')) return;
    try {
      await API.deleteSong(_editorState.song.id);
      toast('Deleted', 'success');
      window.location.hash = '#library';
    } catch (e) { toast(e.message, 'error'); }
  }

  // -------- Chord dictionary view --------
  async function viewChords() {
    const root = document.getElementById('view-root');
    root.innerHTML = '';
    const tpl = document.getElementById('tpl-chords-dict').content.cloneNode(true);
    root.appendChild(tpl);

    const grid   = document.getElementById('chord-grid');
    const search = document.getElementById('chord-search');

    function render(filter) {
      const lib = Chords.getLibrary();
      const items = filter
        ? lib.filter(c => c.chord_name.toLowerCase().includes(filter))
        : lib;
      grid.innerHTML = items.map(c => `
        <div class="chord-card">
          <div class="chord-card-name">${escapeHtml(c.chord_name)} <span class="muted">v${c.variant}</span></div>
          <pre>${escapeHtml(Chords.renderDiagram(c.chord_name, c.frets, c.barre_fret))}</pre>
        </div>
      `).join('');
    }
    render('');
    let t;
    search.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(() => render(search.value.trim().toLowerCase()), 120);
    });
  }

  // -------- Boot --------
  async function boot() {
    // Auth gate
    try {
      const me = await API.me();
      if (!me.user) {
        window.location.href = 'login.html';
        return;
      }
      document.getElementById('user-label').textContent = me.user.username;
    } catch (e) {
      window.location.href = 'login.html';
      return;
    }

    // Logout
    document.getElementById('logout-btn').addEventListener('click', async () => {
      try { await API.logout(); } catch (e) {}
      window.location.href = 'login.html';
    });

    // Pre-fetch chord library so popovers + dictionary work without a round-trip
    try {
      const data = await API.listChords();
      Chords.setLibrary(data.chords);
    } catch (e) { Chords.setLibrary([]); }

    navigate();
  }

  // Expose internals helpful for testing
  window.AsciiChords = { parseSongBody, renderParsed, applyTransposition };

  document.addEventListener('DOMContentLoaded', boot);
})();
