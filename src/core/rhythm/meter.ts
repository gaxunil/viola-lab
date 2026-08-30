/**
 * Time signatures, as something richer than a pair of numbers.
 *
 * A meter is not {numerator, denominator}. Knowing that 12/8 has four DOTTED
 * QUARTER beats grouped 3+3+3+3, and that 7/8 is usually felt 2+2+3, is the
 * difference between an app that can teach compound time and one that can only
 * count eighth notes.
 *
 * Accents are derived from the grouping by a single rule — first pulse of the
 * bar is strong, first pulse of any later group is medium, everything else is
 * weak — which produces the correct pattern for simple, compound and asymmetric
 * meters without a special case for any of them.
 */

import { type Rational, rat, rmul } from '../math/rational'
import { type Ticks, ticksFromWholeNotes } from '../ticks'
import { type Duration, type NoteValue, dur } from './duration'

export type MeterClass = 'simple' | 'compound' | 'asymmetric'
export type AccentLevel = 'strong' | 'medium' | 'weak'
export type Denominator = 1 | 2 | 4 | 8 | 16

export interface Meter {
  readonly numerator: number
  readonly denominator: Denominator
  readonly class: MeterClass
  /** Felt beats per bar: 12/8 is 4, not 12. */
  readonly beats: number
  /** What one felt beat looks like: a dotted quarter in 12/8. */
  readonly beatUnit: Duration
  readonly beatValue: Rational
  /** Grouping in denominator units. 12/8 -> [3,3,3,3]; 7/8 -> [2,2,3]. Sums to the numerator. */
  readonly grouping: readonly number[]
  /** One entry per felt beat, aligned with the grouping. */
  readonly accents: readonly AccentLevel[]
  readonly barValue: Rational
  readonly barTicks: Ticks
  /** Ticks in one notated pulse (one eighth in x/8). */
  readonly pulseTicks: Ticks
  readonly label: string
  /**
   * Plain language, for someone who is fluent on the instrument but new to
   * theory: "four beats, each split into three". The point of a meter is how it
   * is COUNTED, and that sentence says it without requiring the vocabulary.
   */
  readonly description: string
  /** The textbook name — 'compound quadruple'. Correct, but not an explanation. */
  readonly formalName: string
}

const DENOMINATOR_VALUE: Readonly<Record<Denominator, NoteValue>> = {
  1: 'whole',
  2: 'half',
  4: 'quarter',
  8: 'eighth',
  16: 'sixteenth',
}

/**
 * Compound meters are those whose beats subdivide in three: 6/8, 9/8, 12/8.
 * 3/8 is deliberately excluded — it is felt as three eighths, not one beat.
 */
function classifyDefault(numerator: number, denominator: Denominator): MeterClass {
  if (denominator >= 8 && numerator % 3 === 0 && numerator > 3) return 'compound'
  if (denominator >= 8 && numerator >= 5 && numerator % 3 !== 0) return 'asymmetric'
  return 'simple'
}

/**
 * The class of a meter once its grouping is known. An unequal grouping makes a
 * meter asymmetric whatever its numbers say, so 5/4 grouped 3+2 is asymmetric
 * even though plain 5/4 counted in five is not.
 */
function classifyWithGrouping(
  numerator: number,
  denominator: Denominator,
  grouping: readonly number[],
): MeterClass {
  const uniform = grouping.every((g) => g === grouping[0])
  if (!uniform) return 'asymmetric'
  return classifyDefault(numerator, denominator)
}

/** The grouping a musician would assume if none is specified. */
export function defaultGrouping(numerator: number, denominator: Denominator): number[] {
  const cls = classifyDefault(numerator, denominator)

  if (cls === 'compound') return Array.from({ length: numerator / 3 }, () => 3)

  if (cls === 'asymmetric') {
    switch (numerator) {
      case 5:
        return [3, 2]
      case 7:
        return [2, 2, 3]
      case 8:
        return [3, 3, 2]
      case 11:
        return [3, 3, 3, 2]
      default:
        return Array.from({ length: numerator }, () => 1)
    }
  }

  return Array.from({ length: numerator }, () => 1)
}

/** Numerators that a player might reasonably group unevenly. */
const ASYMMETRIC_CANDIDATES = new Set([5, 7, 8, 11])

/**
 * Alternative groupings the UI can offer.
 *
 * 7/8 as 2+2+3 versus 3+2+2 is a genuine musical choice that changes where the
 * bar leans, not a formatting preference — so it belongs in front of the player.
 */
export function groupingOptions(
  numerator: number,
  denominator: Denominator,
): readonly (readonly number[])[] {
  const base = defaultGrouping(numerator, denominator)
  if (!ASYMMETRIC_CANDIDATES.has(numerator)) return [base]

  const ALTERNATIVES: Readonly<Record<number, readonly (readonly number[])[]>> = {
    5: [[3, 2], [2, 3]],
    7: [[2, 2, 3], [3, 2, 2], [2, 3, 2]],
    8: [[3, 3, 2], [3, 2, 3], [2, 3, 3]],
    11: [[3, 3, 3, 2], [3, 3, 2, 3]],
  }

  const seen = new Set<string>([base.join('+')])
  const out: (readonly number[])[] = [base]
  for (const option of ALTERNATIVES[numerator] ?? []) {
    const key = option.join('+')
    if (seen.has(key)) continue
    seen.add(key)
    out.push(option)
  }
  return out
}

