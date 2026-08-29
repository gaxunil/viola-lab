/**
 * Staff positions: which line or space a note sits on, and whether its
 * accidental is actually printed.
 *
 * Nothing here knows about pixels, SVG or VexFlow. The unit is the `staffStep`:
 * a count of lines-and-spaces upward from the bottom line of the staff, so 0 is
 * the bottom line, 1 the space above it, 2 the next line up, and 8 the top line.
 * Even steps are lines, odd steps are spaces, and negative steps run below the
 * staff. A renderer turns steps into y coordinates by multiplying; that is the
 * only thing it has to know.
 *
 * Why steps and not semitones: staff height follows the *letter* of a note, not
 * its sound. F and F sharp are printed on the same line — the sharp is a symbol
 * placed in front, not a different position. So every position question is
 * answered from the diatonic axis alone (`diatonicIndex`), and accidentals are
 * handled separately.
 */

import {
  type Alteration,
  type Letter,
  type Pitch,
  LETTER_STEP,
  diatonicIndex,
  p,
} from '../pitch/pitch'
import { type Key, type KeySignature, signatureAlteration } from '../key/key'

/**
 * A clef says which pitch the bottom line stands for; everything else follows.
 * Viola music is written in alto clef, which is why it is the primary case here.
 */
export type Clef = 'alto' | 'treble' | 'bass'

export type AccidentalGlyph = '♯' | '♭' | '♮' | '𝄪' | '𝄫'

export interface NotatedNote {
  readonly pitch: Pitch
  /** 0 = bottom line, +1 per line-or-space upward, negative = below the staff. */
  readonly staffStep: number
  /** null means "do not print" — the key signature already covers this note. */
  readonly accidental: AccidentalGlyph | null
  /** staffStep values that need a ledger line drawn, nearest the staff first. */
  readonly ledgerLines: readonly number[]
  readonly stemDirection: 'up' | 'down'
}

/**
 * The pitch each clef puts on the bottom line of the five-line staff.
 *
 * Alto clef is the C clef centred on the middle line, so middle C lands on the
 * middle line and the bottom line is the F below it. That single fact is what
 * makes alto clef worth the trouble for a viola: the instrument's range sits
 * almost entirely inside the staff instead of hanging off the bottom of treble
 * or the top of bass.
 */
export const CLEF_BOTTOM_LINE: Readonly<Record<Clef, Pitch>> = {
  alto: p('F3'),
  treble: p('E4'),
  bass: p('G2'),
}

/** The top line of a five-line staff. */
const TOP_LINE_STEP = 8

/** The middle line. Notes from here upward get down-stems. */
const MIDDLE_LINE_STEP = 4

/**
 * How far above the clef's bottom line this note sits, counting lines and
 * spaces. Purely diatonic: F3 and F sharp 3 both give 0 in alto clef.
 */
export const staffStep = (pitch: Pitch, clef: Clef): number =>
  diatonicIndex(pitch) - diatonicIndex(CLEF_BOTTOM_LINE[clef])

/**
 * Which ledger lines a note needs.
 *
 * Ledger lines extend the staff for notes that run off it, but they are *lines*,
 * so they only ever appear at even steps. A note sitting in the space directly
 * below the staff (step -1) hangs in open air and needs none. A note on the
 * first line below (step -2) needs that one line. A note two lines below
 * (step -4) needs both -2 and -4, because ledger lines are drawn as an unbroken
 * ladder out from the staff rather than one isolated stroke.
 *
 * Returned nearest-the-staff first, which is the order a renderer draws them in.
 */
export function ledgerLinesFor(step: number): number[] {
  const lines: number[] = []
  for (let s = -2; s >= step; s -= 2) lines.push(s)
  for (let s = TOP_LINE_STEP + 2; s <= step; s += 2) lines.push(s)
  return lines
}

/**
 * Stems point back toward the middle of the staff so they stay inside it: notes
 * on or above the middle line get stems hanging down, notes below get stems
 * going up. The middle line itself is the conventional tie-break and goes down.
 */
export const stemDirectionFor = (step: number): 'up' | 'down' =>
  step >= MIDDLE_LINE_STEP ? 'down' : 'up'

const GLYPH: Readonly<Record<Alteration, AccidentalGlyph>> = {
  [-2]: '𝄫',
  [-1]: '♭',
  0: '♮',
  1: '♯',
  2: '𝄪',
}

