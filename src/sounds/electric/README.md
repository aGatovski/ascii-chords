# Electric guitar samples

This folder uses the Tone.js electric guitar pack. The available sample
pitches are not exactly the six standard-tuning open strings, so
`player.js` maps strings to the closest file and applies a pitch correction.

Expected files:

```text
E2.mp3
A2.mp3
Ds3.mp3
Fs3.mp3
C4.mp3
Ds4.mp3
```

Do not rename these to `D3.mp3`, `G3.mp3`, `B3.mp3`, or `E4.mp3`; the
player mapping handles the pitch conversion.
