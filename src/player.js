/* ============================================================
   player.js — Web Audio playback engine

   Sample-first: per-instrument folders under /sounds/<instrument>/
   each contain 6 open-string recordings (E2, A2, D3, G3, B3, E4).
   Switching instruments lazy-loads its sample pack on first use.
   Fretted notes are played by pitch-shifting the matching sample
   via AudioBufferSourceNode.playbackRate = 2^(fret/12).

   Two scheduling paths:
   - Tab blocks: each column → an instant in time (precise).
   - Chord lines: each token → one beat, played as a downstrum
     across the strings using the chord library's first variant.
     Unknown chord names are skipped silently.

   The "Synth" instrument bypasses samples entirely and uses the
   sawtooth pluck path — also acts as fallback when an instrument's
   samples fail to load.
   ============================================================ */

window.Player = (function () {
  'use strict';

  // Strings indexed low-to-high (E A D G B e) so it matches the chord
  // library convention. STRING_OPEN_FREQ is keyed by the *display*
  // letter (e/B/G/D/A/E) — used by both the synth fallback and the
  // sample picker (we map letters → buffer index below).
  const STRING_OPEN_FREQ = {
    E: 82.41, A: 110.00, D: 146.83, G: 196.00, B: 246.94, e: 329.63,
  };
  // Order matches the sample files E2..E4 (low to high)
  const SAMPLE_ORDER = ['E', 'A', 'D', 'G', 'B', 'e'];
  // Default filename per string letter — used when an instrument's
  // SAMPLE_FILES map doesn't override it. The acoustic pack's filenames
  // match the open-string pitches exactly, so no override is needed.
  const SAMPLE_FILENAMES_DEFAULT = {
    E: 'E2.mp3', A: 'A2.mp3', D: 'D3.mp3',
    G: 'G3.mp3', B: 'B3.mp3', e: 'E4.mp3',
  };
  // Per-instrument filename + pitch-correction overrides. The electric pack
  // (tonejs-instruments) ships pitches that don't all match standard tuning
  // open strings — we re-use the closest available file per string and apply
  // a semitone correction so playbackRate lands on the true open pitch.
  // pitchOffset is in semitones: positive = sample is BELOW target, so play
  // it back faster; negative = sample is ABOVE target, slow it down.
  const SAMPLE_FILES = {
    acoustic: {
      E: { file: 'E2.mp3', pitchOffset: 0 },
      A: { file: 'A2.mp3', pitchOffset: 0 },
      D: { file: 'D3.mp3', pitchOffset: 0 },
      G: { file: 'G3.mp3', pitchOffset: 0 },
      B: { file: 'B3.mp3', pitchOffset: 0 },
      e: { file: 'E4.mp3', pitchOffset: 0 },
    },
    'acoustic-tonejs': {
      E: { file: 'E2.mp3', pitchOffset: 0 },
      A: { file: 'A2.mp3', pitchOffset: 0 },
      D: { file: 'D3.mp3', pitchOffset: 0 },
      G: { file: 'G3.mp3', pitchOffset: 0 },
      B: { file: 'B3.mp3', pitchOffset: 0 },
      e: { file: 'E4.mp3', pitchOffset: 0 },
    },
    electric: {
      E: { file: 'E2.mp3',  pitchOffset:  0 },  // E2 — exact
      A: { file: 'A2.mp3',  pitchOffset:  0 },  // A2 — exact
      D: { file: 'Ds3.mp3', pitchOffset: -1 },  // D3 from D♯3 (sample 1 ST high)
      G: { file: 'Fs3.mp3', pitchOffset:  1 },  // G3 from F♯3 (sample 1 ST low)
      B: { file: 'C4.mp3',  pitchOffset: -1 },  // B3 from C4  (sample 1 ST high)
      e: { file: 'Ds4.mp3', pitchOffset:  1 },  // E4 from D♯4 (sample 1 ST low)
    },
  };
  // Instrument name → folder under /sounds/. "synth" is special: no folder,
  // always falls through to the sawtooth oscillator.
  const INSTRUMENT_FOLDERS = {
    acoustic: 'sounds/acoustic',
    'acoustic-tonejs': 'sounds/acoustic-tonejs',
    electric: 'sounds/electric',
  };
  const DEFAULT_INSTRUMENT = 'acoustic';

  // Tuning presets — semitone offsets per string in SAMPLE_ORDER (low-to-high
  // E A D G B e). 0 = standard; negative = flatten; positive = sharpen.
  // Applied additively to the fret number when synthesising/playing notes.
  const TUNING_PRESETS = {
    'Standard':       [ 0,  0,  0,  0,  0,  0],
    'Drop D':         [-2,  0,  0,  0,  0,  0],
    'Open G':         [-2, -2,  0,  0,  0, -2],
    'Open D':         [-2,  0,  0, -1, -2, -2],
    'DADGAD':         [-2,  0,  0,  0, -2, -2],
    'Half-Step Down': [-1, -1, -1, -1, -1, -1],
  };
  // Resolves a tuning name to its offset vector, falling back to Standard.
  function tuningOffsets(name) {
    return TUNING_PRESETS[name] || TUNING_PRESETS['Standard'];
  }
  // Converts a string letter (E/A/D/G/B/e) into its index in SAMPLE_ORDER.
  function stringIndex(letter) {
    const idx = SAMPLE_ORDER.indexOf(letter);
    return idx >= 0 ? idx : 0;
  }

  let ctx = null;
  let bpm = 120;
  let metronomeOn = false;
  let scheduled = [];
  let isPlaying = false;
  let isPaused = false;
  let activeBeatTimer = null;
  let playbackEndTimer = null;
  let currentTuning = 'Standard';
  let currentInstrument = DEFAULT_INSTRUMENT;
  let playbackMode = 'all';

  const INSTRUMENT_LABELS = {
    synth: 'Synth',
    acoustic: 'Acoustic',
    'acoustic-tonejs': 'Acoustic (Tone.js)',
    electric: 'Electric',
  };

  // ---- Sample cache ------------------------------------------------------
  // bufferPacks[instrument] = { buffers: { stringLetter: AudioBuffer|null },
  //                              loadingPromise, ready }
  // "synth" is never cached; it falls straight through to pluckSynth.
  const bufferPacks = {};

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noteFrequency(stringName, fret) {
    const open = STRING_OPEN_FREQ[stringName];
    if (open == null || fret < 0) return null;
    const offset = tuningOffsets(currentTuning)[stringIndex(stringName)];
    return open * Math.pow(2, (fret + offset) / 12);
  }

  // ---- Sample loading ----------------------------------------------------
  // Loads the 6 sample files for `instrument` (one network round-trip per
  // string, in parallel). Re-entrant: a second call while the first is in
  // flight returns the same promise.
  function emitStatus(detail) {
    window.dispatchEvent(new CustomEvent('player:status', {
      detail: Object.assign({
        instrument: currentInstrument,
        label: INSTRUMENT_LABELS[currentInstrument] || currentInstrument,
        mode: playbackMode,
      }, detail || {}),
    }));
  }

  async function loadSamples(instrument) {
    instrument = instrument || currentInstrument;
    if (instrument === 'synth') {
      emitStatus({ state: 'ready', message: 'Synth ready' });
      return null;
    }
    if (!INSTRUMENT_FOLDERS[instrument]) return null;

    if (!bufferPacks[instrument]) {
      bufferPacks[instrument] = { buffers: {}, loadingPromise: null, ready: false, failed: 0 };
    }
    const pack = bufferPacks[instrument];
    if (pack.ready) {
      emitStatus({
        state: pack.failed ? 'partial' : 'ready',
        message: pack.failed ? `${INSTRUMENT_LABELS[instrument] || instrument}: partial samples` : `${INSTRUMENT_LABELS[instrument] || instrument} loaded`,
      });
      return pack;
    }
    if (pack.loadingPromise) return pack.loadingPromise;

    const audioCtx = getCtx();
    const folder = INSTRUMENT_FOLDERS[instrument];
    const filesMap = SAMPLE_FILES[instrument] || {};
    emitStatus({ state: 'loading', message: `Loading ${INSTRUMENT_LABELS[instrument] || instrument} samples` });
    pack.loadingPromise = (async () => {
      const tasks = SAMPLE_ORDER.map(async (letter) => {
        const entry = filesMap[letter] || { file: SAMPLE_FILENAMES_DEFAULT[letter], pitchOffset: 0 };
        try {
          const r = await fetch(folder + '/' + entry.file);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const arr = await r.arrayBuffer();
          const buf = await new Promise((resolve, reject) =>
            audioCtx.decodeAudioData(arr.slice(0), resolve, reject)
          );
          pack.buffers[letter] = buf;
        } catch (e) {
          console.warn('[player]', instrument, 'sample failed for', letter, e.message);
          pack.buffers[letter] = null;
        }
      });
      await Promise.all(tasks);
      pack.ready = SAMPLE_ORDER.some(l => pack.buffers[l]);
      pack.failed = SAMPLE_ORDER.filter(l => !pack.buffers[l]).length;
      emitStatus({
        state: pack.ready ? (pack.failed ? 'partial' : 'ready') : 'fallback',
        message: pack.ready
          ? (pack.failed ? `${INSTRUMENT_LABELS[instrument] || instrument}: ${6 - pack.failed}/6 samples loaded` : `${INSTRUMENT_LABELS[instrument] || instrument} loaded`)
          : `${INSTRUMENT_LABELS[instrument] || instrument} unavailable; using Synth`,
      });
      return pack;
    })();
    return pack.loadingPromise;
  }

  // ---- Note playback -----------------------------------------------------
  // Plays one note at the given absolute audioContext time.
  // If a sample is loaded for the string, pitch-shifts it; otherwise
  // falls back to the synth pluck. The active tuning shifts the effective
  // semitone count so e.g. Drop D plays the low-E string a whole step lower.
  function playNote(audioCtx, stringName, fret, startTime, gain = 0.18) {
    const offset = tuningOffsets(currentTuning)[stringIndex(stringName)];
    const effectiveFret = fret + offset;
    const pack = currentInstrument !== 'synth' ? bufferPacks[currentInstrument] : null;
    const buf = pack && pack.ready ? pack.buffers[stringName] : null;
    if (buf) {
      // Some packs use a sample whose actual pitch differs from the target
      // open string (e.g. electric uses D♯3 in place of D3). pitchOffset is
      // added to the playbackRate exponent to compensate: positive = sample
      // is LOWER than target (speed up), negative = HIGHER (slow down).
      const filesMap = SAMPLE_FILES[currentInstrument] || {};
      const pitchOffset = (filesMap[stringName] && filesMap[stringName].pitchOffset) || 0;
      const src = audioCtx.createBufferSource();
      const g   = audioCtx.createGain();
      src.buffer = buf;
      src.playbackRate.value = Math.pow(2, (effectiveFret + pitchOffset) / 12);
      g.gain.setValueAtTime(gain, startTime);
      // Slight release so cutoff isn't abrupt when notes overlap
      g.gain.setValueAtTime(gain, startTime + 1.5);
      g.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.9);
      src.connect(g).connect(audioCtx.destination);
      src.start(startTime);
      src.stop(startTime + 2.0);
      scheduled.push({ node: src });
      return;
    }
    // Fallback: synth oscillator
    const freq = noteFrequency(stringName, fret);
    if (freq == null) return;
    pluckSynth(audioCtx, freq, startTime, 0.5, gain);
  }

  function pluckSynth(audioCtx, frequency, startTime, duration = 0.5, gain = 0.18) {
    const osc = audioCtx.createOscillator();
    const g   = audioCtx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(frequency, startTime);
    g.gain.setValueAtTime(0.0001, startTime);
    g.gain.exponentialRampToValueAtTime(gain, startTime + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, startTime + duration);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(startTime);
    osc.stop(startTime + duration + 0.05);
    scheduled.push({ node: osc });
  }

  function metronomeTick(audioCtx, time, accent = false) {
    const osc = audioCtx.createOscillator();
    const g = audioCtx.createGain();
    osc.type = 'square';
    osc.frequency.setValueAtTime(accent ? 1500 : 1000, time);
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(0.06, time + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.05);
    osc.connect(g).connect(audioCtx.destination);
    osc.start(time);
    osc.stop(time + 0.06);
    // Track the node so stop() and toggling the checkbox off can cancel
    // ticks that were already scheduled into the future.
    scheduled.push({ node: osc, kind: 'metronome' });
  }

  // ---- Song scheduling ---------------------------------------------------
  function scheduleSong(text, songBpm) {
    bpm = songBpm || bpm;
    const audioCtx = getCtx();
    const beatInterval = 60 / bpm;
    const startAt = audioCtx.currentTime + 0.1;
    let cursor = startAt;

    const lines = text.split('\n');
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^\s*[eEBGDAd]\|/.test(line)) {
        const block = [line];
        while (i + 1 < lines.length && /^\s*[eEBGDAd]\|/.test(lines[i + 1])) {
          block.push(lines[++i]);
        }
        if (playbackMode === 'all' || playbackMode === 'tabs') {
          cursor = scheduleTabBlock(audioCtx, block, beatInterval, cursor);
        } else {
          cursor += Math.max(1, Math.max(...block.map(l => l.length))) * beatInterval / 4;
        }
      } else if (line.trim() === '') {
        cursor += beatInterval * 0.5;
      } else if (/^\[.+\]$/.test(line.trim())) {
        cursor += beatInterval * 0.5;
      } else if (window.Chords && window.Chords.isChordLine(line)) {
        // Chord lines: schedule a downstrum per token, one beat each.
        // Unknown chord names (no shape in the library) advance the cursor
        // silently so the song's timing doesn't drift.
        if (playbackMode === 'all' || playbackMode === 'chords') {
          cursor = scheduleChordLine(audioCtx, line, beatInterval, cursor);
        } else {
          const tokens = line.match(window.Chords.CHORD_GLOBAL_RE) || [];
          cursor += Math.max(1, tokens.length) * beatInterval;
        }
      } else {
        // Lyric lines have no audio; skip a beat so structure is preserved.
        cursor += beatInterval;
      }
      i++;
    }
    return cursor - startAt;
  }

  // Schedules a strum for every chord token on a chord line. Each token
  // takes one beat. The downstrum spreads the 6 strings over ~72 ms so it
  // sounds like a strum, not a piano chord.
  function scheduleChordLine(audioCtx, line, beatInterval, startTime) {
    const tokens = line.match(window.Chords.CHORD_GLOBAL_RE) || [];
    let time = startTime;
    for (const tok of tokens) {
      scheduleChordStrum(audioCtx, tok, time);
      time += beatInterval;
    }
    if (metronomeOn && tokens.length > 0) {
      for (let b = 0; b < tokens.length; b++) {
        metronomeTick(audioCtx, startTime + b * beatInterval, b === 0);
      }
    }
    return time;
  }

  function scheduleChordStrum(audioCtx, chordName, time) {
    const def = window.Chords.getDefault(chordName);
    if (!def) return;                       // unknown shape — silent
    const frets = def.frets;                // low-to-high E A D G B e, -1 = mute
    const STRUM_STEP = 0.012;               // ~12ms between adjacent strings
    for (let i = 0; i < 6; i++) {
      const f = frets[i];
      if (f == null || f < 0) continue;
      // SAMPLE_ORDER is also low-to-high so indexing matches.
      playNote(audioCtx, SAMPLE_ORDER[i], f, time + i * STRUM_STEP, 0.15);
    }
  }

  function scheduleTabBlock(audioCtx, blockLines, beatInterval, startTime) {
    // Map prefixes like "e|" / "B|" to canonical letters used by samples.
    // Tab convention: top line = high e, bottom line = low E.
    const letters = blockLines.map(l => {
      const m = l.match(/^\s*([eEBGDAd])\|/);
      if (!m) return 'e';
      const ch = m[1];
      if (ch === 'e') return 'e';
      if (ch === 'd') return 'D';   // some tabs use lower-case d for the D string
      return ch;                     // E, B, G, D, A
    });
    const bodies = blockLines.map(l => l.replace(/^\s*[eEBGDAd]\|/, ''));
    const maxLen = Math.max(...bodies.map(b => b.length));

    let time = startTime;
    let col = 0;
    while (col < maxLen) {
      for (let s = 0; s < bodies.length; s++) {
        const body = bodies[s];
        if (col >= body.length) continue;
        const m = body.substring(col).match(/^(\d{1,2})/);
        if (m) {
          const fret = parseInt(m[1], 10);
          playNote(audioCtx, letters[s], fret, time, 0.2);
        }
      }
      col += 1;
      time += beatInterval / 4;
    }
    if (metronomeOn) {
      const beats = Math.max(1, Math.round((time - startTime) / beatInterval));
      for (let b = 0; b < beats; b++) {
        metronomeTick(audioCtx, startTime + b * beatInterval, b === 0);
      }
    }
    return time + beatInterval * 0.25;
  }

  // ---- Visual beat pulse -------------------------------------------------
  function startBeatHighlight() {
    stopBeatHighlight();
    const preview = document.getElementById('preview');
    if (!preview) return;
    const interval = 60 / bpm;
    let beat = 0;
    activeBeatTimer = setInterval(() => {
      preview.style.outline = beat % 2 === 0
        ? '1px solid var(--accent)'
        : '1px solid transparent';
      beat++;
    }, interval * 1000);
  }
  function stopBeatHighlight() {
    if (activeBeatTimer) clearInterval(activeBeatTimer);
    activeBeatTimer = null;
    const preview = document.getElementById('preview');
    if (preview) preview.style.outline = '';
  }

  function clearPlaybackEndTimer() {
    if (playbackEndTimer) clearTimeout(playbackEndTimer);
    playbackEndTimer = null;
  }

  function schedulePlaybackEnd(durationSeconds) {
    clearPlaybackEndTimer();
    const durationMs = Math.max(0, durationSeconds * 1000);
    playbackEndTimer = setTimeout(() => {
      playbackEndTimer = null;
      if (!isPlaying || isPaused) return;
      isPlaying = false;
      scheduled = [];
      stopBeatHighlight();
      emitStatus({ state: 'ended', message: 'Playback finished' });
    }, durationMs + 250);
  }

  // ---- Public API --------------------------------------------------------
  async function play(text, songBpm, songTuning) {
    stop();
    if (songTuning) currentTuning = songTuning;
    // Ensure samples are loaded before scheduling. The user gesture (Play
    // click) also unblocks the AudioContext, so this is the right moment.
    await loadSamples(currentInstrument);
    isPlaying = true; isPaused = false;
    emitStatus({ state: 'playing', message: `Playing ${INSTRUMENT_LABELS[currentInstrument] || currentInstrument}` });
    const duration = scheduleSong(text, songBpm);
    startBeatHighlight();
    schedulePlaybackEnd(duration);
  }

  function pause() {
    if (!isPlaying || isPaused) return;
    isPaused = true;
    clearPlaybackEndTimer();
    stopBeatHighlight();
    emitStatus({ state: 'paused', message: 'Playback paused' });
    if (ctx) ctx.suspend();
  }

  function stop() {
    isPlaying = false;
    isPaused = false;
    clearPlaybackEndTimer();
    for (const s of scheduled) {
      try { s.node.stop(); } catch (e) {}
    }
    scheduled = [];
    if (ctx && ctx.state !== 'closed') ctx.resume();
    stopBeatHighlight();
    emitStatus({ state: 'stopped', message: 'Playback stopped' });
  }

  function setBpm(v)        { bpm = v; }
  function setTuning(name)  { currentTuning = name || 'Standard'; }
  function setPlaybackMode(mode) {
    playbackMode = ['all', 'tabs', 'chords'].includes(mode) ? mode : 'all';
    emitStatus({ state: 'ready', message: `Mode: ${playbackMode}` });
  }
  function setInstrument(name) {
    currentInstrument = (name && (INSTRUMENT_FOLDERS[name] || name === 'synth'))
      ? name : DEFAULT_INSTRUMENT;
    emitStatus({ state: currentInstrument === 'synth' ? 'ready' : 'loading', message: `${INSTRUMENT_LABELS[currentInstrument] || currentInstrument} selected` });
    // Kick off a load now so the first Play press doesn't wait on the network.
    if (currentInstrument !== 'synth') loadSamples(currentInstrument);
  }
  function setMetronome(on) {
    metronomeOn = !!on;
    if (!metronomeOn) {
      // Cancel ticks already scheduled for the future
      for (const s of scheduled) {
        if (s.kind === 'metronome') {
          try { s.node.stop(); } catch (e) {}
        }
      }
      scheduled = scheduled.filter(s => s.kind !== 'metronome');
    }
  }

  return { play, pause, stop, setBpm, setTuning, setMetronome, setInstrument, setPlaybackMode, loadSamples };
})();
