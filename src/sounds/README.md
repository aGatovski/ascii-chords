# Audio samples — credits

This folder holds string samples for the playback engine, organised by
instrument under per-instrument subdirectories:

```
sounds/
├── acoustic/       # default — steel-string acoustic
│   ├── E2.mp3 A2.mp3 D3.mp3 G3.mp3 B3.mp3 E4.mp3
└── electric/       # populate with the 6 same-named files for electric
    └── (drop E2.mp3 A2.mp3 D3.mp3 G3.mp3 B3.mp3 E4.mp3 here)
```

`player.js` loads the samples for the active instrument at first user
interaction, then plays a fretted note by selecting the right string and
shifting it via `playbackRate` (`2^(fret/12)`). If a folder is missing or
its files fail to decode, the player falls back to sawtooth synthesis
(the **Synth** option in the instrument picker).

Files in each instrument folder map 1:1 to the 6 open strings of standard
tuning (low → high):

| File   | String | Open pitch |
|--------|--------|------------|
| E2.mp3 | 6 (low E) | E2 (~82.41 Hz) |
| A2.mp3 | 5 (A)     | A2 (~110.00 Hz) |
| D3.mp3 | 4 (D)     | D3 (~146.83 Hz) |
| G3.mp3 | 3 (G)     | G3 (~196.00 Hz) |
| B3.mp3 | 2 (B)     | B3 (~246.94 Hz) |
| E4.mp3 | 1 (high e) | E4 (~329.63 Hz) |

## Acoustic samples — credits

The 6 acoustic samples in `acoustic/` are extracted from the
**FluidR3_GM SoundFont** (`acoustic_guitar_steel`, GM patch 25), as packaged
by [`gleitz/midi-js-soundfonts`](https://github.com/gleitz/midi-js-soundfonts).

- Source: <https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_guitar_steel-mp3/>
- Licence: **MIT** (see the upstream repo)

## Electric samples

`electric/` is empty by default. Drop in 6 same-named MP3s (E2, A2, D3, G3,
B3, E4) and the **Electric** option in the instrument picker will play
them. A clean source is the same midi-js-soundfonts repo, patch
`electric_guitar_clean` or `electric_guitar_jazz`.
