/**
 * Intervals, as signed two-dimensional vectors.
 *
 * An interval is stored as the displacement along each axis:
 *
 *   major third up   -> { diatonic:  2, chromatic:  4 }
 *   minor third down -> { diatonic: -2, chromatic: -3 }
 *
 * Storing the vector rather than a (number, quality) pair makes the type total —
 * there are no unrepresentable or contradictory states — and closed under
 * addition and negation. The familiar "major third" naming is a *view* over the
 * vector (see `intervalName`), not the storage format.
 *
 * `transpose` is the reason for all of this, and it is four lines: move along
 * the diatonic axis to find the letter, move along the chromatic axis to find
 * the sounding pitch, and the accidental is whatever reconciles the two. Correct
 * spelling is then a consequence of arithmetic rather than a lookup table.
 */

import {
  type Alteration,
  type Pitch,
  type PitchClass,
  LETTER_STEP,
  diatonicIndex,
  fromDiatonicIndex,
  toMidi,
} from './pitch'

export interface Interval {
  readonly diatonic: number
  readonly chromatic: number
}

export type IntervalQuality = 'dd' | 'd' | 'm' | 'P' | 'M' | 'A' | 'AA'

export interface IntervalName {
  /** 1 = unison, 2 = second, ... Always positive; direction is separate. */
  readonly number: number
  readonly quality: IntervalQuality
  readonly direction: 1 | -1
  /** 'M3', 'A2', 'P5', 'd5' */
  readonly short: string
  /** 'major third', 'augmented second' */
  readonly long: string
}

/** Raised when a transposition would need a triple sharp or flat. */
export class SpellingRangeError extends Error {
  readonly requestedAlter: number
  constructor(requestedAlter: number, detail: string) {
    super(`spelling would need alteration ${requestedAlter}: ${detail}`)
    this.name = 'SpellingRangeError'
    this.requestedAlter = requestedAlter
  }
}

/** Semitones above the tonic for each diatonic step within one octave. */
const NATURAL_SEMITONES: readonly number[] = [0, 2, 4, 5, 7, 9, 11]

/** Diatonic steps that behave as "perfect" rather than "major/minor". */
const PERFECT_STEPS = new Set([0, 3, 4])

function naturalSemitonesFor(diatonic: number): number {
  const octaves = Math.floor(diatonic / 7)
  const step = diatonic - octaves * 7
  const within = NATURAL_SEMITONES[step]
  if (within === undefined) throw new RangeError(`bad diatonic step ${step}`)
  return octaves * 12 + within
}

export const OCTAVE: Interval = { diatonic: 7, chromatic: 12 }
export const UNISON: Interval = { diatonic: 0, chromatic: 0 }

export const addIntervals = (a: Interval, b: Interval): Interval => ({
  diatonic: a.diatonic + b.diatonic,
  chromatic: a.chromatic + b.chromatic,
})

export const negate = (i: Interval): Interval => ({
  diatonic: -i.diatonic,
  chromatic: -i.chromatic,
})

/** Reduce a compound interval to within an octave, preserving quality. */
export function simplify(i: Interval): Interval {
  const octaves = Math.floor(i.diatonic / 7)
  return { diatonic: i.diatonic - octaves * 7, chromatic: i.chromatic - octaves * 12 }
}

const ORDINALS: readonly string[] = [
  'unison',
  'second',
  'third',
  'fourth',
  'fifth',
  'sixth',
  'seventh',
  'octave',
  'ninth',
  'tenth',
  'eleventh',
  'twelfth',
  'thirteenth',
]

const QUALITY_WORD: Readonly<Record<IntervalQuality, string>> = {
  dd: 'doubly diminished',
  d: 'diminished',
  m: 'minor',
  P: 'perfect',
  M: 'major',
  A: 'augmented',
  AA: 'doubly augmented',
}

/** Offset from the natural size -> quality, for perfect-class intervals. */
const PERFECT_QUALITY = new Map<number, IntervalQuality>([
  [-2, 'dd'],
  [-1, 'd'],
  [0, 'P'],
  [1, 'A'],
  [2, 'AA'],
])

/** Offset from the *major* size -> quality, for major/minor-class intervals. */
const MAJOR_QUALITY = new Map<number, IntervalQuality>([
  [-3, 'dd'],
  [-2, 'd'],
  [-1, 'm'],
  [0, 'M'],
  [1, 'A'],
  [2, 'AA'],
])

