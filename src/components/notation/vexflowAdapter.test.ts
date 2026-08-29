import { describe, expect, it } from 'vitest'
import { majorKeyAtFifths, minorKeyAtFifths } from '@core/key/key'
import { type Pitch, p } from '@core/pitch/pitch'
import { note, rest } from '@core/rhythm/bar'
import { TRIPLET, dur } from '@core/rhythm/duration'
import { meter } from '@core/rhythm/meter'
import type { Finger } from '@core/viola/fingerboard'
import type { FingeredNote } from '@core/viola/fingering'
import type { StringId } from '@core/viola/strings'
import {
  beamGroupFractions,
  middleLineKey,
  toStaveNoteSpecs,
  toVexAccidental,
  toVexDuration,
  toVexKey,
  toVexKeySpec,
} from './vexflowAdapter'

const C_MAJOR = majorKeyAtFifths(0)
const F_SHARP_MAJOR = majorKeyAtFifths(6)
const B_FLAT_MAJOR = majorKeyAtFifths(-2)

const notes = (n: number, d = dur('quarter')) => Array.from({ length: n }, () => note(d))

/** A stand-in for what `fingerNotes` returns; only the placement matters here. */
const fingered = (index: number, pitch: Pitch, string: StringId, finger: Finger): FingeredNote => ({
  index,
  pitch,
  placement: {
    string,
    finger,
    position: 1,
    pitch,
    semitonesAboveOpen: 0,
    diatonicStepsAboveOpen: 0,
    isOpen: finger === 0,
    stretch: 0,
  },
  shiftIntoThisNote: null,
})

describe('toVexKey', () => {
  it('lowercases the letter and appends the octave', () => {
    expect(toVexKey(p('C4'))).toBe('c/4')
    expect(toVexKey(p('G3'))).toBe('g/3')
    expect(toVexKey(p('A5'))).toBe('a/5')
  })

  it('spells flats with b', () => {
    expect(toVexKey(p('Eb4'))).toBe('eb/4')
    expect(toVexKey(p('B♭3'))).toBe('bb/3')
  })

  it('spells sharps with #', () => {
    expect(toVexKey(p('F#3'))).toBe('f#/3')
    expect(toVexKey(p('C♯5'))).toBe('c#/5')
  })

  it('spells double accidentals with doubled characters', () => {
    expect(toVexKey(p('F##3'))).toBe('f##/3')
    expect(toVexKey(p('Gbb4'))).toBe('gbb/4')
  })

  it('keeps low and high octaves, including the viola C string', () => {
    expect(toVexKey(p('C3'))).toBe('c/3')
    expect(toVexKey(p('E6'))).toBe('e/6')
    expect(toVexKey(p('Cb-1'))).toBe('cb/-1')
  })
})

describe('toVexDuration', () => {
  it('maps every note value', () => {
    const codes = (
      ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtysecond'] as const
    ).map((base) => toVexDuration(dur(base), false))
    expect(codes).toEqual(['w', 'h', 'q', '8', '16', '32'])
  })

  it('appends r for every rest value', () => {
    const codes = (
      ['whole', 'half', 'quarter', 'eighth', 'sixteenth', 'thirtysecond'] as const
    ).map((base) => toVexDuration(dur(base), true))
    expect(codes).toEqual(['wr', 'hr', 'qr', '8r', '16r', '32r'])
  })

  it('leaves dots out of the code — VexFlow 5 attaches them as Dot modifiers', () => {
    expect(toVexDuration(dur('quarter', 1), false)).toBe('q')
    expect(toVexDuration(dur('half', 2), false)).toBe('h')
    expect(toVexDuration(dur('eighth', 1), true)).toBe('8r')
  })

  it('leaves tuplets out of the code — a triplet eighth is still written as an eighth', () => {
    expect(toVexDuration(dur('eighth', 0, TRIPLET), false)).toBe('8')
  })
})

describe('toVexAccidental', () => {
  it('maps every glyph our notation layer can print', () => {
    expect(toVexAccidental('♯')).toBe('#')
    expect(toVexAccidental('♭')).toBe('b')
    expect(toVexAccidental('♮')).toBe('n')
    expect(toVexAccidental('𝄪')).toBe('##')
    expect(toVexAccidental('𝄫')).toBe('bb')
  })
})

