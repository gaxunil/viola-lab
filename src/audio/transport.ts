/**
 * The scheduler.
 *
 * A timer wakes roughly every 25ms and schedules any event falling in the next
 * 100ms against the audio clock. Nothing is ever scheduled with `setTimeout`,
 * because its jitter is audible and disqualifying for a metronome.
 *
 * Two details carry most of the correctness:
 *
 * `t0` is captured once when playback starts and never re-derived, so errors
 * cannot accumulate. A loop advances it by exactly one loop length rather than
 * re-anchoring to the current time, which is why a metronome left running for
 * twenty minutes has not drifted.
 *
 * Nothing is ever scheduled in the past. After the tab is backgrounded and the
 * timer stalls, a naive scheduler discovers a whole missed window at once and
 * fires it as a burst. Past-due events are counted and dropped instead.
 *
 * `positionNow()` is a pure function of the clock and never consults the
 * scheduler's own state. It reports where the music has been HEARD, compensating
 * for output latency, which is what keeps a flashing beat indicator honest — the
 * scheduler runs up to 100ms ahead of the sound, so using its progress for
 * visuals would show the beat before you hear it.
 */

import type { AccentLevel } from '@core/rhythm/meter'
import type { MusicalEvent, Score } from '@core/score'
import { type TempoMap, rebaseTempo } from '@core/tempo'
import { beatAt } from '@core/rhythm/meter'
import { DEFAULT_LOOKAHEAD_SEC, type AudioClock, type Ticker } from './clock'
import type { EventSink } from './sink'

export type TransportState =
  | 'idle'
  | 'countIn'
  | 'running'
  | 'stopped'
  | 'finished'
  | 'interrupted'

export interface TransportPosition {
  readonly contextTime: number
  /** Fractional, and including any count-in. */
  readonly tick: number
  /** 0-based. Negative during a count-in. */
  readonly bar: number
  readonly pulseInBar: number
  /** 0-based felt beat: a dotted quarter in 12/8. */
  readonly beatInBar: number
  readonly accent: AccentLevel
  /** Index of the event currently sounding, for highlighting. */
  readonly eventIndex: number | null
  readonly isCountIn: boolean
  readonly loopIteration: number
}

export interface TransportDeps {
  readonly clock: AudioClock
  readonly ticker: Ticker
  readonly sink: EventSink
  readonly lookaheadSec?: number
  /** Headroom between `start()` and the first event. */
  readonly scheduleAheadSec?: number
  /** Subtracted when reporting position, so visuals match what is heard. */
  readonly visualLatencySec?: () => number
}

export interface Transport {
  load(score: Score, tempo: TempoMap): void
  setTempo(quarterBpm: number): void
  start(): void
  stop(fadeSec?: number): void
  positionNow(): TransportPosition | null
  onStateChange(cb: (state: TransportState) => void): () => void
  onComplete(cb: () => void): () => void
  readonly state: TransportState
  /** Events dropped because the timer stalled. Diagnostic. */
  readonly droppedCount: number
  dispose(): void
}

const DEFAULT_SCHEDULE_AHEAD_SEC = 0.02
const DEFAULT_STOP_FADE_SEC = 0.06

