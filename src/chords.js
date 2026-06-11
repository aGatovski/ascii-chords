window.Chords = (function () {
  // chord constants
  const SHARPS = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
  const FLATS  = ['C','Db','D','Eb','E','F','Gb','G','Ab','A','Bb','B'];

  // strings
  const STRING_NAMES_HIGH_TO_LOW = ['e', 'B', 'G', 'D', 'A', 'E'];
  const STRING_NAMES_LOW_TO_HIGH = ['E', 'A', 'D', 'G', 'B', 'e'];

  // chord tones
  const STRING_OPEN_NOTE = ['E', 'A', 'D', 'G', 'B', 'E']; // last 'E' = high e

  // chord token regex
  const CHORD_TOKEN_RE = /^[A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add\d+|\d+)*(?:\/[A-G][#b]?)?$/;
  const CHORD_GLOBAL_RE = /\b([A-G][#b]?(?:m|maj|min|dim|aug|sus[24]?|add\d+|\d+)*(?:\/[A-G][#b]?)?)\b/g;

  function isChordToken(tok) { return CHORD_TOKEN_RE.test(tok); }

  function isChordLine(line) {
    const trimmed = line.trim();
    if (!trimmed) return false;

    const tokens = trimmed.split(/\s+/);
    if (tokens.length === 0) return false;

    return tokens.every(tok => isChordToken(tok));
  }

  function isTabLine(line) {
    return /^\s*[eEBGDAd]\|/.test(line);
  }

  // transposition
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

  // chord diagram rendering on guitar
  function renderDiagram(chordName, fretsLowToHigh, barre = null) {
    const frets = fretsLowToHigh.slice();
    const displayFrets = frets.slice().reverse();
    const stringNames = STRING_NAMES_HIGH_TO_LOW;

    const positiveFrets = displayFrets.filter(f => f > 0);
    const minFret = positiveFrets.length ? Math.min(...positiveFrets) : 1;
    const maxFret = positiveFrets.length ? Math.max(...positiveFrets) : 1;
    const startFret = (minFret > 4 || maxFret > 4) ? minFret : 1;
    const rows = 4;
    const strings = 6;

    const lines = [];
    lines.push(chordName);
    if (startFret > 1) lines.push(`${startFret}fr`);

    // top status line
    const top = displayFrets.map(f => f === -1 ? 'x' : f === 0 ? 'o' : ' ').join(' ');
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

  // chord notes
  function chordNotes(chordName, fretsLowToHigh) {
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

    const seen = new Set();
    return out.filter(n => seen.has(n) ? false : (seen.add(n), true));
  }

  // library lookup (cached)
  let _chordLibrary = null;
  let _chordIndex   = null;
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