describe('beamGroupFractions', () => {
  // The headline case. VexFlow's own default beam grouping has no entry for
  // 12/8 and falls through to a heuristic that can produce two groups of six —
  // which reads as 6/4 and destroys the compound feel we are trying to teach.
  it('beams 12/8 in FOUR groups of three eighths, not two of six', () => {
    expect(beamGroupFractions(meter(12, 8))).toEqual([
      { numerator: 3, denominator: 8 },
      { numerator: 3, denominator: 8 },
      { numerator: 3, denominator: 8 },
      { numerator: 3, denominator: 8 },
    ])
  })

  it('never emits a six-eighth group in 12/8', () => {
    const groups = beamGroupFractions(meter(12, 8))
    expect(groups).toHaveLength(4)
    expect(groups.some((g) => g.numerator === 6)).toBe(false)
  })

  it('beams 6/8 in two groups of three', () => {
    expect(beamGroupFractions(meter(6, 8))).toEqual([
      { numerator: 3, denominator: 8 },
      { numerator: 3, denominator: 8 },
    ])
  })

  it('beams 9/8 in three groups of three', () => {
    expect(beamGroupFractions(meter(9, 8))).toEqual([
      { numerator: 3, denominator: 8 },
      { numerator: 3, denominator: 8 },
      { numerator: 3, denominator: 8 },
    ])
  })

  it('beams 4/4 in four groups of one quarter each', () => {
    expect(beamGroupFractions(meter(4, 4))).toEqual([
      { numerator: 1, denominator: 4 },
      { numerator: 1, denominator: 4 },
      { numerator: 1, denominator: 4 },
      { numerator: 1, denominator: 4 },
    ])
  })

  it('beams 3/4 in three groups of one quarter', () => {
    expect(beamGroupFractions(meter(3, 4))).toEqual([
      { numerator: 1, denominator: 4 },
      { numerator: 1, denominator: 4 },
      { numerator: 1, denominator: 4 },
    ])
  })

  it('follows 7/8 grouped 2+2+3', () => {
    expect(beamGroupFractions(meter(7, 8))).toEqual([
      { numerator: 2, denominator: 8 },
      { numerator: 2, denominator: 8 },
      { numerator: 3, denominator: 8 },
    ])
  })

  it('changes when 7/8 is regrouped as 3+2+2', () => {
    expect(beamGroupFractions(meter(7, 8, { grouping: [3, 2, 2] }))).toEqual([
      { numerator: 3, denominator: 8 },
      { numerator: 2, denominator: 8 },
      { numerator: 2, denominator: 8 },
    ])
  })

  it('always sums to exactly one bar', () => {
    for (const m of [meter(12, 8), meter(6, 8), meter(4, 4), meter(7, 8), meter(5, 4)]) {
      const total = beamGroupFractions(m).reduce((sum, g) => sum + g.numerator / g.denominator, 0)
      expect(total).toBeCloseTo(m.barValue.n / m.barValue.d, 10)
    }
  })
})

