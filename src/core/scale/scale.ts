/**
 * Scales: spelled degrees, and the whole/half step pattern between them.
 *
 * The step pattern is DERIVED, never stored. Each step is the interval between
 * consecutive degrees, computed with `intervalBetween`, so the pattern shown on
 * screen and the notes coming out of the speaker cannot disagree. Harmonic
 * minor's augmented second is not a special case anywhere in this file — it is
 * simply what the arithmetic returns between the flat sixth and natural seventh.
 */

import {
  type Pitch,
  type PitchClass,
  formatPitch,
  pitchClassNumber,
  toMidi,
  withOctave,
} from '../pitch/pitch'
import {
  type Interval,
  OCTAVE,
  addIntervals,
  intervalName,
  SpellingRangeError,
  iv,
  transpose,
  transposeClass,
} from '../pitch/interval'
import { type Key, type Mode, keyOf, majorKeyAtFifths } from '../key/key'
import type { ScaleType } from './scaleTypes'

/** A step is one of three sizes. Anything else is a bug, and throws. */
export type StepSymbol = 'H' | 'W' | 'A2'

export interface ScaleDegree {
  /** 1-based. */
  readonly number: number
  readonly pitchClass: PitchClass
  readonly fromTonic: Interval
  /** Relative to the parallel major: '1', '2', '♭3', '♯4'. */
  readonly label: string
  readonly isAltered: boolean
}

export interface ScaleStep {
  readonly fromDegree: number
  readonly toDegree: number
  /** The exact interval — an augmented 2nd is not the same as a minor 3rd. */
  readonly interval: Interval
  readonly semitones: number
  readonly symbol: StepSymbol
  /** What the UI prints: 'H', 'W', or '1½'. */
  readonly display: string
  /** 'half step', 'whole step', 'augmented 2nd'. */
  readonly name: string
  readonly isAugmented: boolean
}

export interface Scale {
  readonly type: ScaleType
  readonly tonic: PitchClass
  /** The notation context: which key signature to print. */
  readonly key: Key
  readonly name: string
  readonly degrees: readonly ScaleDegree[]
  /** One entry per step, including the final step up to the octave. */
  readonly steps: readonly ScaleStep[]
  readonly descendingDegrees: readonly ScaleDegree[]
  readonly descendingSteps: readonly ScaleStep[]
  /** True when the descending form differs: melodic minor and chromatic. */
  readonly isAsymmetric: boolean
}

const MAJOR_REFERENCE: readonly Interval[] = [
  iv('P1'),
  iv('M2'),
  iv('M3'),
  iv('P4'),
  iv('P5'),
  iv('M6'),
  iv('M7'),
]

/**
 * Map a step size to its display token.
 *
 * Throws on anything outside 1..3 semitones. A silent mislabel would be far
 * worse than a loud failure: it would teach the wrong thing.
 */
function stepSymbol(semitones: number): StepSymbol {
  switch (semitones) {
    case 1:
      return 'H'
    case 2:
      return 'W'
    case 3:
      return 'A2'
    default:
      throw new RangeError(
        `unexpected scale step of ${semitones} semitones — no scale in the catalogue should do this`,
      )
  }
}

const STEP_DISPLAY: Readonly<Record<StepSymbol, string>> = { H: 'H', W: 'W', A2: '1½' }
const STEP_NAME: Readonly<Record<StepSymbol, string>> = {
  H: 'half step',
  W: 'whole step',
  A2: 'augmented 2nd',
}

function degreeLabel(fromTonic: Interval, index: number): { label: string; isAltered: boolean } {
  const reference = MAJOR_REFERENCE[index]
  // Beyond seven degrees (chromatic) there is no major-scale degree to compare to.
  if (reference === undefined) return { label: intervalName(fromTonic).short, isAltered: true }

  const delta = fromTonic.chromatic - reference.chromatic
  const number = fromTonic.diatonic + 1
  if (delta === 0) return { label: `${number}`, isAltered: false }
  const mark = delta < 0 ? '♭'.repeat(-delta) : '♯'.repeat(delta)
  return { label: `${mark}${number}`, isAltered: true }
}

