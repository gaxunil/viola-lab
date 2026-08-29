/**
 * Fingering a scale, and deciding where on the instrument it can live.
 *
 * The interesting part is not the fingering itself but the range question. Not
 * all keys are equal on a viola: C major and D major sit entirely in first
 * position across all four strings, G major over two octaves needs a shift to
 * third, and B flat major cannot descend two octaves at all because B flat 2 is
 * below the open C string.
 *
 * That asymmetry is real instrument knowledge, and it is the sort of thing a
 * student otherwise only learns by being told. So the app surfaces it rather
 * than quietly transposing the problem away.
 */

import { type Pitch, formatPitch, toMidi } from '../pitch/pitch'
import { type Scale, type ScaleDirection, realize } from '../scale/scale'
import { type FingeringOptions, type FingeringPlan, fingerNotes } from './fingering'
import { type Position } from './fingerboard'
import { HIGHEST_PRACTICAL, LOWEST_PITCH } from './strings'

export interface ScaleFingeringOptions extends Partial<FingeringOptions> {
  readonly startOctave: number
  readonly octaves?: number
  readonly direction?: ScaleDirection
}

/** Finger a scale, realizing it first. */
export function fingerScale(scale: Scale, o: ScaleFingeringOptions): FingeringPlan {
  const pitches = realize(scale, {
    startOctave: o.startOctave,
    octaves: o.octaves ?? 2,
    direction: o.direction ?? 'up',
  })
  return fingerNotes(pitches, o)
}

export interface RangeSuggestion {
  readonly start: Pitch
  readonly end: Pitch
  readonly octaves: number
  readonly feasible: boolean
  /** The highest position the run requires, when it is playable. */
  readonly requiresPosition: Position
  readonly staysInFirstPosition: boolean
  readonly shifts: number
  /** Why it does not work, in words a student can act on. */
  readonly reason?: string
}

const MIN_START_OCTAVE = 2
const MAX_START_OCTAVE = 5

/**
 * Every octave the scale could start in, with a verdict on each.
 *
 * Infeasible options are returned rather than filtered out, because "you cannot
 * start there, and here is why" is the useful answer.
 */
export function rangeOptions(
  scale: Scale,
  octaves: number,
  o: Partial<FingeringOptions> = {},
): RangeSuggestion[] {
  const out: RangeSuggestion[] = []

  for (let startOctave = MIN_START_OCTAVE; startOctave <= MAX_START_OCTAVE; startOctave++) {
    const pitches = realize(scale, { startOctave, octaves, direction: 'up' })
    const start = pitches[0]
    const end = pitches[pitches.length - 1]
    if (start === undefined || end === undefined) continue

    const below = pitches.find((p) => toMidi(p) < toMidi(LOWEST_PITCH))
    if (below !== undefined) {
      out.push({
        start,
        end,
        octaves,
        feasible: false,
        requiresPosition: 0,
        staysInFirstPosition: false,
        shifts: 0,
        reason: `${formatPitch(below)} is below the open C string`,
      })
      continue
    }

    const above = pitches.find((p) => toMidi(p) > toMidi(HIGHEST_PRACTICAL))
    if (above !== undefined) {
      out.push({
        start,
        end,
        octaves,
        feasible: false,
        requiresPosition: 0,
        staysInFirstPosition: false,
        shifts: 0,
        reason: `${formatPitch(above)} is higher than this app covers`,
      })
      continue
    }

    const plan = fingerNotes(pitches, o)
    if (!plan.complete) {
      out.push({
        start,
        end,
        octaves,
        feasible: false,
        requiresPosition: 0,
        staysInFirstPosition: false,
        shifts: 0,
        reason: plan.warnings[0]?.message ?? 'no playable fingering',
      })
      continue
    }

    out.push({
      start,
      end,
      octaves,
      feasible: true,
      requiresPosition: plan.highestPosition,
      staysInFirstPosition: plan.staysInFirstPosition,
      shifts: plan.shifts.length,
    })
  }

  return out
}

/**
 * The octave a player would actually be told to start in: the lowest feasible
 * one, preferring a run that needs no shift.
 */
export function bestRange(
  scale: Scale,
  octaves: number,
  o: Partial<FingeringOptions> = {},
): RangeSuggestion | null {
  const feasible = rangeOptions(scale, octaves, o).filter((r) => r.feasible)
  if (feasible.length === 0) return null

  const noShift = feasible.filter((r) => r.staysInFirstPosition)
  const pool = noShift.length > 0 ? noShift : feasible

  return pool.reduce((best, r) => {
    if (r.requiresPosition !== best.requiresPosition) {
      return r.requiresPosition < best.requiresPosition ? r : best
    }
    return toMidi(r.start) < toMidi(best.start) ? r : best
  })
}

/** How many octaves of this scale fit on the instrument at all. */
export function maxOctaves(scale: Scale, o: Partial<FingeringOptions> = {}): number {
  for (let octaves = 3; octaves >= 1; octaves--) {
    if (rangeOptions(scale, octaves, o).some((r) => r.feasible)) return octaves
  }
  return 0
}