export interface SignatureGlyph {
  readonly letter: Letter
  readonly staffStep: number
  readonly glyph: '♯' | '♭'
}

/**
 * The lowest staffStep a key-signature glyph may occupy, per clef and per kind
 * of accidental. Each band is exactly seven steps tall, so it admits exactly one
 * octave of each letter — that is what fixes the octave of every glyph.
 *
 * The bands are not derived from anything; they are the engraving convention,
 * which puts key signatures in a compact block near the top of the staff rather
 * than wherever the arithmetic falls. Sharps sit one step higher than flats
 * because the sharp block is traditionally allowed to poke one step above the
 * top line (the famous G sharp floating above the treble staff), while flats
 * are never written below the bottom line.
 *
 * The three clefs are the same shape shifted: alto sits one step below treble
 * and bass one step below alto, except that the bass flats are pushed back up so
 * the last flat (F flat, only in C flat major) stays on the staff.
 */
const SIGNATURE_BAND_BOTTOM: Readonly<Record<Clef, Readonly<Record<'sharp' | 'flat', number>>>> = {
  treble: { sharp: 3, flat: 1 },
  alto: { sharp: 2, flat: 0 },
  bass: { sharp: 1, flat: 0 },
}

const mod7 = (n: number): number => ((n % 7) + 7) % 7

/** The one staffStep for this letter that falls inside a seven-step band. */
function letterStepInBand(letter: Letter, clef: Clef, bandBottom: number): number {
  const fromBottomLine = mod7(LETTER_STEP[letter] - diatonicIndex(CLEF_BOTTOM_LINE[clef]))
  return bandBottom + mod7(fromBottomLine - bandBottom)
}

/**
 * Where each accidental of a key signature is written, in the order it is
 * written. The letters and their order come from the signature itself (sharps
 * always F C G D A E B, flats always B E A D G C F); this only decides height.
 */
export function keySignatureGlyphs(sig: KeySignature, clef: Clef): SignatureGlyph[] {
  if (sig.accidental === 'none') return []
  const glyph = sig.accidental === 'sharp' ? '♯' : '♭'
  const bandBottom = SIGNATURE_BAND_BOTTOM[clef][sig.accidental]
  return sig.letters.map((letter) => ({
    letter,
    staffStep: letterStepInBand(letter, clef, bandBottom),
    glyph,
  }))
}

export interface NotateOptions {
  /** Indices at which a new bar starts, which is where accidentals stop holding. */
  readonly barBoundaries?: readonly number[]
}

/**
 * Turn a run of pitches into printable notes.
 *
 * The interesting part is deciding when an accidental appears. Written music
 * does not restate what is already true: a sharp is printed only when the note
 * differs from what is currently in force for its letter. What is in force is
 * the key signature — in F sharp major every F is sharp without being marked —
 * unless an accidental has already been printed on that letter earlier in the
 * same bar, in which case that accidental holds for the rest of the bar. A
 * natural sign is just the same rule seen from the other side: it is printed
 * when the note is unaltered but something would otherwise have altered it.
 *
 * The memory is keyed by letter alone, not by letter and octave. Strict
 * engraving would re-mark an accidental in a different octave; ignoring the
 * octave matches how players actually read and keeps the rule teachable.
 *
 * Barlines are given as `barBoundaries`, the indices where a new bar starts,
 * because this module is handed a flat run of pitches and has no other way to
 * know where the memory should be wiped.
 */
export function notate(
  pitches: readonly Pitch[],
  key: Key,
  clef: Clef,
  o: NotateOptions = {},
): NotatedNote[] {
  const boundaries = new Set(o.barBoundaries ?? [])
  const printedThisBar = new Map<Letter, Alteration>()

  return pitches.map((pitch, i) => {
    if (i === 0 || boundaries.has(i)) printedThisBar.clear()

    const inForce =
      printedThisBar.get(pitch.letter) ?? signatureAlteration(pitch.letter, key.signature)
    const prints = pitch.alter !== inForce
    if (prints) printedThisBar.set(pitch.letter, pitch.alter)

    const step = staffStep(pitch, clef)
    return {
      pitch,
      staffStep: step,
      accidental: prints ? GLYPH[pitch.alter] : null,
      ledgerLines: ledgerLinesFor(step),
      stemDirection: stemDirectionFor(step),
    }
  })
}