function buildDegrees(tonic: PitchClass, intervals: readonly Interval[]): ScaleDegree[] {
  return intervals.map((fromTonic, i) => {
    const { label, isAltered } = degreeLabel(fromTonic, i)
    return {
      number: i + 1,
      pitchClass: transposeClass(tonic, fromTonic),
      fromTonic,
      label,
      isAltered,
    }
  })
}

/**
 * Derive the step pattern, wrapping the last step up to the octave.
 *
 * Steps are measured on both axes, so a three-semitone step that spans one
 * letter (an augmented second) is distinguished from one that spans two (a minor
 * third) — which is the entire point of harmonic minor.
 */
function buildSteps(degrees: readonly ScaleDegree[]): ScaleStep[] {
  return degrees.map((degree, i) => {
    const next = degrees[i + 1]
    const toTonic = next ? next.fromTonic : OCTAVE
    const interval: Interval = {
      diatonic: toTonic.diatonic - degree.fromTonic.diatonic,
      chromatic: toTonic.chromatic - degree.fromTonic.chromatic,
    }
    const symbol = stepSymbol(interval.chromatic)
    return {
      fromDegree: degree.number,
      toDegree: next ? next.number : degrees.length + 1,
      interval,
      semitones: interval.chromatic,
      symbol,
      display: STEP_DISPLAY[symbol],
      // Prefer the true interval name where it is more specific than the token.
      name: symbol === 'A2' ? STEP_NAME.A2 : intervalName(interval).long,
      isAugmented: symbol === 'A2',
    }
  })
}

/** Which key signature this scale should be notated with. */
function notationKey(tonic: PitchClass, type: ScaleType): Key {
  if (type.signatureBasis === 'none') {
    // Symmetric scales have no key feeling; borrow the major for spelling only.
    return resolveKey(tonic, 'major')
  }
  if (type.signatureBasis === 'parent-major') {
    // A mode borrows its parent major's signature: D dorian reads in C major.
    const rotation = type.modeRotation ?? 0
    const asMajor = resolveKey(tonic, 'major')
    // Walk back around the circle by the mode's rotation in fifths.
    const MODE_FIFTHS: readonly number[] = [0, -2, -4, 1, -1, -3, -5]
    const shift = MODE_FIFTHS[rotation] ?? 0
    const fifths = asMajor.signature.fifths + shift
    if (fifths >= -7 && fifths <= 7) return majorKeyAtFifths(fifths)
    return asMajor
  }
  return resolveKey(tonic, type.signatureBasis === 'minor' ? 'minor' : 'major')
}

function resolveKey(tonic: PitchClass, mode: Mode): Key {
  const result = keyOf(tonic, mode)
  // A theoretical tonic still needs somewhere to live; use the enharmonic key a
  // player would actually read.
  return result.ok ? result.key : result.suggestion
}

export function buildScale(tonic: PitchClass, type: ScaleType): Scale {
  const degrees = buildDegrees(tonic, type.ascending)
  const steps = buildSteps(degrees)

  const isAsymmetric = type.descending !== undefined
  const descendingDegrees = isAsymmetric ? buildDegrees(tonic, type.descending!) : degrees
  const descendingSteps = isAsymmetric ? buildSteps(descendingDegrees) : steps

  return {
    type,
    tonic,
    key: notationKey(tonic, type),
    name: `${formatPitch(tonic)} ${type.name.toLowerCase()}`,
    degrees,
    steps,
    descendingDegrees,
    descendingSteps,
    isAsymmetric,
  }
}

/**
 * Build a scale, or return null if it cannot be spelled.
 *
 * A few root/type pairs are genuinely unwritable: a chromatic scale from B sharp
 * would need triple sharps. Those roots are not real choices a player would ever
 * be offered, so the UI uses this to filter the picker rather than presenting an
 * option that throws.
 */