describe('toStaveNoteSpecs', () => {
  it('returns nothing for an empty bar', () => {
    expect(toStaveNoteSpecs({ events: [], meter: meter(4, 4), key: C_MAJOR })).toEqual([])
  })

  it('carries the plain duration code and the dot count separately', () => {
    const specs = toStaveNoteSpecs({
      events: [note(dur('quarter', 1)), note(dur('eighth')), note(dur('half', 2))],
      meter: meter(4, 4),
      key: C_MAJOR,
    })
    expect(specs.map((s) => s.duration)).toEqual(['q', '8', 'h'])
    expect(specs.map((s) => s.dots)).toEqual([1, 0, 2])
  })

  it('marks a rest as a rest and never gives it a fingering', () => {
    const specs = toStaveNoteSpecs({
      events: [rest(dur('quarter')), note(dur('quarter'))],
      meter: meter(2, 4),
      key: C_MAJOR,
      pitches: [p('C4')],
      fingering: [fingered(0, p('C4'), 'III', 3)],
    })
    expect(specs[0]?.isRest).toBe(true)
    expect(specs[0]?.duration).toBe('qr')
    expect(specs[0]?.fingering).toBeUndefined()
    expect(specs[0]?.accidentals).toEqual([null])
    // The pitch and the fingering both belong to the NOTE, which is event 1.
    expect(specs[1]?.keys).toEqual(['c/4'])
    expect(specs[1]?.fingering).toEqual({ finger: '3', stringNumber: 'III' })
  })

  it('parks rests on the middle line of the clef', () => {
    const alto = toStaveNoteSpecs({
      events: [rest(dur('whole'))],
      meter: meter(4, 4),
      key: C_MAJOR,
    })
    expect(alto[0]?.keys).toEqual([middleLineKey('alto')])
    expect(alto[0]?.keys).toEqual(['c/4'])

    const treble = toStaveNoteSpecs({
      events: [rest(dur('whole'))],
      meter: meter(4, 4),
      key: C_MAJOR,
      clef: 'treble',
    })
    expect(treble[0]?.keys).toEqual(['b/4'])
  })

  it('indexes pitches by note ordinal, skipping rests entirely', () => {
    const specs = toStaveNoteSpecs({
      events: [note(dur('quarter')), rest(dur('quarter')), note(dur('quarter'))],
      meter: meter(3, 4),
      key: C_MAJOR,
      pitches: [p('D4'), p('A4')],
    })
    expect(specs.map((s) => s.keys[0])).toEqual(['d/4', 'c/4', 'a/4'])
    expect(specs.map((s) => s.isRest)).toEqual([false, true, false])
  })

  it('prints nothing on an F in F sharp major — the signature already said so', () => {
    const specs = toStaveNoteSpecs({
      events: notes(2),
      meter: meter(2, 4),
      key: F_SHARP_MAJOR,
      pitches: [p('F#3'), p('C#4')],
    })
    expect(specs.map((s) => s.accidentals)).toEqual([[null], [null]])
    expect(specs.map((s) => s.keys[0])).toEqual(['f#/3', 'c#/4'])
  })

  it('prints a natural when the signature would otherwise alter the note', () => {
    const specs = toStaveNoteSpecs({
      events: notes(1),
      meter: meter(1, 4),
      key: F_SHARP_MAJOR,
      pitches: [p('F3')],
    })
    expect(specs[0]?.accidentals).toEqual([{ index: 0, code: 'n' }])
  })

  it('prints an accidental once, then remembers it for the rest of the bar', () => {
    const specs = toStaveNoteSpecs({
      events: notes(4),
      meter: meter(4, 4),
      key: C_MAJOR,
      pitches: [p('F#4'), p('F#4'), p('G4'), p('F#4')],
    })
    expect(specs.map((s) => s.accidentals[0])).toEqual([
      { index: 0, code: '#' },
      null,
      null,
      null,
    ])
  })

  it('forgets printed accidentals at the barline', () => {
    // Two bars of 2/4: the sharp has to be restated at the start of bar two.
    const specs = toStaveNoteSpecs({
      events: notes(4),
      meter: meter(2, 4),
      key: C_MAJOR,
      pitches: [p('F#4'), p('F#4'), p('F#4'), p('F#4')],
    })
    expect(specs.map((s) => s.accidentals[0])).toEqual([
      { index: 0, code: '#' },
      null,
      { index: 0, code: '#' },
      null,
    ])
  })

  it('prints a double flat with the doubled code', () => {
    const specs = toStaveNoteSpecs({
      events: notes(1),
      meter: meter(1, 4),
      key: B_FLAT_MAJOR,
      pitches: [p('Bbb4')],
    })
    expect(specs[0]?.accidentals).toEqual([{ index: 0, code: 'bb' }])
    expect(specs[0]?.keys).toEqual(['bbb/4'])
  })

  it('draws pitchless rhythm as noteheads on the middle line', () => {
    const specs = toStaveNoteSpecs({
      events: notes(3, dur('eighth')),
      meter: meter(3, 8),
      key: C_MAJOR,
    })
    expect(specs.map((s) => s.keys[0])).toEqual(['c/4', 'c/4', 'c/4'])
    expect(specs.every((s) => s.isRest === false)).toBe(true)
    expect(specs.every((s) => s.accidentals[0] === null)).toBe(true)
  })

  it('carries finger and string for each fingered note', () => {
    const specs = toStaveNoteSpecs({
      events: notes(3),
      meter: meter(3, 4),
      key: C_MAJOR,
      pitches: [p('C4'), p('D4'), p('A3')],
      fingering: [
        fingered(0, p('C4'), 'II', 2),
        fingered(1, p('D4'), 'II', 4),
        fingered(2, p('A3'), 'II', 0),
      ],
    })
    expect(specs.map((s) => s.fingering)).toEqual([
      { finger: '2', stringNumber: 'II' },
      { finger: '4', stringNumber: 'II' },
      { finger: '0', stringNumber: 'II' },
    ])
  })

  it('omits the fingering key entirely for notes with no fingering supplied', () => {
    const specs = toStaveNoteSpecs({
      events: notes(2),
      meter: meter(2, 4),
      key: C_MAJOR,
      pitches: [p('C4'), p('D4')],
      fingering: [fingered(1, p('D4'), 'II', 1)],
    })
    expect('fingering' in specs[0]!).toBe(false)
    expect(specs[1]?.fingering).toEqual({ finger: '1', stringNumber: 'II' })
  })

  it('carries bowings by note ordinal and omits the key where none is given', () => {
    const specs = toStaveNoteSpecs({
      events: [note(dur('quarter')), rest(dur('quarter')), note(dur('quarter'))],
      meter: meter(3, 4),
      key: C_MAJOR,
      pitches: [p('C4'), p('D4')],
      bowings: ['down', null],
    })
    expect(specs[0]?.bowing).toBe('down')
    expect('bowing' in specs[1]!).toBe(false)
    expect('bowing' in specs[2]!).toBe(false)
  })
})

describe('toVexKeySpec', () => {
  it('names majors and minors the way VexFlow does', () => {
    expect(toVexKeySpec(C_MAJOR)).toBe('C')
    expect(toVexKeySpec(B_FLAT_MAJOR)).toBe('Bb')
    expect(toVexKeySpec(F_SHARP_MAJOR)).toBe('F#')
    expect(toVexKeySpec(minorKeyAtFifths(0))).toBe('Am')
    expect(toVexKeySpec(minorKeyAtFifths(3))).toBe('F#m')
    expect(toVexKeySpec(minorKeyAtFifths(-5))).toBe('Bbm')
  })

  it('covers every signature VexFlow knows, in both modes', () => {
    for (let fifths = -7; fifths <= 7; fifths += 1) {
      expect(toVexKeySpec(majorKeyAtFifths(fifths))).not.toBeNull()
      expect(toVexKeySpec(minorKeyAtFifths(fifths))).not.toBeNull()
    }
  })
})
