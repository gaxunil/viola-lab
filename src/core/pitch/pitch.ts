/**
 * Pitches, spelled.
 *
 * The central idea of this codebase: a note is a point in TWO-dimensional space.
 *
 *   - the diatonic axis  — letter + octave, i.e. which line or space on the staff
 *   - the chromatic axis — the MIDI number, i.e. which pitch actually sounds
 *
 * The accidental is not an independent fact; it is the *discrepancy* between the
 * two axes. Keeping both means correct spelling falls out of ordinary arithmetic
 * instead of needing a table of special cases: transposing up a major third from
 * C always lands on some kind of E, and the alteration is whatever it takes to
 * make the sounding pitch come out right.
 *
 * There is deliberately no `fromMidi()`. A MIDI number alone cannot be spelled —
 * 61 is C sharp in D major and D flat in A flat major. Spelling requires a key,
 * so it lives in `key/key.ts`.
 */

export type Letter = 'C' | 'D' | 'E' | 'F' | 'G' | 'A' | 'B'

/** Semitone displacement from the natural letter. -2 = double flat, +2 = double sharp. */
export type Alteration = -2 | -1 | 0 | 1 | 2

/** A spelled note without an octave. B flat and A sharp are different PitchClasses. */
export interface PitchClass {
  readonly letter: Letter
  readonly alter: Alteration
}

/** A spelled note with an octave, in scientific pitch notation (C4 = middle C = MIDI 60). */
export interface Pitch {
  readonly letter: Letter
  readonly alter: Alteration
  readonly octave: number
}

export const LETTER_ORDER: readonly Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']

/** Position of each letter within an octave, 0..6. The diatonic axis. */
export const LETTER_STEP: Readonly<Record<Letter, number>> = {
  C: 0,
  D: 1,
  E: 2,
  F: 3,
  G: 4,
  A: 5,
  B: 6,
}

/** Semitones above C for each natural letter. The chromatic axis. */
export const LETTER_SEMITONE: Readonly<Record<Letter, number>> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
}

export function pitch(letter: Letter, alter: Alteration, octave: number): Pitch {
  return { letter, alter, octave }
}

export function pc(letter: Letter, alter: Alteration = 0): PitchClass {
  return { letter, alter }
}

export const withOctave = (k: PitchClass, octave: number): Pitch => ({ ...k, octave })
export const classOf = (p: Pitch): PitchClass => ({ letter: p.letter, alter: p.alter })

/**
 * The diatonic axis: monotonic in staff height, ignoring accidentals.
 * C4 -> 4 * 7 + 0 = 28. Every staff position maps to exactly one value.
 */
export const diatonicIndex = (p: Pitch): number => p.octave * 7 + LETTER_STEP[p.letter]

export function fromDiatonicIndex(di: number, alter: Alteration): Pitch {
  const octave = Math.floor(di / 7)
  const step = di - octave * 7
  const letter = LETTER_ORDER[step]
  // Unreachable: step is 0..6 by construction, but the index signature is
  // possibly-undefined under noUncheckedIndexedAccess.
  if (letter === undefined) throw new RangeError(`bad diatonic step ${step}`)
  return { letter, alter, octave }
}

/** The chromatic axis. C4 = 60. */
export const toMidi = (p: Pitch): number =>
  (p.octave + 1) * 12 + LETTER_SEMITONE[p.letter] + p.alter

/** Pitch class number 0..11, where C = 0. */
export function pitchClassNumber(p: Pitch | PitchClass): number {
  const raw = LETTER_SEMITONE[p.letter] + p.alter
  return ((raw % 12) + 12) % 12
}

/** Spelling-identical: B flat and A sharp are NOT the same pitch. */
export const samePitch = (a: Pitch, b: Pitch): boolean =>
  a.letter === b.letter && a.alter === b.alter && a.octave === b.octave

export const samePitchClass = (a: PitchClass, b: PitchClass): boolean =>
  a.letter === b.letter && a.alter === b.alter

/** Same sounding pitch, whatever the spelling. */
export const enharmonic = (a: Pitch, b: Pitch): boolean => toMidi(a) === toMidi(b)

/** Order by sound, then by staff position, so B sharp 3 sorts below C4. */
export function comparePitch(a: Pitch, b: Pitch): -1 | 0 | 1 {
  const am = toMidi(a)
  const bm = toMidi(b)
  if (am !== bm) return am < bm ? -1 : 1
  const ad = diatonicIndex(a)
  const bd = diatonicIndex(b)
  return ad < bd ? -1 : ad > bd ? 1 : 0
}

export const A4_HZ = 440

export const toFrequency = (p: Pitch, a4Hz: number = A4_HZ): number =>
  a4Hz * Math.pow(2, (toMidi(p) - 69) / 12)

export type AccidentalStyle = 'unicode' | 'ascii'

const UNICODE_ACCIDENTAL: Readonly<Record<Alteration, string>> = {
  [-2]: '\u{1D12B}', // double flat
  [-1]: '♭', // flat
  0: '',
  1: '♯', // sharp
  2: '\u{1D12A}', // double sharp
}

const ASCII_ACCIDENTAL: Readonly<Record<Alteration, string>> = {
  [-2]: 'bb',
  [-1]: 'b',
  0: '',
  1: '#',
  2: '##',
}

export interface FormatOptions {
  readonly style?: AccidentalStyle
  readonly octave?: boolean
}

export function formatPitch(p: Pitch | PitchClass, o: FormatOptions = {}): string {
  const style = o.style ?? 'unicode'
  const table = style === 'ascii' ? ASCII_ACCIDENTAL : UNICODE_ACCIDENTAL
  const head = p.letter + table[p.alter]
  const showOctave = o.octave ?? 'octave' in p
  return showOctave && 'octave' in p ? `${head}${p.octave}` : head
}

const ACCIDENTAL_TOKENS: ReadonlyArray<readonly [string, Alteration]> = [
  ['\u{1D12A}', 2],
  ['\u{1D12B}', -2],
  ['##', 2],
  ['bb', -2],
  ['♯♯', 2],
  ['♭♭', -2],
  ['x', 2],
  ['#', 1],
  ['♯', 1],
  ['b', -1],
  ['♭', -1],
]

function parseHead(s: string): { letter: Letter; alter: Alteration; rest: string } {
  const head = s.charAt(0).toUpperCase()
  if (!(head in LETTER_STEP)) throw new SyntaxError(`bad note letter in "${s}"`)
  const letter = head as Letter

  let rest = s.slice(1)
  let alter: Alteration = 0
  for (const [token, value] of ACCIDENTAL_TOKENS) {
    if (rest.startsWith(token)) {
      alter = value
      rest = rest.slice(token.length)
      break
    }
  }
  return { letter, alter, rest }
}

/** Parse 'Eb4', 'E♭4', 'F##3', 'F𝄪3', 'Cb-1'. */
export function parsePitch(s: string): Pitch {
  const { letter, alter, rest } = parseHead(s.trim())
  if (!/^-?\d+$/.test(rest)) throw new SyntaxError(`missing or bad octave in "${s}"`)
  return { letter, alter, octave: Number(rest) }
}

/** Parse 'Eb', 'F##' — no octave. */
export function parsePitchClass(s: string): PitchClass {
  const { letter, alter, rest } = parseHead(s.trim())
  if (rest !== '') throw new SyntaxError(`unexpected trailing "${rest}" in "${s}"`)
  return { letter, alter }
}

/** Terse alias for tests and data tables: p('Eb4'). */
export const p = parsePitch
