/* ============================================================
   chords.js — chord token regex, ASCII diagram renderer,
                 transposition helpers
   ============================================================ */

window.Chords = (function () {
  // -------- Constants --------
  const SHARPS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const FLATS  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

  // Storage convention: frets stored low-to-high (E A D G B e), -1 = mute, 0 = open
  // Display convention: top of grid = high e (string 1), bottom = low E (string 6)
  const STRING_NAMES_HIGH_TO_LOW = ['e', 'B', 'G', 'D', 'A', 'E'];
  const STRING_NAMES_LOW_TO_HIGH = ['E', 'A', 'D', 'G', 'B', 'e'];

  // Notes per string for naming chord tones (low-to-high E A D G B e)
  const STRING_OPEN_NOTE = ['E', 'A', 'D', 'G', 'B', 'E']; // last 'E' = high e

  // Chord token regex — matches Am, F#m, C/G, Bm7, Cmaj7, E/G#, Cadd9
  const CHORD_TOKEN_RE = /^[A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add\d+|\d+)*(?:\/[A-G][#b]?)?$/;
  const CHORD_GLOBAL_RE = /\b([A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add\d+|\d+)*(?:\/[A-G][#b]?)?)\b/g;

  function isChordToken(tok) { return CHORD_TOKEN_RE.test(tok); }

  function isChordLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;
    const tokens = trimmed.split(/\s+/);
    if (tokens.length === 0) return false;
    // Require at least one chord-shaped token, and ALL tokens must match
    return tokens.every(tok => isChordToken(tok));
  }

  function isTabLine(line) {
    return /^\s*[eEBGDAd]\|/.test(line);
  }

  // -------- Transposition --------
  function transposeChordName(name, semitones, useFlats = false) {
    if (!name) return name;
    return name.replace(/([A-G][#b]?)/g, (root) => {
      const idxSharp = SHARPS.indexOf(root);
      const idxFlat  = FLATS.indexOf(root);
      const idx = idxSharp !== -1 ? idxSharp : idxFlat;
      if (idx === -1) return root;
      const next = ((idx + semitones) % 12 + 12) % 12;
      return useFlats ? FLATS[next] : SHARPS[next];
    });
  }

  function transposeTabFretLine(line, semitones) {
    // Keep the leading "X|" intact, transform fret numbers in the body.
    const m = line.match(/^(\s*[eEBGDAd]\|)(.*)$/);
    if (!m) return line;
    const head = m[1];
    let body = m[2];
    body = body.replace(/(\d+)/g, (full) => {
      const v = parseInt(full, 10);
      const nv = v + semitones;
      if (nv < 0) return '0';
      if (nv > 24) return '24';
      return String(nv);
    });
    return head + body;
  }

  // -------- Diagram rendering --------
  // frets : 6-element array, low-to-high (E A D G B e). -1 mute, 0 open, 1..24 fret
  // barre : null | fret number
  function renderDiagram(chordName, fretsLowToHigh, barre = null) {
    const frets = fretsLowToHigh.slice();
    // Display order is high-to-low so we reverse.
    const displayFrets = frets.slice().reverse();   // index 0 = high e
    const stringNames  = STRING_NAMES_HIGH_TO_LOW;

    const positiveFrets = displayFrets.filter(f => f > 0);
    const minFret = positiveFrets.length ? Math.min(...positiveFrets) : 1;
    const maxFret = positiveFrets.length ? Math.max(...positiveFrets) : 1;
    const startFret = (minFret > 4 || maxFret > 4) ? minFret : 1;
    const rows = 4;
    const strings = 6;

    const lines = [];
    lines.push(chordName);
    if (startFret > 1) lines.push(`${startFret}fr`);

    // Top status line: ✕ for muted, ○ for open, space for fretted
    const top = displayFrets.map(f => f === -1 ? '✕' : f === 0 ? '○' : ' ').join(' ');
    lines.push(' ' + top);

    lines.push('╔═╤═╤═╤═╤═╤═╗');
    for (let r = 0; r < rows; r++) {
      const fretNum = startFret + r;
      let mid = '║';
      for (let s = 0; s < strings; s++) {
        const isPressed = displayFrets[s] === fretNum;
        const isBarre   = barre !== null && fretNum === barre && displayFrets[s] >= barre;
        mid += (isPressed || isBarre) ? '●' : ' ';
        mid += s < strings - 1 ? '│' : '║';
      }
      lines.push(mid);
      if (r < rows - 1) lines.push('╠═╪═╪═╪═╪═╪═╣');
    }
    lines.push('╚═╧═╧═╧═╧═╧═╝');
    lines.push(' ' + stringNames.join(' '));

    return lines.join('\n');
  }

  // -------- Chord notes (display only) --------
  function chordNotes(chordName, fretsLowToHigh) {
    // Map every non-muted string to its sounding note
    const out = [];
    for (let i = 0; i < 6; i++) {
      const f = fretsLowToHigh[i];
      if (f < 0) continue;
      const open = STRING_OPEN_NOTE[i];
      const idx = SHARPS.indexOf(open);
      if (idx === -1) continue;
      const noteIdx = ((idx + f) % 12 + 12) % 12;
      out.push(SHARPS[noteIdx]);
    }
    // Deduplicate while preserving order
    const seen = new Set();
    return out.filter(n => seen.has(n) ? false : (seen.add(n), true));
  }

  // -------- Library lookup --------
  // Cached chord library fetched from /api/chords
  let _chordLibrary = null;          // array
  let _chordIndex   = null;          // map: name -> array of variants
  function setLibrary(list) {
    _chordLibrary = list || [];
    _chordIndex = {};
    for (const c of _chordLibrary) {
      const k = c.chord_name;
      (_chordIndex[k] ||= []).push(c);
    }
  }
  function getLibrary() { return _chordLibrary || []; }
  function getVariants(name) { return (_chordIndex && _chordIndex[name]) || []; }
  function getDefault(name) {
    const v = getVariants(name);
    return v.length ? v[0] : null;
  }

  return {
    SHARPS, FLATS,
    CHORD_GLOBAL_RE, CHORD_TOKEN_RE,
    isChordToken, isChordLine, isTabLine,
    transposeChordName, transposeTabFretLine,
    renderDiagram, chordNotes,
    setLibrary, getLibrary, getVariants, getDefault,
  };
})();
