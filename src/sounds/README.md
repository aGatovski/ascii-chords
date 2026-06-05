# Audio samples — credits

The 6 acoustic-guitar string samples in this folder are extracted from the
**FluidR3_GM SoundFont** (`acoustic_guitar_steel`, GM patch 25), as packaged by
[`gleitz/midi-js-soundfonts`](https://github.com/gleitz/midi-js-soundfonts).

- Source: <https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_guitar_steel-mp3/>
- Licence: **MIT** (see the upstream repo)

Files map 1:1 to the 6 open strings of standard tuning (low → high):

| File   | String | Open pitch |
|--------|--------|------------|
| E2.mp3 | 6 (low E) | E2 (~82.41 Hz) |
| A2.mp3 | 5 (A)     | A2 (~110.00 Hz) |
| D3.mp3 | 4 (D)     | D3 (~146.83 Hz) |
| G3.mp3 | 3 (G)     | G3 (~196.00 Hz) |
| B3.mp3 | 2 (B)     | B3 (~246.94 Hz) |
| E4.mp3 | 1 (high e) | E4 (~329.63 Hz) |

`player.js` loads these at first user interaction, then plays a fretted note by
selecting the right string sample and shifting it via `playbackRate`
(`2^(fret/12)`). If a file is missing or fails to decode, the player falls
back to the original sawtooth synthesis.
