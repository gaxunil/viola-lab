/**
 * The contract between the musical layer and the audio layer.
 *
 * Everything the app can play — a metronome, a scale, a rhythm exercise, the
 * target grid for a tap drill — compiles down to a `Score`: a sorted list of
 * events on the tick grid. There is exactly one transport, and it plays scores.
 *
 * This is the boundary that makes an audio app testable. All the musical
 * decisions happen on this side, in pure functions over exact integers, and can
 * be asserted with plain equality. The audio layer's whole job is to walk the
 * list and add an offset to a clock, which leaves it with nothing worth mocking.
 */

import { PPQ, type Ticks } from './ticks'
import type { AccentLevel, Meter } from './rhythm/meter'

export type Articulation = 'normal' | 'staccato' | 'legato'

export type EventPayload =
  | {
      readonly type: 'note'
      readonly midi: number
      readonly velocity: number
      readonly articulation?: Articulation
    }
  | { readonly type: 'click'; readonly accent: AccentLevel }
  /** A marker with no sound — used for count-in beats and section starts. */
  | { readonly type: 'cue'; readonly name: string }

export interface MusicalEvent {
  /** Stable and ascending; equal to the index in `Score.events`. */
  readonly id: number
  readonly tick: Ticks
  readonly durationTicks: Ticks
  readonly payload: EventPayload
  /**
   * Which UI element this event corresponds to — a note in a realized scale, or
   * an event index in a rhythm. Lets the staff and fingerboard highlight in sync
   * without the audio layer knowing anything about them.
   */
  readonly uiIndex?: number
  readonly countIn?: true
}

export interface ScoreLoop {
  readonly startTick: Ticks
  readonly endTick: Ticks
}

export interface Score {
  readonly ppq: number
  readonly meter: Meter
  /** Total length including any count-in. */
  readonly lengthTicks: Ticks
  /** Where the music proper begins; non-zero when there is a count-in. */
  readonly bodyStartTick: Ticks
  /** Sorted by tick, then by id. */
  readonly events: readonly MusicalEvent[]
  readonly loop?: ScoreLoop
}

/**
 * Velocity for each accent level.
 *
 * The spread is deliberately wide. A rhythm exercise is largely about hearing
 * WHERE the beat is, and a beat that is only slightly louder than the notes
 * around it does not teach that on a phone speaker in a room.
 */
export const ACCENT_VELOCITY: Readonly<Record<AccentLevel, number>> = {
  strong: 1,
  medium: 0.82,
  weak: 0.66,
}

/**
 * A note that lands between the beats.
 *
 * Distinct from a WEAK BEAT, which is still a beat. In 12/8 the accent pattern
 * is strong-weak-medium-weak, so beats two and four are marked weak — but they
 * are where the pulse is, and sounding them exactly like the subdivisions
 * around them hides the thing a rhythm exercise is trying to teach. Four tiers,
 * matching how the bar is actually felt: downbeat, secondary accent, other
 * beats, then everything off the beat.
 */
export const OFFBEAT_VELOCITY = 0.42

/**
 * Assemble a score, sorting the events and assigning their ids.
 *
 * Ids are assigned here rather than by callers so they always match array
 * position, which is what lets the transport track "the event currently
 * sounding" as a plain index.
 */
export function makeScore(input: {
  meter: Meter
  lengthTicks: Ticks
  bodyStartTick?: Ticks
  events: ReadonlyArray<Omit<MusicalEvent, 'id'>>
  loop?: ScoreLoop
}): Score {
  const sorted = [...input.events].sort((a, b) => {
    if (a.tick !== b.tick) return a.tick - b.tick
    // A click and a note on the same tick: put the click first so an accent is
    // never masked by a note that started in the same millisecond.
    return payloadRank(a.payload) - payloadRank(b.payload)
  })

  const events: MusicalEvent[] = sorted.map((e, id) => ({ ...e, id }))

  return {
    ppq: PPQ,
    meter: input.meter,
    lengthTicks: input.lengthTicks,
    bodyStartTick: input.bodyStartTick ?? (0 as Ticks),
    events,
    ...(input.loop === undefined ? {} : { loop: input.loop }),
  }
}

function payloadRank(p: EventPayload): number {
  return p.type === 'cue' ? 0 : p.type === 'click' ? 1 : 2
}

export const soundingEvents = (s: Score): MusicalEvent[] =>
  s.events.filter((e) => e.payload.type !== 'cue')

export const noteEvents = (s: Score): MusicalEvent[] =>
  s.events.filter((e) => e.payload.type === 'note')

/** The event sounding at a tick, or null. Used for UI highlighting. */
export function eventAtTick(s: Score, tick: number): MusicalEvent | null {
  let found: MusicalEvent | null = null
  for (const e of s.events) {
    if (e.payload.type === 'cue') continue
    if (e.tick > tick) break
    if (tick < e.tick + e.durationTicks) found = e
  }
  return found
}

/** Total duration in seconds under a given tempo. */
export const scoreSeconds = (s: Score, secondsAtTick: (t: number) => number): number =>
  secondsAtTick(s.lengthTicks)
