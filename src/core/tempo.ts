/**
 * Mapping musical time to wall-clock seconds.
 *
 * A tempo map is the only bridge between ticks (exact, integer, musical) and
 * seconds (floating point, physical). Keeping the conversion in one place means
 * the rest of core never touches a float, and the audio layer never does any
 * arithmetic beyond adding an offset to the clock.
 *
 * Tempo is stored in quarter notes per minute regardless of what the player sees,
 * because the notated beat changes with the meter. "90 bpm" in 12/8 means ninety
 * DOTTED quarters, which is 135 quarter notes per minute — get that conversion
 * wrong and a compound-meter metronome runs at two thirds speed.
 */

import { type Rational, rat, rdiv, toNumber } from './math/rational'
import { PPQ } from './ticks'
import { type Duration, durationValue } from './rhythm/duration'

export interface TempoMap {
  /** Seconds from the start of the transport to this tick. */
  secondsAtTick(tick: number): number
  /** The (fractional) tick sounding at this many seconds in. */
  tickAtSeconds(seconds: number): number
  readonly quarterBpm: number
}

export const MIN_BPM = 20
export const MAX_BPM = 300

function assertBpm(quarterBpm: number): void {
  if (!Number.isFinite(quarterBpm) || quarterBpm <= 0) {
    throw new RangeError(`tempo must be positive, got ${quarterBpm}`)
  }
}

/** A tempo that does not change. */
export function constantTempo(quarterBpm: number): TempoMap {
  assertBpm(quarterBpm)
  const secondsPerTick = 60 / quarterBpm / PPQ
  return {
    quarterBpm,
    secondsAtTick: (tick) => tick * secondsPerTick,
    tickAtSeconds: (seconds) => seconds / secondsPerTick,
  }
}

/**
 * Change tempo without time jumping.
 *
 * The new map is anchored so that it agrees with the old one at `atTick`. Without
 * this, dragging a tempo slider mid-playback makes already-scheduled events land
 * before the current time, which sounds like a stutter or a double hit.
 */
export function rebaseTempo(previous: TempoMap, atTick: number, quarterBpm: number): TempoMap {
  assertBpm(quarterBpm)
  const anchorSeconds = previous.secondsAtTick(atTick)
  const secondsPerTick = 60 / quarterBpm / PPQ

  return {
    quarterBpm,
    secondsAtTick: (tick) => anchorSeconds + (tick - atTick) * secondsPerTick,
    tickAtSeconds: (seconds) => atTick + (seconds - anchorSeconds) / secondsPerTick,
  }
}

/** How many quarter notes one of these beats is worth. */
export function beatInQuarters(beatUnit: Duration): Rational {
  return rdiv(durationValue(beatUnit), rat(1, 4))
}

/**
 * Convert a tempo the player sees into the quarter-note tempo used internally.
 *
 * `tempoFromBeat(90, dottedQuarter)` is 135 quarter notes per minute.
 */
export function tempoFromBeat(bpm: number, beatUnit: Duration): TempoMap {
  assertBpm(bpm)
  return constantTempo(bpm * toNumber(beatInQuarters(beatUnit)))
}

/** The inverse, for showing the player a tempo in the beat they are counting. */
export function bpmInBeat(tempo: TempoMap, beatUnit: Duration): number {
  return tempo.quarterBpm / toNumber(beatInQuarters(beatUnit))
}

export const clampBpm = (bpm: number): number =>
  Math.min(MAX_BPM, Math.max(MIN_BPM, Math.round(bpm)))
