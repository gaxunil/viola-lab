/**
 * Where a note lies under the left hand.
 *
 * Two facts drive everything here.
 *
 * First, POSITION IS DIATONIC. The first finger in Nth position sits N letter
 * names above the open string: in 1st position on the D string the first finger
 * is E, in 3rd position it is G. So for fingers 1-4 the letter offset above the
 * open string is (position + finger - 1), and an open string is offset 0. This
 * is the same diatonic arithmetic that places notes on the staff, which is why
 * `pitch.ts` exposes a diatonic axis at all.
 *
 * Second, THE INSTRUMENT IS FRETLESS. A given finger in a given position can
 * play a note a semitone lower or higher than its neutral spot — the "low 2" and
 * "high 2" a string player already thinks in. So a placement is a letter
 * position plus a semitone adjustment, not a single fixed pitch.
 */

import { type Pitch, diatonicIndex, fromDiatonicIndex, toMidi } from '../pitch/pitch'
import {
  type StringId,
  type ViolaString,
  HIGHEST_PRACTICAL,
  STRINGS,
  STRINGS_HIGH_TO_LOW,
  STRING_IDS,
} from './strings'

/** 0 is an open string. Unlike piano, 1 is the index finger, not the thumb. */
export type Finger = 0 | 1 | 2 | 3 | 4

/** 1st, 2nd, 3rd... Half position is 0.5. */
export type Position = number

export interface Placement {
  readonly string: StringId
  readonly finger: Finger
  /** For an open string this is the position the hand is carrying. */
  readonly position: Position
  readonly pitch: Pitch
  readonly semitonesAboveOpen: number
  readonly diatonicStepsAboveOpen: number
  readonly isOpen: boolean
  /**
   * How far the finger sits from its neutral spot, in semitones.
   * -1 is a "low" finger, +1 a "high" or extended one, 0 neutral.
   */
  readonly stretch: number
}

/**
 * Letter steps above the open string for a given position and finger.
 * The formula the whole module rests on.
 */
export function diatonicOffsetFor(position: Position, finger: Finger): number {
  if (finger === 0) return 0
  return position + finger - 1
}

/** Neutral semitone spacing: the major scale above the open string. */
const NEUTRAL_SEMITONES: readonly number[] = [0, 2, 4, 5, 7, 9, 11]

function neutralSemitonesFor(diatonicSteps: number): number {
  const octaves = Math.floor(diatonicSteps / 7)
  const within = NEUTRAL_SEMITONES[diatonicSteps - octaves * 7]
  if (within === undefined) throw new RangeError(`bad diatonic offset ${diatonicSteps}`)
  return octaves * 12 + within
}

/**
 * The pitch a finger lands on, given how far it is stretched from neutral.
 * Spelling follows the diatonic offset, so the letter is never in doubt.
 */
export function pitchAt(
  string: ViolaString,
  position: Position,
  finger: Finger,
  stretch = 0,
): Pitch {
  const steps = diatonicOffsetFor(position, finger)
  const targetMidi = toMidi(string.open) + neutralSemitonesFor(steps) + stretch
  const natural = fromDiatonicIndex(diatonicIndex(string.open) + steps, 0)
  const alter = targetMidi - toMidi(natural)
  if (alter < -2 || alter > 2) {
    throw new RangeError(`unplayable spelling at ${string.id} position ${position} finger ${finger}`)
  }
  return fromDiatonicIndex(diatonicIndex(string.open) + steps, alter as -2 | -1 | 0 | 1 | 2)
}

/** Which position puts this finger on this pitch? */
export function positionOf(string: ViolaString, pitch: Pitch, finger: Finger): Position {
  if (finger === 0) return 1
  return diatonicIndex(pitch) - diatonicIndex(string.open) - finger + 1
}

export interface PlacementQuery {
  readonly maxPosition?: number
  readonly allowedStrings?: readonly StringId[]
  /** How far a finger may sit from neutral. 1 covers low and high fingers. */
  readonly maxStretch?: number
}

/**
 * Every physically sensible way to play a pitch.
 *
 * An empty result means the note cannot be played at all — which is a real
 * answer the app needs, not an error: B flat below the open C string simply does
 * not exist on a viola.
 */
export function placementsFor(pitch: Pitch, q: PlacementQuery = {}): Placement[] {
  const maxPosition = q.maxPosition ?? 5
  const maxStretch = q.maxStretch ?? 1
  const allowed = q.allowedStrings ?? STRING_IDS

  const out: Placement[] = []

  for (const id of allowed) {
    const string = STRINGS[id]
    const semitonesAboveOpen = toMidi(pitch) - string.openMidi
    if (semitonesAboveOpen < 0) continue // below this string entirely

    const diatonicStepsAboveOpen = diatonicIndex(pitch) - diatonicIndex(string.open)
    if (diatonicStepsAboveOpen < 0) continue

    const stretch = semitonesAboveOpen - neutralSemitonesFor(diatonicStepsAboveOpen)
    if (Math.abs(stretch) > maxStretch) continue

    if (diatonicStepsAboveOpen === 0 && semitonesAboveOpen === 0) {
      out.push({
        string: id,
        finger: 0,
        position: 1,
        pitch,
        semitonesAboveOpen,
        diatonicStepsAboveOpen,
        isOpen: true,
        stretch: 0,
      })
      continue
    }

    for (const finger of [1, 2, 3, 4] as const) {
      const position = diatonicStepsAboveOpen - finger + 1
      if (position < 1 || position > maxPosition) continue
      out.push({
        string: id,
        finger,
        position,
        pitch,
        semitonesAboveOpen,
        diatonicStepsAboveOpen,
        isOpen: false,
        stretch,
      })
    }
  }

  return out
}

export const isPlayable = (pitch: Pitch, q: PlacementQuery = {}): boolean =>
  placementsFor(pitch, q).length > 0

const ORDINAL = ['', '1st', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']

export function positionName(n: Position): string {
  if (n === 0.5) return 'half position'
  const label = ORDINAL[n] ?? `${n}th`
  return `${label} position`
}

/** Rows of the fingerboard diagram: one semitone each, from the nut. */
export const DIAGRAM_ROWS = 12

export interface FingerboardDot {
  readonly string: StringId
  readonly semitonesAboveOpen: number
  readonly finger: Finger
  readonly pitch: Pitch
  /** What to print in the dot — a finger number or a note name. */
  readonly label: string
  readonly isOpen: boolean
  readonly isTonic: boolean
}

/** The highest pitch reachable within a position limit, for range checks. */
export function highestReachable(maxPosition: number, ceiling = HIGHEST_PRACTICAL): Pitch {
  const top = STRINGS_HIGH_TO_LOW[0]
  if (top === undefined) throw new RangeError('no strings defined')
  const steps = diatonicOffsetFor(maxPosition, 4)
  const candidate = fromDiatonicIndex(diatonicIndex(top.open) + steps, 0)
  return toMidi(candidate) > toMidi(ceiling) ? ceiling : candidate
}