export function createTransport(deps: TransportDeps): Transport {
  const lookaheadSec = deps.lookaheadSec ?? DEFAULT_LOOKAHEAD_SEC
  const scheduleAheadSec = deps.scheduleAheadSec ?? DEFAULT_SCHEDULE_AHEAD_SEC
  const visualLatency = deps.visualLatencySec ?? (() => 0)

  let score: Score | null = null
  let tempo: TempoMap | null = null

  let state: TransportState = 'idle'
  let t0 = 0
  let nextIndex = 0
  let loopIteration = 0
  let dropped = 0
  let running = false

  const stateListeners = new Set<(s: TransportState) => void>()
  const completeListeners = new Set<() => void>()

  function setState(next: TransportState): void {
    if (state === next) return
    state = next
    for (const listener of stateListeners) listener(next)
  }

  /** The first event index at or after the loop start, cached per load. */
  let loopStartIndex = 0

  function loopDurationSec(): number {
    if (!score?.loop || !tempo) return 0
    return tempo.secondsAtTick(score.loop.endTick) - tempo.secondsAtTick(score.loop.startTick)
  }

  function scheduleWindow(): void {
    if (!score || !tempo || !running) return

    const now = deps.clock.currentTime
    const horizon = now + lookaheadSec

    for (;;) {
      if (nextIndex >= score.events.length) {
        if (score.loop) {
          // Advance by exactly one loop length rather than re-anchoring to the
          // clock, so a long loop does not accumulate error.
          t0 += loopDurationSec()
          nextIndex = loopStartIndex
          loopIteration += 1
          continue
        }
        const endsAt = t0 + tempo.secondsAtTick(score.lengthTicks)
        if (now >= endsAt) finish()
        return
      }

      const event = score.events[nextIndex]
      if (event === undefined) return

      const at = t0 + tempo.secondsAtTick(event.tick)
      if (at >= horizon) return

      if (at >= now) {
        deps.sink.scheduleEvent(event, at, tempo.secondsAtTick(event.durationTicks))
      } else {
        // The timer stalled — a backgrounded tab, or a suspended context. Drop
        // rather than firing the whole missed window at once.
        dropped += 1
      }
      nextIndex += 1
    }
  }

  function finish(): void {
    running = false
    deps.ticker.stop()
    setState('finished')
    for (const listener of completeListeners) listener()
  }

  function describe(tick: number, contextTime: number): TransportPosition {
    if (!score) throw new Error('describe called with no score')
    const meter = score.meter
    const isCountIn = tick < score.bodyStartTick

    const bodyTick = tick - score.bodyStartTick
    const bar = Math.floor(bodyTick / meter.barTicks)
    const tickInBar = bodyTick - bar * meter.barTicks
    const inBar = ((tickInBar % meter.barTicks) + meter.barTicks) % meter.barTicks

    const { beat } = beatAt(meter, inBar)

    return {
      contextTime,
      tick,
      bar,
      pulseInBar: Math.floor(inBar / meter.pulseTicks),
      beatInBar: beat,
      accent: meter.accents[beat] ?? 'weak',
      eventIndex: soundingIndex(tick),
      isCountIn,
      loopIteration,
    }
  }

  function soundingIndex(tick: number): number | null {
    if (!score) return null
    let found: MusicalEvent | null = null
    for (const event of score.events) {
      if (event.payload.type === 'cue') continue
      if (event.tick > tick) break
      if (tick < event.tick + event.durationTicks) found = event
    }
    return found ? found.id : null
  }

  return {
    get state() {
      return state
    },

    get droppedCount() {
      return dropped
    },

    load(nextScore, nextTempo) {
      score = nextScore
      tempo = nextTempo
      nextIndex = 0
      loopIteration = 0
      dropped = 0

      loopStartIndex = 0
      if (nextScore.loop) {
        const found = nextScore.events.findIndex((e) => e.tick >= nextScore.loop!.startTick)
        loopStartIndex = found === -1 ? 0 : found
      }
      setState('idle')
    },

    setTempo(quarterBpm) {
      if (!tempo) {
        return
      }
      if (!running) {
        tempo = rebaseTempo(tempo, 0, quarterBpm)
        return
      }
      // Anchor the change at the tick sounding right now, so already-scheduled
      // events keep their times and nothing lands in the past.
      const elapsed = deps.clock.currentTime - t0
      const currentTick = tempo.tickAtSeconds(elapsed)
      tempo = rebaseTempo(tempo, currentTick, quarterBpm)
    },

    start() {
      if (!score || !tempo || running) return

      running = true
      nextIndex = 0
      loopIteration = 0
      dropped = 0
      t0 = deps.clock.currentTime + scheduleAheadSec

      deps.sink.beginRun()
      setState(score.bodyStartTick > 0 ? 'countIn' : 'running')

      deps.ticker.start(() => {
        if (state === 'countIn' && score && tempo) {
          const elapsed = deps.clock.currentTime - t0
          if (tempo.tickAtSeconds(elapsed) >= score.bodyStartTick) setState('running')
        }
        scheduleWindow()
      })

      scheduleWindow()
    },

    stop(fadeSec = DEFAULT_STOP_FADE_SEC) {
      if (!running) return
      running = false
      deps.ticker.stop()
      deps.sink.allNotesOff(deps.clock.currentTime, fadeSec)
      setState('stopped')
    },

    positionNow() {
      if (!score || !tempo) return null
      if (state !== 'running' && state !== 'countIn') return null

      const contextTime = deps.clock.currentTime
      const heard = contextTime - visualLatency() - t0
      const tick = Math.max(0, tempo.tickAtSeconds(heard))
      return describe(tick, contextTime)
    },

    onStateChange(cb) {
      stateListeners.add(cb)
      return () => stateListeners.delete(cb)
    },

    onComplete(cb) {
      completeListeners.add(cb)
      return () => completeListeners.delete(cb)
    },

    dispose() {
      running = false
      deps.ticker.stop()
      stateListeners.clear()
      completeListeners.clear()
      score = null
      tempo = null
      setState('idle')
    },
  }
}
