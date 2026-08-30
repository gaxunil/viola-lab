/**
 * A scale, as a score.
 *
 * Every note carries a `uiIndex` equal to its position in the realized run, so
 * the staff, the fingerboard diagram and the step strip can all highlight the
 * note currently sounding without any of them knowing about the audio layer.
 */

import { ticks, ticksFromWholeNotes } from '../ticks'
import { type Pitch, toMidi } from '../pitch/pitch'
import { type Scale, type ScaleDirection, realize } from '../scale/scale'
import { type Meter, beatOnsets, meter as makeMeter } from '../rhythm/meter'
import { type Duration, dur, durationValue } from '../rhythm/duration'
import { ACCENT_VELOCITY, type MusicalEvent, type Score, makeScore } from '../score'

export interface ScaleScoreOptions {
  readonly scale: Scale
  readonly startOctave: number
  readonly octaves?: number
  readonly direction?: ScaleDirection
  /** What each scale note is written as. Eighths at a walking tempo by default. */
  readonly noteValue?: Duration
  /** The meter the run is counted in. Four beats per bar unless told otherwise. */
  readonly meter?: Meter
  readonly countInBars?: number
  /** Repeat the run indefinitely, for practising against a drone. */
  readonly loop?: boolean
}

/**
 * Turn a run of pitches into evenly spaced note events.
 *
 * A scale is played straight — no rhythm of its own — so the only decision is
 * how long each note lasts, and every note is the same length.
 */
export function compilePitchRun(o: {
  pitches: readonly Pitch[]
  noteValue: Duration
  meter: Meter
  countInBars?: number
  loop?: boolean
}): Score {
  const step = ticksFromWholeNotes(durationValue(o.noteValue))
  const countInBars = o.countInBars ?? 0
  const bodyStartTick = ticks(countInBars * o.meter.barTicks)

  const events: Array<Omit<MusicalEvent, 'id'>> = []

  // A count-in is clicks, not notes: she needs the pulse, not the pitch.
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

  for (const [index, pitch] of o.pitches.entries()) {
    const tick = ticks(bodyStartTick + index * step)
    // The first note of the run leans slightly, the way a player would start it.
    const velocity = index === 0 ? ACCENT_VELOCITY.strong : ACCENT_VELOCITY.medium
    events.push({
      tick,
      durationTicks: step,
      payload: { type: 'note', midi: toMidi(pitch), velocity, articulation: 'legato' },
      uiIndex: index,
    })
  }

  const lengthTicks = ticks(bodyStartTick + o.pitches.length * step)

  return makeScore({
    meter: o.meter,
    lengthTicks,
    bodyStartTick,
    events,
    // The loop covers the run only, so a count-in is heard once and the scale
    // then repeats straight into itself the way it is practised.
    ...(o.loop ? { loop: { startTick: bodyStartTick, endTick: lengthTicks } } : {}),
  })
}

export function compileScale(o: ScaleScoreOptions): { score: Score; pitches: Pitch[] } {
  const pitches = realize(o.scale, {
    startOctave: o.startOctave,
    octaves: o.octaves ?? 2,
    direction: o.direction ?? 'up',
  })

  const noteValue = o.noteValue ?? dur('eighth')
  const meter = o.meter ?? makeMeter(4, 4)

  const score = compilePitchRun({
    pitches,
    noteValue,
    meter,
    ...(o.countInBars === undefined ? {} : { countInBars: o.countInBars }),
    ...(o.loop === undefined ? {} : { loop: o.loop }),
  })

  return { score, pitches }
}
