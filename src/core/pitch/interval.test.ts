import { describe, expect, it } from 'vitest'
import { formatPitch, p, pc, toMidi } from './pitch'
import {
  OCTAVE,
  SpellingRangeError,
  addIntervals,
  formatInterval,
  intervalBetween,
  intervalBetweenClasses,
  intervalName,
  iv,
  negate,
  simplify,
  transpose,
  transposeClass,
} from './interval'

const name = (s: string) => formatPitch(p(s))

describe('iv shorthand', () => {
  it('parses the common intervals into vectors', () => {
    expect(iv('P1')).toEqual({ diatonic: 0, chromatic: 0 })
    expect(iv('M2')).toEqual({ diatonic: 1, chromatic: 2 })
    expect(iv('m3')).toEqual({ diatonic: 2, chromatic: 3 })
    expect(iv('M3')).toEqual({ diatonic: 2, chromatic: 4 })
    expect(iv('P4')).toEqual({ diatonic: 3, chromatic: 5 })
    expect(iv('P5')).toEqual({ diatonic: 4, chromatic: 7 })
    expect(iv('M7')).toEqual({ diatonic: 6, chromatic: 11 })
    expect(iv('P8')).toEqual({ diatonic: 7, chromatic: 12 })
  })

  // The augmented second is the whole reason intervals are vectors and not
  // (semitones) — it is three semitones like a minor third, but ONE letter step.
  it('distinguishes an augmented 2nd from a minor 3rd', () => {
    expect(iv('A2')).toEqual({ diatonic: 1, chromatic: 3 })
    expect(iv('m3')).toEqual({ diatonic: 2, chromatic: 3 })
    expect(iv('A2').chromatic).toBe(iv('m3').chromatic)
    expect(iv('A2').diatonic).not.toBe(iv('m3').diatonic)
  })

  it('parses diminished and augmented forms', () => {
    expect(iv('d5')).toEqual({ diatonic: 4, chromatic: 6 })
    expect(iv('A4')).toEqual({ diatonic: 3, chromatic: 6 })
    expect(iv('A1')).toEqual({ diatonic: 0, chromatic: 1 })
    expect(iv('d4')).toEqual({ diatonic: 3, chromatic: 4 })
  })

  it('rejects qualities that do not exist for that number', () => {
    expect(() => iv('M5')).toThrow(SyntaxError) // fifths are perfect, not major
    expect(() => iv('P3')).toThrow(SyntaxError) // thirds are major/minor
    expect(() => iv('X3')).toThrow(SyntaxError)
  })

  it('round-trips through intervalName', () => {
    for (const s of ['P1', 'm2', 'M2', 'A2', 'm3', 'M3', 'P4', 'A4', 'd5', 'P5', 'm7', 'M7', 'P8']) {
      expect(formatInterval(iv(s))).toBe(s)
    }
  })
})

describe('intervalName', () => {
  it('names intervals in words', () => {
    expect(intervalName(iv('M3')).long).toBe('major third')
    expect(intervalName(iv('A2')).long).toBe('augmented second')
    expect(intervalName(iv('d5')).long).toBe('diminished fifth')
    expect(intervalName(iv('P8')).long).toBe('perfect octave')
  })

  it('reports direction separately from size', () => {
    expect(intervalName(iv('M3')).direction).toBe(1)
    expect(intervalName(negate(iv('M3')))).toMatchObject({ direction: -1, short: 'M3' })
  })
})

