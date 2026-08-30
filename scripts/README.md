# scripts/

Offline build tools. Nothing in here ships to the browser — these run on a laptop and
commit their output.

## `build-samples.ts` — the sampled viola

Builds `public/samples/viola-v1/`: 46 short mono AAC clips, one per semitone from **C3
(MIDI 48) to A6 (MIDI 93)**, plus a `manifest.json` the sampler in `src/audio/` reads.

The ceiling is A6 because three-octave scales are the audition material this app exists to
drill, and from an A root a three-octave scale ends on A6. That happens to be exactly where
the Iowa A-string archive stops, so the app's range and the available recordings agree.

### What it does

1. **Downloads** the four University of Iowa arco viola archives (`sulC`, `sulG`, `sulD`,
   `sulA`) into `samples-src/`, which is gitignored — the ~82 MB of source AIFF is an input,
   not an artifact. A cached archive whose size already matches is not re-fetched, so a
   re-run costs seconds rather than minutes. A string that fails to download is reported and
   skipped; the other three still build.
2. **Extracts** and indexes every recording by string and pitch.
3. **Picks one recording per note.** Several strings cover the same pitches, so the rule is:
   the highest string whose open pitch is at or below the note. That is where a player most
   often is, and it makes the boundaries fall exactly on the open strings.

   | notes | from |
   | --- | --- |
   | C3–F♯3 (48–54) | `sulC` |
   | G3–B3 (55–61) | `sulG` |
   | D4–G♯4 (62–68) | `sulD` |
   | A4–A6 (69–93) | `sulA` |

   `STRING_OVERRIDES` in the script is a per-note escape hatch, so reassigning one awkward
   note is a data change rather than a change to the rule.
4. **Converts** each recording with ffmpeg: downmix to mono, trim the leading silence
   (keeping 20 ms ahead of the attack, so the bow transient survives), cap at 2.5 s, fade out
   over the last 120 ms so a truncated note does not click, normalise, and encode to AAC in
   `.m4a` at 64 kbps mono.
5. **Writes `manifest.json`** and prints a summary: notes produced, total bytes, missing
   pitches.

### Two decisions worth not reversing

**AAC, not Opus.** iOS is the primary target and Safari's `decodeAudioData` handling of Ogg
Opus is unreliable; AAC is the one codec every WebKit build decodes. `--opus` will emit Opus
alongside as a progressive enhancement, but `.m4a` must always exist and the sampler must
always be able to fall back to it.

**Loudness normalisation, not peak.** Each note gets one measured constant gain, chosen to
put it at −18 LUFS integrated, then clamped so its true peak stays under −1 dBTP. Peak
normalisation equalises the wrong thing: the Iowa notes were recorded across several sessions
and their peaks do not track how loud they sound, so a peak-matched chromatic scale still
lurches. `loudnorm` was rejected because in its single-pass form it is a dynamic processor —
it compresses, and on a bowed note with a slow swell that audibly flattens the attack. Every
note gets the identical treatment, so nothing is relatively coloured. Measured output lands
at −18.0 LUFS ±0.1 across all 46.

### Filenames

Lowercase ASCII, with the accidental spelled out: `c3.m4a`, `csharp3.m4a`, `a6.m4a`. A
literal `#` is a URL fragment delimiter and would need escaping in every fetch. The note
names in the manifest are MIDI labels using sharps, not musical spellings — the app spells
notes in key context through `src/core/pitch`. (The source recordings are named with flats;
the script handles both.)

### Running it

```sh
bun run scripts/build-samples.ts            # download if needed, convert everything
bun run scripts/build-samples.ts --check    # report what exists, touch the network never
bun run scripts/build-samples.ts --force    # re-convert even where outputs exist
bun run scripts/build-samples.ts --opus     # additionally emit .opus
```

Needs `ffmpeg`, `ffprobe` and `unzip` on `PATH`. A cold run is a few minutes, almost all of
it download; a warm re-run is about a minute; `--check` is instant.

This is a one-time build. You only need to re-run it if the range changes, the encoding
settings change, or the string-selection table changes — and then you commit the new
`public/samples/viola-v1/`.

### Committed output

**971 KiB total** — 988 KB of audio across 46 `.m4a` files (about 21 kB each) plus a 6 KB
manifest. Comfortably inside the budget for a PWA that precaches the whole set.

`manifest.json` records `maxShiftSemitones: 0`: the set is fully chromatic, every note the
app can ask for has its own recording, so the sampler never transposes and the whole class of
pitch-shift artefacts does not arise. `coreZones` lists the four open strings (48, 55, 62,
69) so the loader can start playback before the rest of the set has arrived.

### Licence

The University of Iowa Electronic Music Studios set carries an explicit unrestricted grant on
<https://theremin.music.uiowa.edu/MIS.html>: *"freely available on this website and may be
downloaded and used for any projects, without restrictions."* No attribution is demanded. We
give it anyway — in the root `README.md`, and in the `license` and `sourceUrl` fields of the
manifest, so the provenance travels with the files.

### Notes on the source data

- The archives contain **`.aif`**, not `.aiff`, and ship a `__MACOSX/._*` resource fork
  beside every file. Both matter to the extraction step.
- Pitches are named with **flats** (`Ab4`, `Bb4`, `Db5`), not sharps.
- **`ff` only.** There is no quiet layer in this set, so the sampler cannot do velocity
  layers — dynamics have to come from gain and filtering.
- These are real performances, and the intonation is human. A spectral check of the built set
  puts every note within 24 cents of equal temperament, but the error is not uniform: open
  strings and their octaves land within about 2 cents, while some stopped notes (D♯5, F♯5, E3)
  sit 18–23 cents flat. That is the recording, not the pipeline. Since `maxShiftSemitones` is
  0, the app inherits the source intonation exactly as recorded.
