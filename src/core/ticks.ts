/**
 * The scheduling time base.
 *
 * Notated durations are exact rationals (see math/rational.ts). Ticks are the
 * integer representation those rationals convert into for scheduling, because
 * comparing and accumulating integers is both faster and impossible to drift.
 *
 * PPQ 2520 = 2^3 * 3^2 * 5 * 7, which divides evenly for everything the app can
 * notate: 32nd notes, and triplets, quintuplets and septuplets of them. The
 * conversion throws rather than rounding, so a rhythm that cannot be represented
 * exactly fails loudly at build time instead of drifting inaudibly over a few
 * bars.
 */

import { type Rational, rat, rmul } from './math/rational'

/** Pulses per quarter note. */
export const PPQ = 2520

/** Ticks in a whole note. */
export const WHOLE_NOTE_TICKS = PPQ * 4

/**
 * Branded so a tick count can never be passed where seconds are expected.
 * The brand is erased at runtime; it exists only to make the mistake a type error.
 */
export type Ticks = number & { readonly __brand: 'Ticks' }

export function ticks(n: number): Ticks {
  if (!Number.isInteger(n)) {
    throw new RangeError(`ticks must be a whole number, got ${n}`)
  }
  return n as Ticks
}

/** Convert a duration in whole notes into ticks. Throws if it is not exact. */
export function ticksFromWholeNotes(value: Rational): Ticks {
  const scaled = rmul(value, rat(WHOLE_NOTE_TICKS))
  if (scaled.d !== 1) {
    throw new RangeError(
      `duration ${value.n}/${value.d} of a whole note is not representable at PPQ ${PPQ}`,
    )
  }
  return ticks(scaled.n)
}

/** Convert ticks back into whole notes, exactly. */
export const wholeNotesFromTicks = (t: Ticks): Rational => rat(t, WHOLE_NOTE_TICKS)

export const addTicks = (a: Ticks, b: Ticks): Ticks => ticks(a + b)
export const subTicks = (a: Ticks, b: Ticks): Ticks => ticks(a - b)
export const scaleTicks = (t: Ticks, factor: number): Ticks => ticks(t * factor)
export const ZERO_TICKS = ticks(0)
