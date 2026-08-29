/**
 * Notated durations: note values, dots, and tuplets.
 *
 * Every duration resolves to an exact rational fraction of a whole note. A
 * dotted quarter is 3/8, not 0.375, and a double-dotted half is 7/8. That
 * exactness is what lets `validateBar` be a decidable equality rather than a
 * float comparison with a tolerance.
 */

import { type Rational, radd, rat, rmul, rsub, rsum } from '../math/rational'

export type NoteValue =
  | 'whole'
  | 'half'
  | 'quarter'
  | 'eighth'
  | 'sixteenth'
  | 'thirtysecond'

export type Dots = 0 | 1 | 2

/** "actual in the time of normal": a triplet is three in the time of two. */
export interface Tuplet {
  readonly actual: number
  readonly normal: number
}

export interface Duration {
  readonly base: NoteValue
  readonly dots: Dots
  readonly tuplet?: Tuplet
}

export const NOTE_VALUE_WHOLES: Readonly<Record<NoteValue, Rational>> = {
  whole: rat(1, 1),
  half: rat(1, 2),
  quarter: rat(1, 4),
  eighth: rat(1, 8),
  sixteenth: rat(1, 16),
  thirtysecond: rat(1, 32),
}

export const NOTE_VALUE_ORDER: readonly NoteValue[] = [
  'whole',
  'half',
  'quarter',
  'eighth',
  'sixteenth',
  'thirtysecond',
]

export const TRIPLET: Tuplet = { actual: 3, normal: 2 }
export const QUINTUPLET: Tuplet = { actual: 5, normal: 4 }
export const SEPTUPLET: Tuplet = { actual: 7, normal: 4 }

export function dur(base: NoteValue, dots: Dots = 0, tuplet?: Tuplet): Duration {
  return tuplet === undefined ? { base, dots } : { base, dots, tuplet }
}

/**
 * Dots add half the preceding value each time: one dot is 3/2, two is 7/4.
 * In general (2^(d+1) - 1) / 2^d.
 */
function dotFactor(dots: Dots): Rational {
  const denominator = 2 ** dots
  return rat(2 * denominator - 1, denominator)
}

/** The exact value of a duration, as a fraction of a whole note. */
export function durationValue(d: Duration): Rational {
  let value = rmul(NOTE_VALUE_WHOLES[d.base], dotFactor(d.dots))
  if (d.tuplet) {
    if (d.tuplet.actual <= 0 || d.tuplet.normal <= 0) {
      throw new RangeError('tuplet ratio must be positive')
    }
    value = rmul(value, rat(d.tuplet.normal, d.tuplet.actual))
  }
  return value
}

const VALUE_NAME: Readonly<Record<NoteValue, string>> = {
  whole: 'whole note',
  half: 'half note',
  quarter: 'quarter note',
  eighth: 'eighth note',
  sixteenth: 'sixteenth note',
  thirtysecond: 'thirty-second note',
}

const DOT_NAME: Readonly<Record<Dots, string>> = {
  0: '',
  1: 'dotted ',
  2: 'double-dotted ',
}

const TUPLET_NAME = new Map<string, string>([
  ['3:2', 'triplet'],
  ['5:4', 'quintuplet'],
  ['6:4', 'sextuplet'],
  ['7:4', 'septuplet'],
])

export function formatDuration(d: Duration): string {
  const head = `${DOT_NAME[d.dots]}${VALUE_NAME[d.base]}`
  if (!d.tuplet) return head
  const key = `${d.tuplet.actual}:${d.tuplet.normal}`
  const label = TUPLET_NAME.get(key) ?? `${d.tuplet.actual}-in-${d.tuplet.normal}`
  return `${head} ${label}`
}

const lessOrEqual = (a: Rational, b: Rational): boolean => a.n * b.d <= b.n * a.d
const greaterThan = (a: Rational, b: Rational): boolean => a.n * b.d > b.n * a.d

function largestFitting(remaining: Rational): Duration | null {
  let best: { d: Duration; value: Rational } | null = null

  for (const base of NOTE_VALUE_ORDER) {
    for (const dots of [2, 1, 0] as const) {
      const candidate = dur(base, dots)
      const value = durationValue(candidate)
      if (!lessOrEqual(value, remaining)) continue
      if (best === null || greaterThan(value, best.value)) best = { d: candidate, value }
    }
  }
  return best ? best.d : null
}

/**
 * Break an arbitrary value into notated durations, largest first.
 *
 * Used to describe what a short bar is missing ("short by a dotted quarter")
 * rather than reporting a bare fraction at the player.
 */
export function decompose(value: Rational): Duration[] {
  const out: Duration[] = []
  let remaining = value

  while (remaining.n > 0) {
    const next = largestFitting(remaining)
    if (next === null) break // not expressible in plain dotted values
    out.push(next)
    remaining = rsub(remaining, durationValue(next))
  }
  return out
}

export const sumDurations = (ds: readonly Duration[]): Rational => rsum(ds.map(durationValue))

/** Convenience for building tied values, e.g. a half tied to an eighth. */
export const addDurations = (a: Duration, b: Duration): Rational =>
  radd(durationValue(a), durationValue(b))