/**
 * Derive the accent pattern from the grouping.
 *
 * Three cases, and they are all real music rather than convenience:
 *
 *   - The downbeat is always strongest.
 *   - A meter of four or more EQUAL beats has a secondary accent at its
 *     midpoint. This is why 4/4 is felt ONE two THREE four, and why 12/8 —
 *     which is 4/4 with every beat split in three — is felt the same way.
 *   - When the groups are UNEQUAL (7/8 as 2+2+3), every group start is an
 *     accent in its own right, because the groups are what the listener is
 *     counting.
 */
export function accentsFor(grouping: readonly number[]): AccentLevel[] {
  const beats = grouping.length
  const uniform = grouping.every((g) => g === grouping[0])

  return grouping.map((_, i) => {
    if (i === 0) return 'strong'
    if (!uniform) return 'medium'
    if (beats >= 4 && beats % 2 === 0 && i === beats / 2) return 'medium'
    return 'weak'
  })
}

const COUNT_WORD = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight']
const FORMAL_COUNT = ['', 'single', 'duple', 'triple', 'quadruple', 'quintuple', 'sextuple']

/**
 * How the bar is counted, in words rather than terminology.
 *
 * A compound meter's whole character is that its beats divide in three, and an
 * asymmetric meter's is that its groups are uneven — so those are what the
 * sentence leads with.
 */
function describe(cls: MeterClass, beats: number, grouping: readonly number[]): string {
  const count = COUNT_WORD[beats] ?? `${beats}`

  // Compound meters are the case where the beat unit is genuinely surprising:
  // the bar is written in eighths but counted in dotted quarters, and the tempo
  // follows the dotted quarter. Saying so is the whole lesson.
  if (cls === 'compound') return `${count} dotted beats, each split into three`
  if (cls === 'asymmetric') return `uneven beats, grouped ${grouping.join(' + ')}`
  if (beats === 1) return 'one beat in the bar'
  return `${count} beats, each split into two`
}

/** The textbook name, kept for anyone who wants it. */
function formalNameFor(cls: MeterClass, beats: number): string {
  if (cls === 'asymmetric') return 'asymmetric'
  const count = FORMAL_COUNT[beats] ?? `${beats}-beat`
  return `${cls} ${count}`
}

export interface MeterOptions {
  readonly grouping?: readonly number[]
}

export function meter(
  numerator: number,
  denominator: Denominator,
  o: MeterOptions = {},
): Meter {
  if (!Number.isInteger(numerator) || numerator < 1) {
    throw new RangeError(`meter numerator must be a positive integer, got ${numerator}`)
  }

  const grouping = o.grouping ?? defaultGrouping(numerator, denominator)
  const cls = classifyWithGrouping(numerator, denominator, grouping)

  const groupSum = grouping.reduce((a, b) => a + b, 0)
  if (groupSum !== numerator) {
    throw new RangeError(
      `grouping [${grouping.join(',')}] sums to ${groupSum}, but the meter has ${numerator} pulses`,
    )
  }

  const pulseValue = rat(1, denominator)
  const barValue = rmul(pulseValue, rat(numerator))
  const beats = grouping.length

  // In compound and asymmetric time the felt beat is a group, not a pulse.
  const uniformGroup = grouping.every((g) => g === grouping[0])
  const groupSize = grouping[0] ?? 1
  const beatUnit: Duration =
    cls === 'compound' && uniformGroup && groupSize === 3
      ? dur(DENOMINATOR_VALUE[denominator === 16 ? 8 : denominator === 8 ? 4 : 2], 1)
      : dur(DENOMINATOR_VALUE[denominator], 0)

  const beatValue = rmul(pulseValue, rat(uniformGroup ? groupSize : 1))

  return {
    numerator,
    denominator,
    class: cls,
    beats,
    beatUnit,
    beatValue,
    grouping,
    accents: accentsFor(grouping),
    barValue,
    barTicks: ticksFromWholeNotes(barValue),
    pulseTicks: ticksFromWholeNotes(pulseValue),
    label: `${numerator}/${denominator}`,
    description: describe(cls, beats, grouping),
    formalName: formalNameFor(cls, beats),
  }
}

/** Tick offset of the start of each felt beat, from the bar line. */
export function beatOnsets(m: Meter): Ticks[] {
  const out: Ticks[] = []
  let pulse = 0
  for (const group of m.grouping) {
    out.push((pulse * m.pulseTicks) as Ticks)
    pulse += group
  }
  return out
}

/** Tick offset of every notated pulse — the subdivision grid. */
export function subdivisionOnsets(m: Meter): Ticks[] {
  return Array.from({ length: m.numerator }, (_, i) => (i * m.pulseTicks) as Ticks)
}

/** Which felt beat a tick offset falls in, and how far into it. */
export function beatAt(m: Meter, tick: number): { beat: number; offsetTicks: number } {
  const onsets = beatOnsets(m)
  let beat = 0
  for (let i = 0; i < onsets.length; i++) {
    if (tick >= (onsets[i] ?? 0)) beat = i
    else break
  }
  return { beat, offsetTicks: tick - (onsets[beat] ?? 0) }
}

export const COMMON_METERS: readonly Meter[] = [
  meter(4, 4),
  meter(3, 4),
  meter(2, 4),
  meter(2, 2),
  meter(6, 8),
  meter(9, 8),
  meter(12, 8),
  meter(5, 4),
  meter(5, 8),
  meter(7, 8),
]
