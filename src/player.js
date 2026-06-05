/* ============================================================
   player.js — Web Audio API playback engine
   ============================================================ */

window.Player = (function () {
  'use strict';

  const STRING_OPEN_FREQ = {
    e: 329.63, B: 246.94, G: 196.00, D: 146.83, A: 110.00, E: 82.41,
  };

  let ctx = null;
  let bpm = 120;
  let metronomeOn = false;
  let scheduled = [];      // array of {oscNode, gainNode, stopTime}
  let isPlaying = false;
  let isPaused = false;
  let pauseAtTime = 0;
  let activeBeatTimer = null;
  let activeBlockEl = null;

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

  function pluckNote(audioCtx, frequency, startTime, duration = 0.4, gain = 0.18) {
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
    scheduled.push({ osc, gain: g, stopTime: startTime + duration });
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
  }

  // -------- Schedule a song --------
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
      // Detect tab block
      if (/^\s*[eEBGDAd]\|/.test(line)) {
        const block = [line];
        while (i + 1 < lines.length && /^\s*[eEBGDAd]\|/.test(lines[i + 1])) {
          block.push(lines[++i]);
        }
        cursor = scheduleTabBlock(audioCtx, block, beatInterval, cursor);
      } else if (line.trim() === '') {
        // Blank line = small gap
        cursor += beatInterval * 0.5;
      } else if (/^\[.+\]$/.test(line.trim())) {
        cursor += beatInterval * 0.5;
      } else if (window.Chords && window.Chords.isChordLine(line)) {
        cursor = scheduleChordLine(audioCtx, line, beatInterval, cursor);
        // Skip the paired lyric line (no audio)
        if (i + 1 < lines.length && lines[i + 1].trim() !== ''
            && !window.Chords.isChordLine(lines[i + 1])
            && !/^\s*[eEBGDAd]\|/.test(lines[i + 1])
            && !/^\[.+\]$/.test(lines[i + 1].trim())) {
          i++;
        }
      } else {
        // Plain lyric line — small advance
        cursor += beatInterval;
      }
      i++;
    }
    return cursor - startAt;
  }

  function scheduleTabBlock(audioCtx, blockLines, beatInterval, startTime) {
    // Strip the leading "X|" from each line so columns align
    const stringLetters = blockLines.map(l => l.match(/^\s*([eEBGDAd])\|/)?.[1] || 'e');
    const bodies = blockLines.map(l => l.replace(/^\s*[eEBGDAd]\|/, ''));
    const maxLen = Math.max(...bodies.map(b => b.length));

    let time = startTime;
    let col = 0;
    while (col < maxLen) {
      let played = false;
      for (let s = 0; s < bodies.length; s++) {
        const body = bodies[s];
        if (col >= body.length) continue;
        // Read a possibly multi-digit fret number starting at col
        let m = body.substring(col).match(/^(\d{1,2})/);
        if (m) {
          const fret = parseInt(m[1], 10);
          const string = stringLetters[s].toLowerCase() === 'e' ?
                          (s === 0 ? 'e' : 'E') : stringLetters[s];
          const freq = noteFrequency(string, fret);
          if (freq) {
            pluckNote(audioCtx, freq, time + s * 0.004);
            played = true;
          }
        }
      }
      // Advance one column (one character). To make tab playback feel natural,
      // each "-" or note column is one sub-beat.
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
    // Each chord token plays as a strum at successive beats
    if (!window.Chords) return startTime + beatInterval;
    let time = startTime;
    const tokens = chordsLine.trim().split(/\s+/);
    for (const tok of tokens) {
      if (!window.Chords.isChordToken(tok)) continue;
      const def = window.Chords.getDefault(tok);
      if (def && def.frets) {
        // Strum from low E (index 0) to high e (index 5)
        for (let s = 0; s < 6; s++) {
          const fret = def.frets[s];
          if (fret < 0) continue;
          const stringName = ['E', 'A', 'D', 'G', 'B', 'e'][s];
          const freq = noteFrequency(stringName, fret);
          if (freq) {
            pluckNote(audioCtx, freq, time + s * 0.008, 0.5, 0.13);
          }
        }
      }
      if (metronomeOn) metronomeTick(audioCtx, time, false);
      time += beatInterval;
    }
    return time;
  }

  // -------- Beat highlighting (best-effort visual sync) --------
  function startBeatHighlight(durationSeconds) {
    stopBeatHighlight();
    const preview = document.getElementById('preview');
    if (!preview) return;
    // Simple visual: pulse the active section based on BPM
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

  // -------- Public --------
  function play(text, songBpm) {
    stop();
    isPlaying = true; isPaused = false;
    const duration = scheduleSong(text, songBpm);
    startBeatHighlight(duration);
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
      try { s.osc.stop(); } catch (e) {}
    }
    scheduled = [];
    if (ctx && ctx.state !== 'closed') ctx.resume();
    stopBeatHighlight();
  }

  function setBpm(v)        { bpm = v; }
  function setMetronome(on) { metronomeOn = !!on; }

  return { play, pause, stop, setBpm, setMetronome };
})();
