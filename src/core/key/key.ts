/**
 * Keys and key signatures.
 *
 * A key is located by its position on the circle of fifths, and everything else
 * is derived from that integer: which accidentals the signature contains, in
 * which written order, and how any pitch class should be spelled in context.
 *
 * This replaces the `flats: boolean` argument that the companion slide deck
 * threaded through a dozen functions. "Should I use flats here?" is not a
 * question this module answers — it is a question the design deletes, because
 * the spelling of every note follows from the key's position on the circle.
 */

import {
  type Alteration,
  type Letter,
  type PitchClass,
  formatPitch,
  pc,
  pitchClassNumber,
} from '../pitch/pitch'
import { iv, transposeClass } from '../pitch/interval'

export type Mode = 'major' | 'minor'
export type SignatureAccidental = 'sharp' | 'flat' | 'none'

export interface KeySignature {
  /** Position on the circle of fifths: -7 (7 flats) .. +7 (7 sharps). */
  readonly fifths: number
  readonly accidental: SignatureAccidental
  /** The altered letters, in the order they are written on the staff. */
  readonly letters: readonly Letter[]
}

export interface Key {
  readonly tonic: PitchClass
  readonly mode: Mode
  readonly signature: KeySignature
  /** 'B♭ major' */
  readonly name: string
}

/** Sharps are written in this order: F C G D A E B. */
export const SHARP_ORDER: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B']

/** Flats are written in the reverse order: B E A D G C F. */
export const FLAT_ORDER: readonly Letter[] = ['B', 'E', 'A', 'D', 'G', 'C', 'F']

/** Letters ordered by their position on the circle of fifths, F = -1 .. B = +5. */
const FIFTH_LETTERS: readonly Letter[] = ['F', 'C', 'G', 'D', 'A', 'E', 'B']

/** How many fifths from C each natural letter sits. */
const LETTER_FIFTHS: Readonly<Record<Letter, number>> = {
  F: -1,
  C: 0,
  G: 1,
  D: 2,
  A: 3,
  E: 4,
  B: 5,
}

/** A minor key's tonic sits three fifths above its relative major's. */
const MINOR_OFFSET = 3

export const MIN_FIFTHS = -7
export const MAX_FIFTHS = 7

export function keySignatureForFifths(fifths: number): KeySignature {
  if (!Number.isInteger(fifths) || fifths < MIN_FIFTHS || fifths > MAX_FIFTHS) {
    throw new RangeError(`key signature out of range: ${fifths} fifths`)
  }
  if (fifths === 0) return { fifths, accidental: 'none', letters: [] }
  return fifths > 0
    ? { fifths, accidental: 'sharp', letters: SHARP_ORDER.slice(0, fifths) }
    : { fifths, accidental: 'flat', letters: FLAT_ORDER.slice(0, -fifths) }
}

/** The pitch class that sits `fifths` fifths above C. */
function tonicAtFifths(fifths: number): PitchClass {
  const idx = fifths + 1 // shift so F (-1 fifths) is index 0
  const alter = Math.floor(idx / 7)
  const letter = FIFTH_LETTERS[idx - alter * 7]
  if (letter === undefined) throw new RangeError(`bad fifths ${fifths}`)
  if (alter < -2 || alter > 2) throw new RangeError(`fifths ${fifths} needs a triple accidental`)
  return { letter, alter: alter as Alteration }
}

/** How many fifths from C a pitch class sits, unbounded (A♯ major is +10). */
export function fifthsOf(tonic: PitchClass, mode: Mode): number {
  const base = LETTER_FIFTHS[tonic.letter] + 7 * tonic.alter
  return mode === 'major' ? base : base - MINOR_OFFSET
}

function nameOf(tonic: PitchClass, mode: Mode): string {
  return `${formatPitch(tonic)} ${mode}`
}

function keyAtFifths(fifths: number, mode: Mode): Key {
  const signature = keySignatureForFifths(fifths)
  const tonic =
    mode === 'major'
      ? tonicAtFifths(fifths)
      : transposeClass(tonicAtFifths(fifths), iv('M6')) // relative minor of the major
  return { tonic, mode, signature, name: nameOf(tonic, mode) }
}

export const majorKeyAtFifths = (fifths: number): Key => keyAtFifths(fifths, 'major')
export const minorKeyAtFifths = (fifths: number): Key => keyAtFifths(fifths, 'minor')

export type KeyResult =
  | { readonly ok: true; readonly key: Key }
  | {
      readonly ok: false
      readonly reason: 'theoretical'
      readonly wouldNeedFifths: number
      /** The enharmonic key a musician would actually write instead. */
      readonly suggestion: Key
    }

