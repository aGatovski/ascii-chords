/* ============================================================
   player.js — Web Audio playback engine

   Sample-first: loads 6 open-string acoustic guitar recordings
   from /sounds/{E2,A2,D3,G3,B3,E4}.mp3 on first user interaction,
   then plays fretted notes by pitch-shifting the matching sample
   via AudioBufferSourceNode.playbackRate = 2^(fret/12).

   Falls back to sawtooth synthesis if samples are unavailable.
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
  const SAMPLE_FILES = {
    E: 'sounds/E2.mp3',
    A: 'sounds/A2.mp3',
    D: 'sounds/D3.mp3',
    G: 'sounds/G3.mp3',
    B: 'sounds/B3.mp3',
    e: 'sounds/E4.mp3',
  };

  let ctx = null;
  let bpm = 120;
  let metronomeOn = false;
  let scheduled = [];
  let isPlaying = false;
  let isPaused = false;
  let activeBeatTimer = null;

  // ---- Sample cache ------------------------------------------------------
  // buffers[stringLetter] = AudioBuffer | null. Null = synth-only fallback.
  const buffers = {};
  let samplesLoadingPromise = null;
  let samplesReady = false;

  function getCtx() {
    if (!ctx) ctx = new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function noteFrequency(stringName, fret) {
    const open = STRING_OPEN_FREQ[stringName];
    if (open == null || fret < 0) return null;
    return open * Math.pow(2, fret / 12);
  }

  // ---- Sample loading ----------------------------------------------------
  async function loadSamples() {
    if (samplesReady) return;
    if (samplesLoadingPromise) return samplesLoadingPromise;

    const audioCtx = getCtx();
    samplesLoadingPromise = (async () => {
      const tasks = SAMPLE_ORDER.map(async (letter) => {
        try {
          const r = await fetch(SAMPLE_FILES[letter]);
          if (!r.ok) throw new Error('HTTP ' + r.status);
          const arr = await r.arrayBuffer();
          const buf = await new Promise((resolve, reject) =>
            audioCtx.decodeAudioData(arr.slice(0), resolve, reject)
          );
          buffers[letter] = buf;
        } catch (e) {
          console.warn('[player] sample load failed for', letter, e.message);
          buffers[letter] = null;
        }
      });
      await Promise.all(tasks);
      samplesReady = SAMPLE_ORDER.some(l => buffers[l]);
    })();
    return samplesLoadingPromise;
  }

  // ---- Note playback -----------------------------------------------------
  // Plays one note at the given absolute audioContext time.
  // If a sample is loaded for the string, pitch-shifts it; otherwise
  // falls back to the synth pluck.
  function playNote(audioCtx, stringName, fret, startTime, gain = 0.18) {
    const buf = buffers[stringName];
    if (buf) {
      const src = audioCtx.createBufferSource();
      const g   = audioCtx.createGain();
      src.buffer = buf;
      src.playbackRate.value = Math.pow(2, fret / 12);
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
        cursor = scheduleTabBlock(audioCtx, block, beatInterval, cursor);
      } else if (line.trim() === '') {
        cursor += beatInterval * 0.5;
      } else if (/^\[.+\]$/.test(line.trim())) {
        cursor += beatInterval * 0.5;
      } else if (window.Chords && window.Chords.isChordLine(line)) {
        cursor = scheduleChordLine(audioCtx, line, beatInterval, cursor);
        if (i + 1 < lines.length && lines[i + 1].trim() !== ''
            && !window.Chords.isChordLine(lines[i + 1])
            && !/^\s*[eEBGDAd]\|/.test(lines[i + 1])
            && !/^\[.+\]$/.test(lines[i + 1].trim())) {
          i++;
        }
      } else {
        cursor += beatInterval;
      }
      i++;
    }
    return cursor - startAt;
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
          playNote(audioCtx, letters[s], fret, time + s * 0.004, 0.2);
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

  function scheduleChordLine(audioCtx, chordsLine, beatInterval, startTime) {
    if (!window.Chords) return startTime + beatInterval;
    let time = startTime;
    const tokens = chordsLine.trim().split(/\s+/);
    for (const tok of tokens) {
      if (!window.Chords.isChordToken(tok)) continue;
      const def = window.Chords.getDefault(tok);
      if (def && def.frets) {
        // chord library frets stored low-to-high (E A D G B e)
        for (let s = 0; s < 6; s++) {
          const fret = def.frets[s];
          if (fret < 0) continue;
          const stringName = SAMPLE_ORDER[s];   // E,A,D,G,B,e
          // Strum: 8 ms between strings, low-to-high
          playNote(audioCtx, stringName, fret, time + s * 0.008, 0.15);
        }
      }
      if (metronomeOn) metronomeTick(audioCtx, time, false);
      time += beatInterval;
    }
    return time;
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

  // ---- Public API --------------------------------------------------------
  async function play(text, songBpm) {
    stop();
    // Ensure samples are loaded before scheduling. The user gesture (Play
    // click) also unblocks the AudioContext, so this is the right moment.
    await loadSamples();
    isPlaying = true; isPaused = false;
    scheduleSong(text, songBpm);
    startBeatHighlight();
  }

  function pause() {
    if (!isPlaying || isPaused) return;
    isPaused = true;
    if (ctx) ctx.suspend();
  }

  function stop() {
    isPlaying = false;
    isPaused = false;
    for (const s of scheduled) {
      try { s.node.stop(); } catch (e) {}
    }
    scheduled = [];
    if (ctx && ctx.state !== 'closed') ctx.resume();
    stopBeatHighlight();
  }

  function setBpm(v)        { bpm = v; }
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

  return { play, pause, stop, setBpm, setMetronome, loadSamples };
})();
