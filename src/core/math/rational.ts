/**
 * Exact non-negative rational arithmetic on small integers.
 *
 * This module knows nothing about music. It exists so that note durations are
 * exact: a double-dotted half is 7/8, not 0.875, and "do these events fill the
 * bar?" is a decidable equality rather than a float comparison with an epsilon.
 *
 * The numbers involved stay small — denominators are products of 2s, 3s, 5s and
 * 7s from note values and tuplets — so overflow is not a practical concern.
 */

/** Always normalized: gcd(n, d) === 1 and d > 0. Construct only via `rat`. */
export interface Rational {
  readonly n: number
  readonly d: number
}

function gcd(a: number, b: number): number {
  a = Math.abs(a)
  b = Math.abs(b)
  while (b !== 0) {
    const t = b
    b = a % b
    a = t
  }
  return a
}

/** Construct a normalized rational. Throws on a zero denominator or non-integers. */
export function rat(n: number, d = 1): Rational {
  if (!Number.isInteger(n) || !Number.isInteger(d)) {
    throw new RangeError(`rational parts must be integers, got ${n}/${d}`)
  }
  if (d === 0) throw new RangeError('rational denominator must not be zero')

  // Normalize the sign onto the numerator so equality is structural.
  if (d < 0) {
    n = -n
    d = -d
  }
  const g = gcd(n, d) || 1
  return { n: n / g, d: d / g }
}

export const ZERO: Rational = { n: 0, d: 1 }
export const ONE: Rational = { n: 1, d: 1 }

export const radd = (a: Rational, b: Rational): Rational => rat(a.n * b.d + b.n * a.d, a.d * b.d)
export const rsub = (a: Rational, b: Rational): Rational => rat(a.n * b.d - b.n * a.d, a.d * b.d)
export const rmul = (a: Rational, b: Rational): Rational => rat(a.n * b.n, a.d * b.d)

export function rdiv(a: Rational, b: Rational): Rational {
  if (b.n === 0) throw new RangeError('division by zero rational')
  return rat(a.n * b.d, a.d * b.n)
}

export function rcmp(a: Rational, b: Rational): -1 | 0 | 1 {
  const l = a.n * b.d
  const r = b.n * a.d
  return l < r ? -1 : l > r ? 1 : 0
}

export const req = (a: Rational, b: Rational): boolean => a.n === b.n && a.d === b.d
export const rsum = (xs: readonly Rational[]): Rational => xs.reduce(radd, ZERO)
export const isZero = (r: Rational): boolean => r.n === 0

/**
 * Convert to a float. This is a lossy boundary: call it when handing a value to
 * the audio clock or the DOM, never in the middle of a calculation.
 */
export const toNumber = (r: Rational): number => r.n / r.d

export const formatRational = (r: Rational): string => (r.d === 1 ? `${r.n}` : `${r.n}/${r.d}`)