/**
 * Build a key from a tonic and mode.
 *
 * Returns a failure rather than a key for theoretical keys — A♯ major needs ten
 * sharps, so the UI can offer B♭ major instead of rendering nonsense.
 */
export function keyOf(tonic: PitchClass, mode: Mode): KeyResult {
  const fifths = fifthsOf(tonic, mode)
  if (fifths >= MIN_FIFTHS && fifths <= MAX_FIFTHS) {
    const signature = keySignatureForFifths(fifths)
    return { ok: true, key: { tonic, mode, signature, name: nameOf(tonic, mode) } }
  }

  // Twelve fifths is an enharmonic round trip; step back into range.
  let alt = fifths
  while (alt > MAX_FIFTHS) alt -= 12
  while (alt < MIN_FIFTHS) alt += 12

  return {
    ok: false,
    reason: 'theoretical',
    wouldNeedFifths: fifths,
    suggestion: keyAtFifths(alt, mode),
  }
}

/** Every key a musician would actually write, from 7 flats to 7 sharps. */
export const CIRCLE_OF_FIFTHS: readonly {
  readonly fifths: number
  readonly major: Key
  readonly minor: Key
}[] = Array.from({ length: MAX_FIFTHS - MIN_FIFTHS + 1 }, (_, i) => {
  const fifths = MIN_FIFTHS + i
  return { fifths, major: majorKeyAtFifths(fifths), minor: minorKeyAtFifths(fifths) }
})

export const relativeMinor = (k: Key): Key => minorKeyAtFifths(k.signature.fifths)
export const relativeMajor = (k: Key): Key => majorKeyAtFifths(k.signature.fifths)

/** Same tonic, other mode: C major <-> C minor. Three fifths apart. */
export function parallelKey(k: Key): Key {
  const mode: Mode = k.mode === 'major' ? 'minor' : 'major'
  const shift = k.mode === 'major' ? -MINOR_OFFSET : MINOR_OFFSET
  return keyAtFifths(k.signature.fifths + shift, mode)
}

export const dominantKey = (k: Key): Key => keyAtFifths(k.signature.fifths + 1, k.mode)
export const subdominantKey = (k: Key): Key => keyAtFifths(k.signature.fifths - 1, k.mode)

/** Does this key's signature alter this letter, and by how much? */
export function signatureAlteration(letter: Letter, sig: KeySignature): Alteration {
  if (!sig.letters.includes(letter)) return 0
  return sig.accidental === 'sharp' ? 1 : -1
}

/** The seven diatonic pitch classes of a key, tonic first. */
export function diatonicPitchClasses(key: Key): PitchClass[] {
  // Start from the relative major's tonic so the letters come out in order,
  // then rotate to begin on this key's own tonic.
  const start = key.mode === 'major' ? key.tonic : relativeMajor(key).tonic
  const letters: PitchClass[] = []
  const order: Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
  const from = order.indexOf(start.letter)
  for (let i = 0; i < 7; i++) {
    const letter = order[(from + i) % 7]
    if (letter === undefined) throw new RangeError('bad letter rotation')
    letters.push(pc(letter, signatureAlteration(letter, key.signature)))
  }

  if (key.mode === 'major') return letters
  // Minor starts on the sixth degree of its relative major.
  return [...letters.slice(5), ...letters.slice(0, 5)]
}

/**
 * Spell a sounding pitch class in the context of a key.
 *
 * Diatonic notes take their spelling from the signature. Chromatic notes are
 * spelled in the direction the key already leans — a raised fourth in a sharp
 * key, a lowered sixth in a flat key — which is what a player expects to read.
 */
export function spellPitchClassInKey(pcNumber: number, key: Key): PitchClass {
  const target = ((pcNumber % 12) + 12) % 12

  const diatonic = diatonicPitchClasses(key)
  for (const candidate of diatonic) {
    if (pitchClassNumber(candidate) === target) return candidate
  }

  // Chromatic: consider every plausible spelling and pick the most idiomatic.
  const order: Letter[] = ['C', 'D', 'E', 'F', 'G', 'A', 'B']
  const leansFlat = key.signature.fifths < 0
  let best: { candidate: PitchClass; score: number } | null = null

  for (const letter of order) {
    for (const alter of [-2, -1, 0, 1, 2] as const) {
      const candidate = pc(letter, alter)
      if (pitchClassNumber(candidate) !== target) continue

      // Lower is better: simple accidentals first, then the direction the key leans.
      let score = Math.abs(alter) * 10
      if (leansFlat && alter > 0) score += 5
      if (!leansFlat && alter < 0) score += 5

      if (best === null || score < best.score) best = { candidate, score }
    }
  }

  if (best === null) throw new RangeError(`cannot spell pitch class ${pcNumber}`)
  return best.candidate
}