export function tryBuildScale(tonic: PitchClass, type: ScaleType): Scale | null {
  try {
    return buildScale(tonic, type)
  } catch (err) {
    if (err instanceof SpellingRangeError) return null
    throw err
  }
}

export const isScaleSpellable = (tonic: PitchClass, type: ScaleType): boolean =>
  tryBuildScale(tonic, type) !== null

export type ScaleDirection = 'up' | 'down' | 'up-down'

export interface RealizeOptions {
  readonly startOctave: number
  readonly octaves?: number
  readonly direction?: ScaleDirection
  /** Repeat the top note at the turnaround. Off by default, as players play it. */
  readonly repeatTop?: boolean
}

/** One ascending run, tonic to tonic, spanning `octaves`. */
function runUp(scale: Scale, startOctave: number, octaves: number): Pitch[] {
  const out: Pitch[] = []
  for (let o = 0; o < octaves; o++) {
    for (const degree of scale.degrees) {
      out.push(placeDegree(scale, degree.fromTonic, startOctave, o))
    }
  }
  out.push(placeDegree(scale, OCTAVE, startOctave, octaves - 1))
  return out
}

/** One descending run, top tonic down to the bottom tonic. */
function runDown(scale: Scale, startOctave: number, octaves: number): Pitch[] {
  const out: Pitch[] = []
  out.push(placeDegree(scale, OCTAVE, startOctave, octaves - 1))
  for (let o = octaves - 1; o >= 0; o--) {
    for (let i = scale.descendingDegrees.length - 1; i >= 0; i--) {
      const degree = scale.descendingDegrees[i]
      if (degree === undefined) continue
      out.push(placeDegree(scale, degree.fromTonic, startOctave, o))
    }
  }
  return out
}

function placeDegree(
  scale: Scale,
  fromTonic: Interval,
  startOctave: number,
  octaveOffset: number,
): Pitch {
  const root = withOctave(scale.tonic, startOctave)
  const shifted = addIntervals(fromTonic, {
    diatonic: OCTAVE.diatonic * octaveOffset,
    chromatic: OCTAVE.chromatic * octaveOffset,
  })
  return transpose(root, shifted)
}

/**
 * Turn a scale into actual octave-bearing pitches.
 *
 * This is the only place melodic minor's asymmetry is applied: descending runs
 * use `descendingDegrees`, so the sixth and seventh revert on the way down.
 */
export function realize(scale: Scale, o: RealizeOptions): Pitch[] {
  const octaves = o.octaves ?? 2
  const direction = o.direction ?? 'up'
  if (octaves < 1) throw new RangeError('a scale needs at least one octave')

  if (direction === 'up') return runUp(scale, o.startOctave, octaves)
  if (direction === 'down') return runDown(scale, o.startOctave, octaves)

  const up = runUp(scale, o.startOctave, octaves)
  const down = runDown(scale, o.startOctave, octaves)
  // The turnaround note is the top tonic, which both runs contain.
  return o.repeatTop ? [...up, ...down] : [...up, ...down.slice(1)]
}

export function scaleContains(scale: Scale, p: Pitch): boolean {
  const target = pitchClassNumber(p)
  return scale.degrees.some((d) => pitchClassNumber(d.pitchClass) === target)
}

export function degreeOf(scale: Scale, p: Pitch): number | null {
  const target = pitchClassNumber(p)
  const hit = scale.degrees.find((d) => pitchClassNumber(d.pitchClass) === target)
  return hit ? hit.number : null
}

/** Lowest and highest sounding pitch of a realized run. */
export function scaleRange(pitches: readonly Pitch[]): { low: Pitch; high: Pitch } {
  if (pitches.length === 0) throw new RangeError('empty scale run')
  let low = pitches[0]!
  let high = pitches[0]!
  for (const p of pitches) {
    if (toMidi(p) < toMidi(low)) low = p
    if (toMidi(p) > toMidi(high)) high = p
  }
  return { low, high }
}
