import { describe, expect, it } from 'vitest'
import { p } from '../pitch/pitch'
import { keySignatureForFifths, majorKeyAtFifths } from '../key/key'
import {
  CLEF_BOTTOM_LINE,
  keySignatureGlyphs,
  ledgerLinesFor,
  notate,
  staffStep,
  stemDirectionFor,
} from './staff'

const C_MAJOR = majorKeyAtFifths(0)
const G_MAJOR = majorKeyAtFifths(1)
const F_SHARP_MAJOR = majorKeyAtFifths(6)

const steps = (glyphs: readonly { readonly staffStep: number }[]) => glyphs.map((g) => g.staffStep)
const accidentals = (notes: readonly { readonly accidental: string | null }[]) =>
  notes.map((n) => n.accidental)

describe('staff positions', () => {
  it('puts middle C on the middle line in alto clef', () => {
    expect(staffStep(p('C4'), 'alto')).toBe(4)
  })

  it('puts each clef’s own reference pitch on the bottom line', () => {
    expect(staffStep(CLEF_BOTTOM_LINE.alto, 'alto')).toBe(0)
    expect(staffStep(CLEF_BOTTOM_LINE.treble, 'treble')).toBe(0)
    expect(staffStep(CLEF_BOTTOM_LINE.bass, 'bass')).toBe(0)
  })

  it('names F3, E4 and G2 as the bottom lines of alto, treble and bass', () => {
    expect(CLEF_BOTTOM_LINE.alto).toEqual(p('F3'))
    expect(CLEF_BOTTOM_LINE.treble).toEqual(p('E4'))
    expect(CLEF_BOTTOM_LINE.bass).toEqual(p('G2'))
  })

  it('places the viola’s open strings on alternating spaces in alto clef', () => {
    // C3 sits below the staff, the other three land on spaces 1, 3 and 5.
    expect(staffStep(p('C3'), 'alto')).toBe(-3)
    expect(staffStep(p('G3'), 'alto')).toBe(1)
    expect(staffStep(p('D4'), 'alto')).toBe(5)
    expect(staffStep(p('A4'), 'alto')).toBe(9)
  })

  it('ignores the accidental when placing a note', () => {
    expect(staffStep(p('F4'), 'alto')).toBe(7)
    expect(staffStep(p('F#4'), 'alto')).toBe(7)
    expect(staffStep(p('Fbb4'), 'alto')).toBe(7)
  })

  it('puts middle C below the treble staff and above the bass staff', () => {
    expect(staffStep(p('C4'), 'treble')).toBe(-2)
    expect(staffStep(p('C4'), 'bass')).toBe(10)
  })

  it('moves up one step per letter and seven per octave', () => {
    expect(staffStep(p('G3'), 'alto') - staffStep(p('F3'), 'alto')).toBe(1)
    expect(staffStep(p('F4'), 'alto') - staffStep(p('F3'), 'alto')).toBe(7)
  })
})

describe('ledger lines', () => {
  it('needs none for a note inside the staff', () => {
    expect(ledgerLinesFor(0)).toEqual([])
    expect(ledgerLinesFor(4)).toEqual([])
    expect(ledgerLinesFor(8)).toEqual([])
  })

  it('needs none in the space directly below the staff', () => {
    expect(ledgerLinesFor(-1)).toEqual([])
  })

  it('needs one for the first line below the staff', () => {
    expect(ledgerLinesFor(-2)).toEqual([-2])
  })

  it('keeps just that line for the space hanging below it', () => {
    expect(ledgerLinesFor(-3)).toEqual([-2])
  })

  it('draws a ladder of lines for notes far below the staff', () => {
    expect(ledgerLinesFor(-4)).toEqual([-2, -4])
    expect(ledgerLinesFor(-6)).toEqual([-2, -4, -6])
  })

  it('needs none in the space directly above the staff', () => {
    expect(ledgerLinesFor(9)).toEqual([])
  })

  it('draws a ladder of lines for notes above the staff', () => {
    expect(ledgerLinesFor(10)).toEqual([10])
    expect(ledgerLinesFor(11)).toEqual([10])
    expect(ledgerLinesFor(12)).toEqual([10, 12])
  })

  it('gives the viola’s open C string a single ledger line in alto clef', () => {
    expect(ledgerLinesFor(staffStep(p('C3'), 'alto'))).toEqual([-2])
  })
})

describe('stem direction', () => {
  it('turns stems down from the middle line upward', () => {
    expect(stemDirectionFor(4)).toBe('down')
    expect(stemDirectionFor(8)).toBe('down')
    expect(stemDirectionFor(11)).toBe('down')
  })

  it('turns stems up below the middle line', () => {
    expect(stemDirectionFor(3)).toBe('up')
    expect(stemDirectionFor(0)).toBe('up')
    expect(stemDirectionFor(-3)).toBe('up')
  })
})

