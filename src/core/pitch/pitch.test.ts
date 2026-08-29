import { describe, expect, it } from 'vitest'
import {
  comparePitch,
  diatonicIndex,
  enharmonic,
  formatPitch,
  fromDiatonicIndex,
  p,
  parsePitchClass,
  pc,
  pitchClassNumber,
  samePitch,
  toFrequency,
  toMidi,
} from './pitch'

describe('the two axes', () => {
  it('places middle C at MIDI 60 and diatonic index 28', () => {
    expect(toMidi(p('C4'))).toBe(60)
    expect(diatonicIndex(p('C4'))).toBe(28)
  })

  it('anchors A4 at MIDI 69 and 440 Hz', () => {
    expect(toMidi(p('A4'))).toBe(69)
    expect(toFrequency(p('A4'))).toBe(440)
  })

  it('gives the viola open strings their real MIDI numbers', () => {
    // C3 G3 D4 A4, low to high.
    expect([p('C3'), p('G3'), p('D4'), p('A4')].map(toMidi)).toEqual([48, 55, 62, 69])
  })

  // This is the property that makes the whole design work: the axes move
  // independently, so a note can sound the same while sitting on a different line.
  it('separates sound from staff position', () => {
    expect(toMidi(p('B#3'))).toBe(60) // sounds as middle C
    expect(toMidi(p('C4'))).toBe(60)
    expect(diatonicIndex(p('B#3'))).toBe(27) // but sits a step lower on the staff
    expect(diatonicIndex(p('C4'))).toBe(28)

    expect(toMidi(p('Cb4'))).toBe(59) // sounds as B3
    expect(toMidi(p('B3'))).toBe(59)
    expect(diatonicIndex(p('Cb4'))).toBe(28) // but is written as a C
  })

  it('handles double accidentals', () => {
    expect(toMidi(p('F##4'))).toBe(toMidi(p('G4')))
    expect(toMidi(p('Bbb4'))).toBe(toMidi(p('A4')))
    expect(diatonicIndex(p('F##4'))).toBe(diatonicIndex(p('F4')))
  })

  it('round-trips through the diatonic index', () => {
    for (const name of ['C4', 'Eb3', 'F#5', 'B2', 'A6']) {
      const q = p(name)
      expect(fromDiatonicIndex(diatonicIndex(q), q.alter)).toEqual(q)
    }
  })
})

describe('identity', () => {
  it('distinguishes spelling from sound', () => {
    expect(samePitch(p('Bb4'), p('A#4'))).toBe(false)
    expect(enharmonic(p('Bb4'), p('A#4'))).toBe(true)
    expect(samePitch(p('Bb4'), p('Bb4'))).toBe(true)
  })

  it('orders by sound, then by staff position', () => {
    expect(comparePitch(p('C4'), p('D4'))).toBe(-1)
    expect(comparePitch(p('D4'), p('C4'))).toBe(1)
    expect(comparePitch(p('C4'), p('C4'))).toBe(0)
    // Same sound, different spelling: the lower staff position sorts first.
    expect(comparePitch(p('B#3'), p('C4'))).toBe(-1)
  })

  it('wraps pitch class numbers into 0..11', () => {
    expect(pitchClassNumber(pc('C'))).toBe(0)
    expect(pitchClassNumber(pc('B', 1))).toBe(0) // B sharp wraps to C
    expect(pitchClassNumber(pc('C', -1))).toBe(11) // C flat wraps to B
    expect(pitchClassNumber(p('Eb4'))).toBe(3)
  })
})

describe('formatting and parsing', () => {
  it('formats with unicode accidentals by default', () => {
    expect(formatPitch(p('Eb4'))).toBe('E♭4')
    expect(formatPitch(p('F#3'))).toBe('F♯3')
    expect(formatPitch(p('C4'))).toBe('C4')
    expect(formatPitch(pc('B', -1))).toBe('B♭')
  })

  it('formats ascii on request', () => {
    expect(formatPitch(p('Eb4'), { style: 'ascii' })).toBe('Eb4')
    expect(formatPitch(p('F##3'), { style: 'ascii' })).toBe('F##3')
  })

  it('formats double accidentals with the real glyphs', () => {
    expect(formatPitch(p('F##3'))).toBe('F\u{1D12A}3')
    expect(formatPitch(p('Bbb3'))).toBe('B\u{1D12B}3')
  })

  it('parses both ascii and unicode input', () => {
    expect(p('E♭4')).toEqual(p('Eb4'))
    expect(p('F♯3')).toEqual(p('F#3'))
    expect(p('F𝄪3')).toEqual(p('F##3'))
    expect(p('B𝄫3')).toEqual(p('Bbb3'))
  })

  it('round-trips format and parse', () => {
    for (const name of ['C4', 'Eb3', 'F#5', 'F##2', 'Bbb6', 'B-1']) {
      expect(p(formatPitch(p(name), { style: 'ascii' }))).toEqual(p(name))
    }
  })

  it('rejects malformed input rather than guessing', () => {
    expect(() => p('H4')).toThrow(SyntaxError)
    expect(() => p('C')).toThrow(SyntaxError) // no octave
    expect(() => parsePitchClass('C4')).toThrow(SyntaxError) // unexpected octave
  })
})
