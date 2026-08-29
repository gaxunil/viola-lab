/**
 * The single translation point between the transport and SolidJS.
 *
 * Everything below this file is framework-free: the transport is a plain object
 * driven by an audio clock, and it has never heard of a signal. Everything above
 * it is a component that renders a value and owns no timing logic at all. That
 * split is only worth anything if there is exactly one place where the two meet,
 * and this is it.
 *
 * Two decisions carry the file.
 *
 * Position is PULLED, once per animation frame, never pushed. The scheduler runs
 * up to 100ms ahead of the sound, so a per-beat callback from it would light the
 * beat indicator before the click was audible — a metronome that is visibly
 * early is worse than no metronome. `positionNow()` reports where the music has
 * been HEARD, latency compensated, so sampling it on a frame is both honest and
 * naturally aligned with when the browser is going to paint.
 *
 * Lifecycle is PUSHED, because state changes are rare, not time-critical, and
 * polling for them would mean the frame loop had to keep running to notice that
 * it should stop.
 *
 * The memos are the other half of the bargain. Sampling at 60Hz produces sixty
 * new position objects a second; collapsing them to integers means a 90bpm
 * metronome causes about one and a half DOM updates a second instead of sixty.
 * Only `position` itself opts out, for animation that genuinely wants sub-beat
 * resolution.
 */

import { type Accessor, createMemo, createSignal, getOwner, onCleanup } from 'solid-js'
import type { Transport, TransportPosition, TransportState } from '@audio/transport'
import type { AccentLevel } from '@core/rhythm/meter'
import { type FrameScheduler, createAnimationFrameScheduler } from './frameScheduler'

export interface TransportStateOptions {
  /** Defaults to a `requestAnimationFrame` scheduler. Injected in tests. */
  readonly frames?: FrameScheduler
}

export interface TransportSignals {
  readonly state: Accessor<TransportState>
  readonly isPlaying: Accessor<boolean>
  /** Felt beat within the bar, 0-based. -1 when nothing is playing. */
  readonly beat: Accessor<number>
  /** 0-based, negative during a count-in, -1 when nothing is playing. */
  readonly bar: Accessor<number>
  readonly accent: Accessor<AccentLevel>
  readonly noteIndex: Accessor<number | null>
  readonly isCountIn: Accessor<boolean>
  /** The raw sample, updated every frame, for sub-beat animation. */
  readonly position: Accessor<TransportPosition | null>
  readonly dispose: () => void
}

/** The states in which the music is moving and the frame loop has work to do. */
function isActive(state: TransportState): boolean {
  return state === 'running' || state === 'countIn'
}

export function createTransportState(
  transport: Transport,
  options?: TransportStateOptions,
): TransportSignals {
  const frames = options?.frames ?? createAnimationFrameScheduler()

  const [state, setState] = createSignal<TransportState>(transport.state)

  // `equals: false` because two samples 16ms apart are usually deeply equal in
  // everything but `contextTime`, and an animation reading this one wants every
  // frame regardless. The memos below are what protect the rest of the UI.
  const [position, setPosition] = createSignal<TransportPosition | null>(null, {
    equals: false,
  })

  const sample = (): void => {
    setPosition(transport.positionNow())
  }

  /**
   * Run the frame loop only while the music is moving. She leaves this open on a
   * phone through a whole practice session; a rAF loop spinning through every
   * pause would cost her battery for nothing.
   */
  const syncFrames = (next: TransportState): void => {
    if (isActive(next)) {
      frames.start(sample)
      // Sample immediately so the first beat lands with the first click rather
      // than one frame later.
      sample()
      return
    }
    frames.stop()
    // One last pull, which returns null now that the transport is inactive, so
    // the indicator clears instead of freezing on its final beat.
    sample()
  }

  const unsubscribeState = transport.onStateChange((next) => {
    setState(next)
    syncFrames(next)
  })

  // The transport does raise a state change when a score ends, so this is belt
  // and braces — but a stuck frame loop is expensive enough to be worth both.
  const unsubscribeComplete = transport.onComplete(() => {
    syncFrames(transport.state)
  })

  // A transport that was already playing when this was created still needs its
  // loop started.
  if (isActive(transport.state)) syncFrames(transport.state)

  const dispose = (): void => {
    unsubscribeState()
    unsubscribeComplete()
    frames.stop()
    setPosition(null)
  }

  // Inside a component this is the whole story. Outside a root — a store built
  // at module scope, or a test — there is no owner to hang cleanup on, so the
  // returned `dispose` is the only handle and calling `onCleanup` would only
  // register a function that never runs.
  if (getOwner() !== null) onCleanup(dispose)

  return {
    state,
    isPlaying: createMemo(() => isActive(state())),
    beat: createMemo(() => position()?.beatInBar ?? -1),
    bar: createMemo(() => position()?.bar ?? -1),
    accent: createMemo<AccentLevel>(() => position()?.accent ?? 'weak'),
    noteIndex: createMemo(() => position()?.eventIndex ?? null),
    isCountIn: createMemo(() => position()?.isCountIn ?? false),
    position,
    dispose,
  }
}