describe('key signature glyphs', () => {
  it('writes nothing at all for C major', () => {
    expect(keySignatureGlyphs(C_MAJOR.signature, 'alto')).toEqual([])
  })

  it('writes one sharp on the top space for G major in alto clef', () => {
    expect(keySignatureGlyphs(G_MAJOR.signature, 'alto')).toEqual([
      { letter: 'F', staffStep: 7, glyph: '♯' },
    ])
  })

  it('lays out all seven sharps in alto clef', () => {
    const glyphs = keySignatureGlyphs(keySignatureForFifths(7), 'alto')
    expect(glyphs.map((g) => g.letter)).toEqual(['F', 'C', 'G', 'D', 'A', 'E', 'B'])
    expect(steps(glyphs)).toEqual([7, 4, 8, 5, 2, 6, 3])
  })

  it('lays out all seven flats in alto clef', () => {
    const glyphs = keySignatureGlyphs(keySignatureForFifths(-7), 'alto')
    expect(glyphs.map((g) => g.letter)).toEqual(['B', 'E', 'A', 'D', 'G', 'C', 'F'])
    expect(steps(glyphs)).toEqual([3, 6, 2, 5, 1, 4, 0])
  })

  it('floats the third sharp above the treble staff', () => {
    // The G sharp above the top line is the one place a signature leaves the staff.
    expect(steps(keySignatureGlyphs(keySignatureForFifths(7), 'treble'))).toEqual([
      8, 5, 9, 6, 3, 7, 4,
    ])
  })

  it('lays out treble flats and bass signatures conventionally', () => {
    expect(steps(keySignatureGlyphs(keySignatureForFifths(-7), 'treble'))).toEqual([
      4, 7, 3, 6, 2, 5, 1,
    ])
    expect(steps(keySignatureGlyphs(keySignatureForFifths(7), 'bass'))).toEqual([
      6, 3, 7, 4, 1, 5, 2,
    ])
    expect(steps(keySignatureGlyphs(keySignatureForFifths(-7), 'bass'))).toEqual([
      2, 5, 1, 4, 0, 3, 6,
    ])
  })

  it('writes alto sharps one step below the treble ones', () => {
    const alto = steps(keySignatureGlyphs(keySignatureForFifths(4), 'alto'))
    const treble = steps(keySignatureGlyphs(keySignatureForFifths(4), 'treble'))
    expect(alto).toEqual(treble.map((s) => s - 1))
  })

  it('marks sharps and flats with their own glyph', () => {
    expect(keySignatureGlyphs(keySignatureForFifths(2), 'alto').map((g) => g.glyph)).toEqual([
      '♯',
      '♯',
    ])
    expect(keySignatureGlyphs(keySignatureForFifths(-2), 'alto').map((g) => g.glyph)).toEqual([
      '♭',
      '♭',
    ])
  })
})

describe('printed accidentals', () => {
  it('prints nothing when the key signature already sharpens the note', () => {
    expect(accidentals(notate([p('F#4')], F_SHARP_MAJOR, 'alto'))).toEqual([null])
  })

  it('prints a natural when the note contradicts the key signature', () => {
    expect(accidentals(notate([p('F4')], F_SHARP_MAJOR, 'alto'))).toEqual(['♮'])
  })

  it('prints nothing for an unaltered note in a key with no signature', () => {
    expect(accidentals(notate([p('C4'), p('D4')], C_MAJOR, 'alto'))).toEqual([null, null])
  })

  it('does not repeat an accidental already printed in the same bar', () => {
    expect(accidentals(notate([p('F#4'), p('G4'), p('F#4')], C_MAJOR, 'alto'))).toEqual([
      '♯',
      null,
      null,
    ])
  })

  it('prints the accidental again in the next bar', () => {
    const notes = notate([p('F#4'), p('F#4')], C_MAJOR, 'alto', { barBoundaries: [1] })
    expect(accidentals(notes)).toEqual(['♯', '♯'])
  })

  it('lets an accidental in the bar override the key signature', () => {
    // G major sharpens every F, so the natural must be cancelled explicitly and
    // then holds until the barline.
    expect(accidentals(notate([p('F4'), p('F4'), p('F#4')], G_MAJOR, 'alto'))).toEqual([
      '♮',
      null,
      '♯',
    ])
  })

  it('restores the key signature after the barline', () => {
    const notes = notate([p('F4'), p('F4')], G_MAJOR, 'alto', { barBoundaries: [1] })
    expect(accidentals(notes)).toEqual(['♮', '♮'])
  })

  it('remembers accidentals per letter, not across letters', () => {
    expect(accidentals(notate([p('F#4'), p('C4')], C_MAJOR, 'alto'))).toEqual(['♯', null])
  })

  it('remembers accidentals across octaves of the same letter', () => {
    // A deliberate simplification: strict engraving re-marks the other octave.
    expect(accidentals(notate([p('F#4'), p('F#3')], C_MAJOR, 'alto'))).toEqual(['♯', null])
  })

  it('renders a double sharp and a double flat with their own glyphs', () => {
    expect(accidentals(notate([p('F##4')], C_MAJOR, 'alto'))).toEqual(['𝄪'])
    expect(accidentals(notate([p('Bbb3')], C_MAJOR, 'alto'))).toEqual(['𝄫'])
  })

  it('prints a sharp against a flat signature rather than assuming naturals', () => {
    const eFlatMajor = majorKeyAtFifths(-3)
    expect(accidentals(notate([p('B3'), p('Bb3')], eFlatMajor, 'alto'))).toEqual(['♮', '♭'])
  })

  it('carries position, ledger lines and stem direction alongside the accidental', () => {
    expect(notate([p('C3')], C_MAJOR, 'alto')).toEqual([
      {
        pitch: p('C3'),
        staffStep: -3,
        accidental: null,
        ledgerLines: [-2],
        stemDirection: 'up',
      },
    ])
  })

  it('notates a two-octave C major scale on the viola without a single accidental', () => {
    const scale = ['C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3', 'C4', 'D4', 'E4', 'F4', 'G4'].map(p)
    const notes = notate(scale, C_MAJOR, 'alto')
    expect(accidentals(notes)).toEqual(scale.map(() => null))
    expect(notes.map((n) => n.staffStep)).toEqual([-3, -2, -1, 0, 1, 2, 3, 4, 5, 6, 7, 8])
  })
})
