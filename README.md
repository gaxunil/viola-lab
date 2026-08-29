# Viola Lab

A music-theory practice app for viola — rhythm and time signatures, keys and scales, and
where those scales actually lie on the fingerboard. Everything is in **alto clef**, with
viola string names (C–G–D–A, numbered I–IV from the top) and viola fingering (0–4, where
0 is an open string).

It assumes you can already play. It does not assume you know why E♭ major has three flats.

Companion to the [Music Theory for Engineers](https://gaxunil.github.io/music-theory/) deck.

## Install it on a phone

The app is a PWA and works fully offline once loaded.

> **On iOS, install from Safari, not Chrome.** Every iOS browser is WebKit underneath, but
> only Safari can install a web app to the Home Screen — Chrome's "Add to Home Screen" makes
> a bookmark, not an app. Open the site in Safari, then Share → Add to Home Screen.

If you hear nothing on an iPhone, check the **ring/silent switch**: iOS mutes Web Audio when
it is on. The app tries to opt out of that, but the switch can still win. There is a Sound
Check in the app that walks through it.

## Develop

```sh
bun install
bun run dev          # http://localhost:5173
```

```sh
bun run test         # unit + scheduler tests (node, fast)
bun run test:render  # OfflineAudioContext assertions (slower, pre-release gate)
bun run lint
bun run typecheck
bun run build        # -> dist/
bun run serve        # serve dist/ exactly as production does
```

## Architecture

The one rule this codebase is organised around: **musical logic never lives in a component.**

```
components  ->  state  ->  audio  ->  core
```

| Layer | Contains | May not import |
| --- | --- | --- |
| `src/core/` | Pitches, intervals, keys, scales, meters, rhythms, fingerings | `solid-js`, DOM, Web Audio, timers |
| `src/audio/` | Web Audio: sampler, scheduler, drone, latency | `solid-js` |
| `src/state/` | Solid adapters turning the audio engine into signals | components |
| `src/components/` | Rendering only | `@audio/*` |

`src/core/` is pure TypeScript. It unit-tests in a node environment with no jsdom and no
mocking, because every function in it is total and pure. That is what makes an audio app
testable: everything that could be *musically* wrong is in the tested half.

The boundaries are enforced twice — by `no-restricted-imports` rules in `eslint.config.js`,
and by `src/architecture.test.ts`, which also catches raw DOM and Web Audio use that no
import statement would reveal.

## Deploy

Push to `main`. CI lints, typechecks, tests, then deploys to fly.io.

```sh
flyctl status -a viola-lab
flyctl logs -a viola-lab
```

## Credits

Viola samples: [University of Iowa Electronic Music Studios](https://theremin.music.uiowa.edu/MIS.html),
recorded 2012 — freely available for any use. Notation rendering by
[VexFlow](https://github.com/vexflow/vexflow).
