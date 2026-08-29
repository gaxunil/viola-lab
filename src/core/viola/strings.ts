/**
 * The four strings of a viola.
 *
 * Tuned in fifths, C3 G3 D4 A4 from low to high — a fifth below a violin, which
 * is why the viola reads alto clef rather than treble.
 *
 * Strings are named with Roman numerals counted from the HIGHEST string, so I is
 * the A string and IV is the C string. That ordering trips up anyone coming from
 * guitar tab, where string 1 is also the highest but the numbering is arabic and
 * the tuning is in fourths.
 */

import { type Pitch, p, toMidi } from '../pitch/pitch'

export type StringId = 'I' | 'II' | 'III' | 'IV'

export interface ViolaString {
  readonly id: StringId
  /** 0 is the highest string (I, the A string). */
  readonly index: 0 | 1 | 2 | 3
  readonly open: Pitch
  readonly openMidi: number
  /** 'A' */
  readonly letterName: string
  /** 'I (A)' */
  readonly label: string
}

function makeString(id: StringId, index: 0 | 1 | 2 | 3, open: Pitch): ViolaString {
  return {
    id,
    index,
    open,
    openMidi: toMidi(open),
    letterName: open.letter,
    label: `${id} (${open.letter})`,
  }
}

export const STRINGS: Readonly<Record<StringId, ViolaString>> = Object.freeze({
  I: makeString('I', 0, p('A4')),
  II: makeString('II', 1, p('D4')),
  III: makeString('III', 2, p('G3')),
  IV: makeString('IV', 3, p('C3')),
})

export const STRINGS_HIGH_TO_LOW: readonly ViolaString[] = [
  STRINGS.I,
  STRINGS.II,
  STRINGS.III,
  STRINGS.IV,
]

export const STRINGS_LOW_TO_HIGH: readonly ViolaString[] = [...STRINGS_HIGH_TO_LOW].reverse()

export const STRING_IDS: readonly StringId[] = ['I', 'II', 'III', 'IV']

/** The open C string. Nothing below this exists on the instrument. */
export const LOWEST_PITCH: Pitch = STRINGS.IV.open

/**
 * A practical ceiling for a high-school player. The instrument goes higher, but
 * offering scales above this is not useful for the app's purpose.
 *
 * C6 is not arbitrary: it is what the standard two-octave scales actually need.
 * Starting each key on its lowest available root, B flat major reaches B flat 5
 * and B major reaches B5, so a ceiling of A5 would wrongly report those scales
 * as not fitting on the instrument. The sample set is sized to match.
 */
export const HIGHEST_PRACTICAL: Pitch = p('C6')

export const stringAbove = (id: StringId): ViolaString | null =>
  STRINGS_HIGH_TO_LOW[STRINGS[id].index - 1] ?? null

export const stringBelow = (id: StringId): ViolaString | null =>
  STRINGS_HIGH_TO_LOW[STRINGS[id].index + 1] ?? null

/** Is this pitch within the instrument's range at all? */
export const isInRange = (pitch: Pitch, ceiling: Pitch = HIGHEST_PRACTICAL): boolean =>
  toMidi(pitch) >= toMidi(LOWEST_PITCH) && toMidi(pitch) <= toMidi(ceiling)