describe('transpose — the spelling engine', () => {
  // The requirement that would otherwise regress silently.
  it('spells B up an augmented 4th as E sharp, not F', () => {
    expect(name('B4') && formatPitch(transpose(p('B4'), iv('A4')))).toBe('E♯5')
  })

  it('spells a major 3rd above B as D sharp, not E flat', () => {
    expect(formatPitch(transpose(p('B3'), iv('M3')))).toBe('D♯4')
  })

  it('keeps flat keys flat', () => {
    // A perfect 4th above E flat is A flat — never G sharp.
    expect(formatPitch(transpose(p('Eb4'), iv('P4')))).toBe('A♭4')
    // A major 6th above E flat is C.
    expect(formatPitch(transpose(p('Eb4'), iv('M6')))).toBe('C5')
  })

  it('produces double sharps when the spelling demands it', () => {
    // The leading tone of G sharp minor is F double sharp.
    const leadingTone = transpose(p('G#4'), iv('M7'))
    expect(formatPitch(leadingTone, { style: 'ascii' })).toBe('F##5')
    expect(toMidi(leadingTone)).toBe(toMidi(p('G5'))) // and it sounds as G
  })

  it('transposes down', () => {
    expect(formatPitch(transpose(p('C4'), negate(iv('M3'))))).toBe('A♭3')
    expect(formatPitch(transpose(p('C4'), negate(iv('m3'))))).toBe('A3')
  })

  it('crosses octaves correctly', () => {
    expect(formatPitch(transpose(p('A4'), OCTAVE))).toBe('A5')
    expect(formatPitch(transpose(p('B4'), iv('m2')))).toBe('C5')
    expect(formatPitch(transpose(p('C4'), negate(iv('m2'))))).toBe('B3')
  })

  it('refuses to invent a triple sharp', () => {
    // F double sharp up an augmented 2nd would need G triple sharp.
    expect(() => transpose(p('F##4'), iv('A2'))).toThrow(SpellingRangeError)
  })

  it('transposes pitch classes without an octave', () => {
    expect(transposeClass(pc('E', -1), iv('P5'))).toEqual(pc('B', -1))
    expect(transposeClass(pc('F', 1), iv('M3'))).toEqual(pc('A', 1))
  })
})

describe('intervalBetween', () => {
  it('is the inverse of transpose', () => {
    for (const s of ['P1', 'm2', 'M3', 'A2', 'P4', 'd5', 'P5', 'M7', 'P8']) {
      const i = iv(s)
      const from = p('C4')
      expect(intervalBetween(from, transpose(from, i))).toEqual(i)
    }
  })

  it('reports a diminished 4th rather than a major 3rd when spelled that way', () => {
    // C to F flat is four letter names but only four semitones.
    expect(formatInterval(intervalBetween(p('C4'), p('Fb4')))).toBe('d4')
    expect(formatInterval(intervalBetween(p('C4'), p('E4')))).toBe('M3')
  })

  it('measures the augmented 2nd in harmonic minor', () => {
    // A harmonic minor: F natural up to G sharp.
    expect(intervalBetween(p('F4'), p('G#4'))).toEqual({ diatonic: 1, chromatic: 3 })
    expect(formatInterval(intervalBetween(p('F4'), p('G#4')))).toBe('A2')
  })

  it('measures ascending intervals between pitch classes', () => {
    expect(formatInterval(intervalBetweenClasses(pc('C'), pc('E')))).toBe('M3')
    expect(formatInterval(intervalBetweenClasses(pc('E'), pc('C')))).toBe('m6')
    expect(formatInterval(intervalBetweenClasses(pc('B', -1), pc('D')))).toBe('M3')
  })
})

describe('interval algebra', () => {
  it('adds intervals', () => {
    expect(formatInterval(addIntervals(iv('M3'), iv('m3')))).toBe('P5')
    expect(formatInterval(addIntervals(iv('M3'), iv('M3')))).toBe('A5')
    expect(formatInterval(addIntervals(iv('P5'), iv('P4')))).toBe('P8')
  })

  it('simplifies compound intervals', () => {
    expect(simplify(addIntervals(iv('M3'), OCTAVE))).toEqual(iv('M3'))
  })

  it('negation is an involution', () => {
    expect(negate(negate(iv('M3')))).toEqual(iv('M3'))
  })
})