export function intervalName(i: Interval): IntervalName {
  const direction: 1 | -1 = i.diatonic < 0 || (i.diatonic === 0 && i.chromatic < 0) ? -1 : 1
  const abs: Interval =
    direction === 1 ? i : { diatonic: -i.diatonic, chromatic: -i.chromatic }

  const delta = abs.chromatic - naturalSemitonesFor(abs.diatonic)
  const step = ((abs.diatonic % 7) + 7) % 7
  const table = PERFECT_STEPS.has(step) ? PERFECT_QUALITY : MAJOR_QUALITY
  const quality = table.get(delta)
  if (quality === undefined) {
    throw new RangeError(
      `interval {diatonic:${i.diatonic}, chromatic:${i.chromatic}} is too far from any named quality`,
    )
  }

  const number = abs.diatonic + 1
  const ordinal = ORDINALS[abs.diatonic] ?? `${number}th`
  return {
    number,
    quality,
    direction,
    short: `${quality}${number}`,
    long: `${QUALITY_WORD[quality]} ${ordinal}`,
  }
}

export const formatInterval = (i: Interval): string => intervalName(i).short

const SHORTHAND = /^(dd|d|m|P|M|A{1,2})(\d+)$/

/**
 * Parse interval shorthand into a vector: iv('A2') -> { diatonic: 1, chromatic: 3 }.
 *
 * Every data table and test literal in the codebase uses this, so the source
 * always reads as music even though the runtime value is a vector.
 */
export function iv(short: string): Interval {
  const m = SHORTHAND.exec(short.trim())
  if (!m) throw new SyntaxError(`bad interval shorthand "${short}"`)

  const quality = (m[1] === 'AA' ? 'AA' : m[1]) as IntervalQuality
  const number = Number(m[2])
  if (number < 1) throw new SyntaxError(`interval number must be >= 1 in "${short}"`)

  const diatonic = number - 1
  const step = ((diatonic % 7) + 7) % 7
  const isPerfect = PERFECT_STEPS.has(step)
  const table = isPerfect ? PERFECT_QUALITY : MAJOR_QUALITY

  let delta: number | undefined
  for (const [offset, q] of table) {
    if (q === quality) {
      delta = offset
      break
    }
  }
  if (delta === undefined) {
    throw new SyntaxError(
      `quality "${quality}" is not valid for a ${number}${isPerfect ? ' (perfect class)' : ' (major/minor class)'}`,
    )
  }

  return { diatonic, chromatic: naturalSemitonesFor(diatonic) + delta }
}

function alterationFor(newDiatonic: number, targetMidi: number, detail: string): Alteration {
  const natural = fromDiatonicIndex(newDiatonic, 0)
  const alter = targetMidi - toMidi(natural)
  if (alter < -2 || alter > 2) throw new SpellingRangeError(alter, detail)
  return alter as Alteration
}

/**
 * Move a pitch by an interval, keeping the spelling honest.
 *
 * The letter comes from the diatonic axis and the sound comes from the chromatic
 * axis; the accidental is whatever reconciles them. That is why transposing a
 * major third up from B gives D sharp rather than E flat, with no special case.
 */
export function transpose(p: Pitch, i: Interval): Pitch {
  const newDiatonic = diatonicIndex(p) + i.diatonic
  const targetMidi = toMidi(p) + i.chromatic
  const alter = alterationFor(newDiatonic, targetMidi, `transposing ${p.letter}${p.octave}`)
  return fromDiatonicIndex(newDiatonic, alter)
}

/** Transpose a pitch class, discarding the octave. */
export function transposeClass(k: PitchClass, i: Interval): PitchClass {
  // Octave 4 is arbitrary; only the letter and alteration are kept.
  const moved = transpose({ ...k, octave: 4 }, i)
  return { letter: moved.letter, alter: moved.alter }
}

export const intervalBetween = (a: Pitch, b: Pitch): Interval => ({
  diatonic: diatonicIndex(b) - diatonicIndex(a),
  chromatic: toMidi(b) - toMidi(a),
})

/** The interval from one pitch class up to another, ascending within one octave. */
export function intervalBetweenClasses(a: PitchClass, b: PitchClass): Interval {
  const from: Pitch = { ...a, octave: 4 }
  const steps = (((LETTER_STEP[b.letter] - LETTER_STEP[a.letter]) % 7) + 7) % 7
  const to = fromDiatonicIndex(diatonicIndex(from) + steps, b.alter)
  return intervalBetween(from, to)
}
