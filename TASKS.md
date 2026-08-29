# Viola Lab — build plan

Layering, which every task below respects: `components -> state -> audio -> core`.
`src/core/` stays pure TypeScript (no solid-js, no DOM, no Web Audio, no timers),
enforced by ESLint import rules and `tests/architecture.test.ts`.

## 1. Scaffold and pipeline — done

- [x] Repo, Vite + SolidJS + TS, bun, ESLint flat config with layer boundaries
- [x] Bun static server, Dockerfile, fly.toml, GitHub Actions deploy
- [x] First deploy proving the pipeline — https://viola-lab.fly.dev
- [x] Architecture purity guard test

## 2. Core domain layer

- [x] `math/rational.ts` — exact rationals, so bar validation is decidable
- [x] `ticks.ts` — PPQ 2520, throws rather than rounding
- [x] `pitch/pitch.ts` — the two axes (diatonic + chromatic)
- [x] `pitch/interval.ts` — the spelling engine
- [x] `key/key.ts` — circle of fifths, signatures, spelling in context
- [x] `scale/scaleTypes.ts` + `scale/scale.ts` — derived W/H patterns
- [x] `rhythm/duration.ts` — dots, tuplets, exact values
- [x] `rhythm/meter.ts` — compound and asymmetric meters, derived accents
- [x] `rhythm/bar.ts` — validation, tie resolution, beam groups
- [x] `viola/strings.ts`, `viola/fingerboard.ts` — position is diatonic
- [x] `viola/fingering.ts` — exact shortest path, carried position
- [x] `viola/scaleFingering.ts` — range feasibility (the B flat problem)
- [x] `tempo.ts` — quarter-note tempo, beat-unit conversion, rebase on change
- [x] `scripts/inspect.ts` — terminal inspector for reviewing by eye
- [x] `notation/staff.ts` — clef-relative staff steps, printed-accidental rules
- [x] `rhythm/presets.ts` — the preset rhythm library, incl. 12/8
- [x] `score.ts` — the `Score` / `MusicalEvent` contract with the audio layer
- [x] `compile/metronome.ts`, `compile/scale.ts`, `compile/rhythm.ts`
- [x] `scoring/tapScore.ts`, `scoring/calibration.ts` — pure, no timers
- [ ] `index.ts` — the barrel the UI imports

## 3. Timing engine — still silent, fully tested

- [x] `audio/clock.ts` — `AudioClock` / `Ticker` seams, worker-backed ticker
- [x] `audio/transport.ts` — lookahead scheduler over injected seams
- [x] Fakes: `FakeClock`, `ManualTicker`, `RecordingSink`
- [x] Scheduler tests: exact event times, no double-schedule, stop cancels
      the future, background stall does not machine-gun, loop wrap, tempo change

## 4. First sound

- [ ] `audio/context.ts` — single unlock owner, iOS gesture handling
- [ ] `audio/session.ts` — `navigator.audioSession`, silent-switch mitigation
- [ ] `audio/sink.ts` — cancellable per-run bus, limiter
- [ ] `audio/voices/synthVoice.ts` — bowed-ish fallback voice
- [ ] **Ship to her phone and verify the ring/silent switch** (highest risk)

## 5. Visual sync

- [ ] `state/useTransport.ts` — rAF pulling `positionNow()`, memos to integers
- [ ] Beat indicator component; verify the flash lands with the click

## 6. Sampled viola

- [ ] `scripts/build-samples.ts` — Iowa EMS 2012 arco, mono, trim, normalize, AAC
- [ ] `audio/loader.ts` — two-phase load, decode concurrency 3
- [ ] `audio/sampler.ts` — manifest-driven zones, bowed envelope
- [ ] Range C3-C6 (two-octave B flat reaches B flat 5)

## 7. Notation

- [ ] VexFlow via `vexflow/core`, dynamic Bravura load
- [ ] Alto clef staff; explicit beam `groups` from our meter, never the default

## 8. Fingerboard UI

- [ ] Diagram component, shift markers, position labels

## 9. Scales feature + drone

- [ ] Key/scale picker, W/H strip, playback with note highlighting
- [ ] `audio/drone.ts` — own bus, just-intonation fifth

## 10. Rhythm feature + tap scoring

- [ ] Preset browser, meter picker, playback
- [ ] `audio/latency.ts`, `audio/tapInput.ts`, calibration flow

## 11. Release

- [ ] Offline render tests (`*.render.test.ts`) as the pre-release gate
- [ ] PWA service worker, sample precache, install instructions (Safari on iOS)
