/**
 * The metronome, as a score.
 *
 * There is deliberately no separate metronome engine. A metronome is a looping
 * score of click events, played by the same transport as everything else, so it
 * cannot drift out of agreement with how the app plays a rhythm exercise. If the
 * standalone metronome ever needs something the transport cannot do, that is a
 * reason to extend the transport, not to fork it.
 */

import { ticks } from '../ticks'
import { type Meter, beatOnsets } from '../rhythm/meter'
import { ACCENT_VELOCITY, type MusicalEvent, type Score, makeScore } from '../score'

export interface MetronomeOptions {
  readonly meter: Meter
  readonly bars?: number
  readonly loop?: boolean
  /** Extra unaccented clicks per felt beat: 2 splits each beat in half. */
  readonly subdivision?: 1 | 2 | 3 | 4
  readonly countInBars?: number
}

/**
 * Click events for one bar, offset by `barStart`.
 *
 * Beat clicks come from `beatOnsets`, so a compound meter clicks on its four
 * dotted-quarter beats rather than on all twelve eighths, and an asymmetric
 * meter clicks on its real groups.
 */
function barClicks(
  meter: Meter,
  barStart: number,
  subdivision: number,
  countIn: boolean,
): Array<Omit<MusicalEvent, 'id'>> {
  const out: Array<Omit<MusicalEvent, 'id'>> = []
  const onsets = beatOnsets(meter)

  for (const [beat, onset] of onsets.entries()) {
    const accent = meter.accents[beat] ?? 'weak'
    const beatLength = (meter.grouping[beat] ?? 1) * meter.pulseTicks

    out.push({
      tick: ticks(barStart + onset),
      durationTicks: ticks(Math.round(beatLength / 4)),
      payload: { type: 'click', accent },
      uiIndex: beat,
      ...(countIn ? { countIn: true as const } : {}),
    })

    // Subdivisions are always weak: they are there to fill in the gaps, not to
    // compete with the beat.
    for (let s = 1; s < subdivision; s++) {
      const offset = Math.round((beatLength * s) / subdivision)
      out.push({
        tick: ticks(barStart + onset + offset),
        durationTicks: ticks(Math.round(beatLength / 8)),
        payload: { type: 'click', accent: 'weak' },
        uiIndex: beat,
        ...(countIn ? { countIn: true as const } : {}),
      })
    }
  }

  return out
}

export function compileMetronome(o: MetronomeOptions): Score {
  const bars = o.bars ?? 1
  const subdivision = o.subdivision ?? 1
  const countInBars = o.countInBars ?? 0

  if (bars < 1) throw new RangeError('a metronome needs at least one bar')

  const events: Array<Omit<MusicalEvent, 'id'>> = []
  const bodyStartTick = ticks(countInBars * o.meter.barTicks)

  for (let bar = 0; bar < countInBars; bar++) {
    events.push(...barClicks(o.meter, bar * o.meter.barTicks, 1, true))
  }
  for (let bar = 0; bar < bars; bar++) {
    events.push(...barClicks(o.meter, bodyStartTick + bar * o.meter.barTicks, subdivision, false))
  }

  const lengthTicks = ticks(bodyStartTick + bars * o.meter.barTicks)

  return makeScore({
    meter: o.meter,
    lengthTicks,
    bodyStartTick,
    events,
    // A loop repeats only the body, so a count-in is heard once.
    ...(o.loop ? { loop: { startTick: bodyStartTick, endTick: lengthTicks } } : {}),
  })
}

/** Velocity a click sounds at, exposed so the audio layer stays arithmetic-free. */
export const clickVelocity = (meter: Meter, beat: number): number =>
  ACCENT_VELOCITY[meter.accents[beat] ?? 'weak']

