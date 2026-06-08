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
    listPublicSongs(params) {
      const qs = new URLSearchParams(params || {}).toString();
      return this.req('GET', '/api/public/songs' + (qs ? '?' + qs : ''));
    },
    getSong(id)           { return this.req('GET', '/api/songs/' + id); },
    createSong(data)      { return this.req('POST', '/api/songs', data); },
    updateSong(id, data)  { return this.req('PUT', '/api/songs/' + id, data); },
    deleteSong(id)        { return this.req('DELETE', '/api/songs/' + id); },
    listChords()          { return this.req('GET', '/api/chords'); },
    importSong(file)      {
      const fd = new FormData();
      fd.append('file', file);
      return this.req('POST', '/api/songs/import', fd);
    },
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
      (full, tok) => {
        const missing = !Chords.getDefault(tok);
        return `<span class="chord-token${missing ? ' chord-missing' : ''}" data-chord="${tok}">${tok}</span>`;
      });
  }

  function collectUnknownChords(parsed) {
    const unknown = new Set();
    for (const block of parsed) {
      const line = block.chords;
      if (!line) continue;
      const tokens = line.match(Chords.CHORD_GLOBAL_RE) || [];
      tokens.forEach(tok => {
        if (!Chords.getDefault(tok)) unknown.add(tok);
      });
    }
    return Array.from(unknown).sort();
  }

  function renderChordValidation(unknown) {
    const box = document.getElementById('chord-validation');
    if (!box) return;
    if (!unknown.length) {
      box.classList.add('hidden');
      box.innerHTML = '';
      return;
    }
    box.classList.remove('hidden');
    box.innerHTML = '<strong>Unknown chord shapes:</strong> ' +
      unknown.map(c => `<span>${escapeHtml(c)}</span>`).join(' ') +
      '<em>These chords will be skipped by chord playback unless written as tab.</em>';
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
             '<div class="muted">No diagram in library.</div>';
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
    { match: /^#catalog$/,             handler: viewCatalog },
    { match: /^#help$/,                handler: viewHelp },
  ];
  // Routes a signed-out visitor is allowed to use. Everything else bounces
  // through login.html.
  const PUBLIC_ROUTES = [/^#catalog$/, /^#song\/\d+$/, /^#chords$/, /^#help$/];
  function isPublicRoute(hash) {
    return PUBLIC_ROUTES.some(re => re.test(hash));
  }
  let _isGuest = false;
  let _activeRouteHash = null;
  function isSongRoute(hash) {
    return /^#song\/(?:new|\d+)/.test(hash || '');
  }
  function stopActivePlayback() {
    if (window.Player && typeof window.Player.stop === 'function') {
      window.Player.stop();
    }
  }
  function navigate() {
    // The tab editor modal lives outside #view-root, so a route change
    // wouldn't otherwise clear it. Hide it on every navigation.
    const tabModal = document.getElementById('tab-editor-modal');
    if (tabModal) tabModal.classList.add('hidden');
    const hash = window.location.hash || '#library';
    if (_activeRouteHash && _activeRouteHash !== hash && isSongRoute(_activeRouteHash)) {
      stopActivePlayback();
    }
    _activeRouteHash = hash;
    if (_isGuest && !isPublicRoute(hash)) {
      window.location.href = 'login.html';
      return;
    }
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

    // Import flow: POST the file, prefill an unsaved draft from the parsed
    // payload, navigate to #song/new — the editor restores from draft on mount.
    const importBtn  = document.getElementById('import-btn');
    const importFile = document.getElementById('import-file');
    if (importBtn && importFile) {
      importBtn.addEventListener('click', () => importFile.click());
      importFile.addEventListener('change', async () => {
        const file = importFile.files && importFile.files[0];
        if (!file) return;
        try {
          const res = await API.importSong(file);
          if (!res || !res.parsed) throw new Error('Import returned no payload');
          writeDraft(res.parsed);
          toast('Imported — review and save', 'success');
          window.location.hash = '#song/new';
        } catch (e) {
          toast('Import failed: ' + e.message, 'error');
        } finally {
          importFile.value = '';
        }
      });
    }

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
          ${s.is_public ? '<span class="badge badge-public">🌐 public</span>' : '<span class="badge badge-private">🔒 private</span>'}
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
            try { stopActivePlayback(); await API.deleteSong(id); toast('Deleted', 'success'); navigate(); }
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
      notes: '', body: '', tags: [], is_public: false, is_owner: true,
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
    // Force read-only when the current user does not own the song, or
    // when the visitor is signed-out (guests can never edit).
    const effectiveReadOnly = !!opts.readOnly || _isGuest || (song.id && song.is_owner === false);
    _editorState = { song, semitones: 0, useFlats: false, readOnly: effectiveReadOnly };

    fillMetaForm(song);
    const ta      = document.getElementById('raw-editor');
    const preview = document.getElementById('preview');
    ta.value = song.body || '';
    if (effectiveReadOnly) {
      ta.setAttribute('readonly', '');
      // Hide the raw editor pane entirely in read-only view — viewers want
      // the rendered song, not the source.
      const editorView = document.querySelector('.editor-view');
      if (editorView) editorView.classList.add('read-only');
      // Lock every meta input so the read-only viewer can't edit anything.
      document.querySelectorAll('.editor-meta-grid input, .editor-meta-grid select, .editor-meta-grid textarea, .editor-meta-bar input')
        .forEach(el => el.setAttribute('disabled', ''));
      // Remove edit-only affordances when not the owner.
      ['save-btn', 'delete-btn', 'tab-editor-btn'].forEach(id => {
        const b = document.getElementById(id);
        if (b) b.style.display = 'none';
      });
      // Show a banner when viewing someone else's public song, or any
      // song while signed out.
      if (_isGuest || (song.id && song.is_owner === false)) {
        const banner = document.createElement('div');
        banner.className = 'readonly-banner';
        if (_isGuest) {
          banner.innerHTML = '👁 Viewing a public song. ' +
            '<a href="login.html">Sign in</a> to save your own songs.';
        } else {
          banner.textContent = '👁 Viewing a public song from the catalog. You cannot edit or save changes.';
        }
        const view = document.querySelector('.editor-view');
        if (view) view.insertBefore(banner, view.firstChild);
      }
    }

    // Live preview with debounce
    let renderTimer;
    function rerender() {
      const text = applyTransposition(ta.value, _editorState.semitones, _editorState.useFlats);
      const parsed = parseSongBody(text);
      renderParsed(parsed, preview);
      renderChordValidation(collectUnknownChords(parsed));
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
        'meta-is-public',
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
    document.getElementById('meta-is-public').checked = !!s.is_public;
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
      is_public:    document.getElementById('meta-is-public').checked,
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
      const tuning = document.getElementById('meta-tuning').value;
      window.Player.play(text, parseInt(bpmSlider.value, 10), tuning);
    });
    document.getElementById('pause-btn').addEventListener('click', () => window.Player.pause());
    document.getElementById('stop-btn').addEventListener('click',  () => window.Player.stop());
    document.getElementById('metronome-toggle').addEventListener('change', e => {
      window.Player.setMetronome(e.target.checked);
    });
    const modeSel = document.getElementById('playback-mode');
    if (modeSel && window.Player) {
      window.Player.setPlaybackMode(modeSel.value);
      modeSel.addEventListener('change', e => window.Player.setPlaybackMode(e.target.value));
    }
    const statusEl = document.getElementById('player-status');
    if (statusEl) {
      window.addEventListener('player:status', e => {
        statusEl.textContent = e.detail.message || '';
        statusEl.dataset.state = e.detail.state || '';
      });
    }
    // Tuning change — apply immediately to any in-flight playback
    document.getElementById('meta-tuning').addEventListener('change', e => {
      if (window.Player) window.Player.setTuning(e.target.value);
    });
    // Instrument picker — persisted per-browser so the choice survives reloads.
    const instSel = document.getElementById('instrument-select');
    if (instSel) {
      const saved = localStorage.getItem('ac.instrument');
      if (saved && instSel.querySelector('option[value="' + saved + '"]')) {
        instSel.value = saved;
      }
      if (window.Player) window.Player.setInstrument(instSel.value);
      instSel.addEventListener('change', e => {
        localStorage.setItem('ac.instrument', e.target.value);
        if (window.Player) window.Player.setInstrument(e.target.value);
      });
    }

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

    // Tab editor — handled by a document-level delegated listener in
    // wireTabEditorModal() so it survives editor template re-mounts.
  }

  // -------- Tab editor modal --------
  // 6 strings × 8 columns. Display order matches written tab:
  // row 0 = high e (top), row 5 = low E (bottom).
  const TAB_STRINGS = ['e', 'B', 'G', 'D', 'A', 'E'];
  const TAB_COLS    = 8;
  let tabState = null;  // 6×TAB_COLS array of strings ('', '0'..'24', 'x')

  function openTabEditor() {
    const modal = document.getElementById('tab-editor-modal');
    if (!modal) return;
    if (!tabState) {
      tabState = TAB_STRINGS.map(() => Array(TAB_COLS).fill(''));
    }
    renderTabGrid();
    modal.classList.remove('hidden');
    // Focus the first input for keyboard-friendly entry
    const first = modal.querySelector('input.tab-cell');
    if (first) first.focus();
  }

  function closeTabEditor() {
    document.getElementById('tab-editor-modal').classList.add('hidden');
  }

  function renderTabGrid() {
    const grid = document.getElementById('tab-editor-grid');
    const html = [];
    for (let r = 0; r < 6; r++) {
      html.push('<div class="tab-row">');
      html.push(`<span class="tab-string">${TAB_STRINGS[r]}|</span>`);
      for (let c = 0; c < TAB_COLS; c++) {
        const v = tabState[r][c];
        html.push(
          `<input type="text" class="tab-cell" data-r="${r}" data-c="${c}" ` +
          `maxlength="2" value="${v}" />`
        );
      }
      html.push('</div>');
    }
    grid.innerHTML = html.join('');

    grid.querySelectorAll('input.tab-cell').forEach(inp => {
      inp.addEventListener('input', () => {
        const r = parseInt(inp.dataset.r, 10);
        const c = parseInt(inp.dataset.c, 10);
        tabState[r][c] = sanitizeTabCell(inp.value);
        // Keep displayed value in sync with sanitised state, without
        // stealing the cursor on every keystroke.
        if (inp.value !== tabState[r][c]) inp.value = tabState[r][c];
        renderTabPreview();
      });
      inp.addEventListener('keydown', (e) => {
        // Arrow keys to move between cells — quality-of-life for fast entry.
        const r = parseInt(inp.dataset.r, 10);
        const c = parseInt(inp.dataset.c, 10);
        let nr = r, nc = c;
        if (e.key === 'ArrowRight') nc = Math.min(TAB_COLS - 1, c + 1);
        else if (e.key === 'ArrowLeft')  nc = Math.max(0, c - 1);
        else if (e.key === 'ArrowDown')  nr = Math.min(5, r + 1);
        else if (e.key === 'ArrowUp')    nr = Math.max(0, r - 1);
        else return;
        e.preventDefault();
        const next = grid.querySelector(`input[data-r="${nr}"][data-c="${nc}"]`);
        if (next) { next.focus(); next.select(); }
      });
    });

    renderTabPreview();
  }

  function sanitizeTabCell(raw) {
    const s = (raw || '').trim().toLowerCase();
    if (s === '') return '';
    if (s === 'x') return 'x';
    // Numeric fret: clamp to 0..24
    const n = parseInt(s, 10);
    if (isNaN(n)) return '';
    return String(Math.max(0, Math.min(24, n)));
  }

  function tabStateToAscii() {
    // Each column is rendered with width = max width of any cell in that
    // column (so 12s and single digits stay aligned). Empty cells become
    // "-" of the same width. Separator between cells is one "-".
    const colWidths = [];
    for (let c = 0; c < TAB_COLS; c++) {
      let w = 1;
      for (let r = 0; r < 6; r++) {
        const v = tabState[r][c];
        if (v.length > w) w = v.length;
      }
      colWidths.push(w);
    }
    const lines = [];
    for (let r = 0; r < 6; r++) {
      let line = TAB_STRINGS[r] + '|';
      for (let c = 0; c < TAB_COLS; c++) {
        const w = colWidths[c];
        const v = tabState[r][c];
        const cell = v === '' ? '-'.repeat(w) : v.padStart(w, '-');
        line += '-' + cell;
      }
      line += '-|';
      lines.push(line);
    }
    return lines.join('\n');
  }

  function renderTabPreview() {
    document.getElementById('tab-editor-preview').textContent = tabStateToAscii();
  }

  function clearTabState() {
    tabState = TAB_STRINGS.map(() => Array(TAB_COLS).fill(''));
    renderTabGrid();
  }

  function insertTabAtCursor() {
    const ascii = tabStateToAscii();
    // Surround with blank lines so the parser detects it as a tab block
    // even when neighbouring content is lyrics.
    const ta = document.getElementById('raw-editor');
    if (!ta) return;
    const start = ta.selectionStart;
    const end   = ta.selectionEnd;
    const v = ta.value;
    const before = v.slice(0, start);
    const after  = v.slice(end);
    const needLeadingBreak  = before.length > 0 && !before.endsWith('\n');
    const needTrailingBreak = after.length > 0 && !after.startsWith('\n');
    const insert = (needLeadingBreak ? '\n' : '') + ascii +
                   (needTrailingBreak ? '\n' : '');
    ta.value = before + insert + after;
    ta.selectionStart = ta.selectionEnd = start + insert.length;
    ta.dispatchEvent(new Event('input'));
    closeTabEditor();
    toast('Tab inserted', 'success');
  }

  // Wire the modal once globally — it's the same DOM element regardless of
  // which song is open in the editor. The modal markup is in static
  // index.html so it's already in the DOM when this IIFE runs; gating on
  // DOMContentLoaded is unsafe because the script tag at the end of <body>
  // can execute after that event has already fired (in which case the
  // listener would never run).
  function wireTabEditorModal() {
    const closeBtn  = document.getElementById('tab-editor-close');
    const clearBtn  = document.getElementById('tab-editor-clear');
    const insertBtn = document.getElementById('tab-editor-insert');
    const backdrop  = document.getElementById('tab-editor-modal');
    if (closeBtn)  closeBtn.addEventListener('click', closeTabEditor);
    if (clearBtn)  clearBtn.addEventListener('click', clearTabState);
    if (insertBtn) insertBtn.addEventListener('click', insertTabAtCursor);
    if (backdrop) {
      // Make sure it starts hidden, regardless of any stale state from
      // template hydration during route changes.
      backdrop.classList.add('hidden');
      backdrop.addEventListener('click', (e) => {
        if (e.target === backdrop) closeTabEditor();
      });
    }
    // Delegated fallback for the open button: the editor template is
    // re-mounted on every navigation, so a per-mount listener may be lost
    // if wireToolbar fails partway through. This delegated listener stays
    // attached for the lifetime of the page.
    document.addEventListener('click', (e) => {
      const t = e.target.closest && e.target.closest('#tab-editor-btn');
      if (t) openTabEditor();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && backdrop && !backdrop.classList.contains('hidden')) {
        closeTabEditor();
      }
    });
  }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', wireTabEditorModal);
  } else {
    wireTabEditorModal();
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
      stopActivePlayback();
      window.location.hash = '#library';
      return;
    }
    if (!confirm('Delete this song?')) return;
    try {
      stopActivePlayback();
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

    const typeFilter = document.getElementById('chord-filter');

    function chordType(name) {
      if (name.includes('/')) return 'slash';
      if (/5$/.test(name)) return '5';
      if (/m7$/.test(name)) return 'm7';
      if (/maj7$/.test(name)) return 'maj7';
      if (/7$/.test(name)) return '7';
      if (/sus/.test(name)) return 'sus';
      if (/add/.test(name)) return 'add';
      if (/m$/.test(name)) return 'minor';
      return 'major';
    }

    function render(filter) {
      const lib = Chords.getLibrary();
      const type = typeFilter ? typeFilter.value : '';
      const items = lib.filter(c => {
        const matchesText = !filter || c.chord_name.toLowerCase().includes(filter);
        const matchesType = !type || chordType(c.chord_name) === type;
        return matchesText && matchesType;
      });
      grid.innerHTML = items.map(c => `
        <div class="chord-card" data-id="${c.id}">
          <div class="chord-card-name">
            ${escapeHtml(c.chord_name)} <span class="muted">v${c.variant}</span>
          </div>
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
    if (typeFilter) typeFilter.addEventListener('change', () => render(search.value.trim().toLowerCase()));
  }

  // -------- Public catalog view --------
  async function viewCatalog() {
    const root = document.getElementById('view-root');
    root.innerHTML = '';
    const tpl = document.getElementById('tpl-catalog').content.cloneNode(true);
    root.appendChild(tpl);

    const search = document.getElementById('cat-search');
    const diff   = document.getElementById('cat-difficulty');
    const sort   = document.getElementById('cat-sort');

    async function refresh() {
      try {
        const params = {};
        if (search.value.trim()) params.q = search.value.trim();
        if (diff.value)          params.difficulty = diff.value;
        if (sort.value)          params.sort = sort.value;
        const data = await API.listPublicSongs(params);
        renderCatalogList(data.songs);
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

  function renderCatalogList(songs) {
    const grid  = document.getElementById('cat-list');
    const empty = document.getElementById('cat-empty');
    if (!songs.length) { grid.innerHTML = ''; empty.classList.remove('hidden'); return; }
    empty.classList.add('hidden');
    grid.innerHTML = songs.map(s => `
      <article class="song-card" data-id="${s.id}">
        <h3>🎸 ${escapeHtml(s.title)}</h3>
        <div class="meta-row">
          ${escapeHtml(s.artist || '')}
          ${s.year ? ' · ' + s.year : ''}
          ${s.author ? ' · by <em>' + escapeHtml(s.author) + '</em>' : ''}
        </div>
        <div class="meta-row">
          Key: ${escapeHtml(s.original_key || '–')} ·
          Capo: ${s.capo ? s.capo : 'none'} ·
          Tuning: ${escapeHtml(s.tuning || 'Standard')} ·
          ${s.tempo_bpm} BPM
        </div>
        <div class="badges">
          <span class="badge diff-${s.difficulty}">${s.difficulty}</span>
          ${s.genre ? `<span class="badge">${escapeHtml(s.genre)}</span>` : ''}
          ${(s.tags || []).map(t => `<span class="badge">${escapeHtml(t)}</span>`).join('')}
        </div>
        <div class="actions">
          <a class="primary" href="#song/${s.id}">View</a>
          <button data-act="json">JSON</button>
          <button data-act="txt">TXT</button>
        </div>
      </article>
    `).join('');

    grid.querySelectorAll('.song-card').forEach(card => {
      const id = parseInt(card.dataset.id, 10);
      card.querySelectorAll('button[data-act]').forEach(btn => {
        btn.addEventListener('click', () => {
          const act = btn.dataset.act;
          if (act === 'json') window.location.href = '/api/songs/' + id + '/export/json';
          else if (act === 'txt') window.location.href = '/api/songs/' + id + '/export/txt';
        });
      });
    });
  }

  // -------- Help view --------
  function viewHelp() {
    const root = document.getElementById('view-root');
    root.innerHTML = '';
    const tpl = document.getElementById('tpl-help').content.cloneNode(true);
    root.appendChild(tpl);
  }

  // -------- Boot --------
  async function boot() {
    // Auth gate. Guests are allowed on the public-facing routes (catalog,
    // public song view, chord dictionary, help); anything else redirects.
    let me = { user: null };
    try {
      me = await API.me();
    } catch (e) { /* fall through to guest handling */ }

    if (!me.user) {
      const hash = window.location.hash || '';
      if (hash === '' || hash === '#' || hash === '#library') {
        // Land guests on the catalog instead of redirecting to login —
        // the catalog is the public face of the site.
        _isGuest = true;
        document.body.classList.add('guest-mode');
        window.location.hash = '#catalog';
      } else if (!isPublicRoute(hash)) {
        window.location.href = 'login.html';
        return;
      } else {
        _isGuest = true;
        document.body.classList.add('guest-mode');
      }
    } else {
      document.getElementById('user-label').textContent = me.user.username;
    }

    // Logout (only meaningful for signed-in users; safe no-op otherwise)
    const logoutBtn = document.getElementById('logout-btn');
    if (logoutBtn) {
      logoutBtn.addEventListener('click', async () => {
        try { await API.logout(); } catch (e) {}
        window.location.href = 'login.html';
      });
    }

    // Pre-fetch chord library so popovers + dictionary work without a round-trip.
    // The endpoint requires auth — guests just get an empty library, which is fine
    // for catalog browsing (cards don't render diagrams).
    try {
      const data = await API.listChords();
      Chords.setLibrary(data.chords);
    } catch (e) { Chords.setLibrary([]); }

    navigate();
  }

  // Expose internals helpful for testing
  window.AsciiChords = { parseSongBody, renderParsed, applyTransposition };

  document.addEventListener('DOMContentLoaded', boot);
  if (document.readyState !== 'loading') boot();
})();
