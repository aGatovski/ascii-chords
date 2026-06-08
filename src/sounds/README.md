# Audio samples — credits

This folder holds string samples for the playback engine, organised by
instrument under per-instrument subdirectories:

```
sounds/
├── acoustic/         # default — FluidR3_GM steel-string acoustic
│   └── E2.mp3 A2.mp3 D3.mp3 G3.mp3 B3.mp3 E4.mp3
├── acoustic-tonejs/  # alternative acoustic — tonejs-instruments
│   └── E2.mp3 A2.mp3 D3.mp3 G3.mp3 B3.mp3 E4.mp3
└── electric/         # electric — pitches don't all match standard tuning;
    └── E2.mp3 A2.mp3 Ds3.mp3 Fs3.mp3 C4.mp3 Ds4.mp3
```

`player.js` loads the samples for the active instrument at first user
interaction, then plays a fretted note by selecting the right string and
shifting it via `playbackRate` (`2^(fret/12)`). Each instrument has a
`SAMPLE_FILES` entry in `player.js` that maps each string letter to its
filename and an optional `pitchOffset` (in semitones) — used by the
electric pack to correct sample pitches that aren't on the open-string
target. If a folder is missing or its files fail to decode, the player
falls back to sawtooth synthesis (the **Synth** option in the instrument
picker).

## Acoustic samples — credits

The 6 acoustic samples in `acoustic/` are extracted from the
**FluidR3_GM SoundFont** (`acoustic_guitar_steel`, GM patch 25), as packaged
by [`gleitz/midi-js-soundfonts`](https://github.com/gleitz/midi-js-soundfonts).

- File mapping: `E2.mp3, A2.mp3, D3.mp3, G3.mp3, B3.mp3, E4.mp3` — pitches
  match the standard-tuning open strings exactly (no `pitchOffset` needed).
- Source: <https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_guitar_steel-mp3/>
- Licence: **MIT** (see the upstream repo)

## Acoustic (Tone.js) samples — credits

The 6 samples in `acoustic-tonejs/` come from
[`nbrosowsky/tonejs-instruments`](https://github.com/nbrosowsky/tonejs-instruments)
(`samples/guitar-acoustic`). This pack ships every standard-tuning open-string
pitch, so the filenames match 1:1 and no `pitchOffset` correction is needed.

- File mapping: `E2.mp3, A2.mp3, D3.mp3, G3.mp3, B3.mp3, E4.mp3` — exact pitches.
- Source: <https://github.com/nbrosowsky/tonejs-instruments/tree/master/samples/guitar-acoustic>
- Licence: **MIT** (see the upstream repo)

## Electric samples — credits

The 6 electric samples in `electric/` come from
[`nbrosowsky/tonejs-instruments`](https://github.com/nbrosowsky/tonejs-instruments)
(`samples/guitar-electric`). The repo doesn't ship pitches on every open
string, so the player uses the closest available pitch and applies a
per-string `pitchOffset` (in semitones) to correct via `playbackRate`:

| String | Target | File used | pitchOffset |
|--------|--------|-----------|-------------|
| 6 (low E) | E2  | `E2.mp3`  |  0 |
| 5 (A)     | A2  | `A2.mp3`  |  0 |
| 4 (D)     | D3  | `Ds3.mp3` | −1 |
| 3 (G)     | G3  | `Fs3.mp3` | +1 |
| 2 (B)     | B3  | `C4.mp3`  | −1 |
| 1 (high e)| E4  | `Ds4.mp3` | +1 |

- Source: <https://github.com/nbrosowsky/tonejs-instruments/tree/master/samples/guitar-electric>
- Licence: **MIT** (see the upstream repo)
