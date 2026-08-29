/**
 * A rhythm exercise, as a score.
 *
 * Ties are resolved before anything reaches the score, so a note tied across a
 * barline produces one sounding event with one onset. The source event indices
 * survive on `uiIndex` via the span, so both noteheads can still be highlighted.
 *
 * Rhythm events carry no pitch — a rhythm is a rhythm — so the exercise is
 * sounded on a single repeated note by default. Playing a drill on one pitch is
 * also what a teacher does: it puts the whole of the student's attention on time.
 */

import { ticks, ticksFromWholeNotes } from '../ticks'
import { type Meter, beatOnsets } from '../rhythm/meter'
import {
  type RhythmEvent,
  barTotal,
  fillsWholeBars,
  placeEvents,
  resolveTies,
  validateBar,
} from '../rhythm/bar'
import { ACCENT_VELOCITY, type MusicalEvent, type Score, makeScore } from '../score'
import type { GridPoint } from '../scoring/gridTypes'

/** Middle-register D, comfortable on the viola and easy to hear against a click. */
export const DEFAULT_RHYTHM_MIDI = 62

export interface RhythmScoreOptions {
  readonly meter: Meter
  /**
   * The WHOLE passage, not one bar. A two-bar exercise is one list of events
   * whose durations add up to two bars; the bar count is derived from it, so
   * there is no way for the caller and the compiler to disagree about length.
   */
  readonly events: readonly RhythmEvent[]
  /** Sound the exercise on this pitch. */
  readonly midi?: number
  /** Play a click track underneath. On by default: the point is playing WITH a pulse. */
  readonly withClick?: boolean
  readonly countInBars?: number
  readonly loop?: boolean
}

export function compileRhythm(o: RhythmScoreOptions): Score {
  const midi = o.midi ?? DEFAULT_RHYTHM_MIDI
  const withClick = o.withClick ?? true
  const countInBars = o.countInBars ?? 0

  if (!fillsWholeBars(o.meter, o.events)) {
    const validation = validateBar(o.meter, o.events)
    const detail = validation.ok ? 'it does not fill a whole number of bars' : validation.message
    throw new RangeError(`rhythm does not fit ${o.meter.label}: ${detail}`)
  }

  const totalTicks = ticks(ticksFromWholeNotes(barTotal(o.events)))
  const bars = totalTicks / o.meter.barTicks

  const bodyStartTick = ticks(countInBars * o.meter.barTicks)
  const events: Array<Omit<MusicalEvent, 'id'>> = []

  for (let bar = 0; bar < countInBars; bar++) {
    for (const [beat, onset] of beatOnsets(o.meter).entries()) {
      events.push({
        tick: ticks(bar * o.meter.barTicks + onset),
        durationTicks: ticks(Math.round(o.meter.pulseTicks / 2)),
        payload: { type: 'click', accent: o.meter.accents[beat] ?? 'weak' },
        countIn: true,
      })
    }
  }

  // The exercise itself, with ties already collapsed.
  const placed = placeEvents(o.meter, o.events)
  for (const span of resolveTies(o.meter, o.events)) {
    if (span.kind === 'rest') continue
    const first = placed[span.sourceIndices[0] ?? 0]
    const accent = first?.accent ?? null
    events.push({
      tick: ticks(bodyStartTick + span.onsetTicks),
      durationTicks: span.durationTicks,
      payload: {
        type: 'note',
        midi,
        velocity: accent ? ACCENT_VELOCITY[accent] : ACCENT_VELOCITY.weak,
      },
      uiIndex: span.sourceIndices[0] ?? 0,
    })
  }

  if (withClick) {
    for (let bar = 0; bar < bars; bar++) {
      for (const [beat, onset] of beatOnsets(o.meter).entries()) {
        events.push({
          tick: ticks(bodyStartTick + bar * o.meter.barTicks + onset),
          durationTicks: ticks(Math.round(o.meter.pulseTicks / 2)),
          payload: { type: 'click', accent: o.meter.accents[beat] ?? 'weak' },
        })
      }
    }
  }

  const lengthTicks = ticks(bodyStartTick + totalTicks)

  return makeScore({
    meter: o.meter,
    lengthTicks,
    bodyStartTick,
    events,
    ...(o.loop ? { loop: { startTick: bodyStartTick, endTick: lengthTicks } } : {}),
  })
}

/**
 * The grid a tap performance is scored against.
 *
 * This is the notated rhythm, not the click track: she is tapping the exercise,
 * so the targets are its onsets. Rests are not targets, and a tied note is one
 * target rather than two.
 */
export function tapGridFor(
  meter: Meter,
  events: readonly RhythmEvent[],
  secondsAtTick: (tick: number) => number,
  o: { countInBars?: number } = {},
): GridPoint[] {
  const bodyStartTick = (o.countInBars ?? 0) * meter.barTicks
  const placed = placeEvents(meter, events)

  const grid: GridPoint[] = []
  for (const span of resolveTies(meter, events)) {
    if (span.kind === 'rest') continue
    const first = placed[span.sourceIndices[0] ?? 0]
    grid.push({
      index: grid.length,
      time: secondsAtTick(bodyStartTick + span.onsetTicks),
      accent: first?.accent ?? 'weak',
    })
  }
  return grid
}
