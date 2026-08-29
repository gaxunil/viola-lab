import { describe, expect, it } from 'vitest'
import { rat, rsum } from '../math/rational'
import { PPQ, ticksFromWholeNotes } from '../ticks'
import {
  QUINTUPLET,
  SEPTUPLET,
  TRIPLET,
  decompose,
  dur,
  durationValue,
  formatDuration,
  sumDurations,
} from './duration'

describe('durationValue', () => {
  it('gives plain note values their fraction of a whole note', () => {
    expect(durationValue(dur('whole'))).toEqual(rat(1, 1))
    expect(durationValue(dur('quarter'))).toEqual(rat(1, 4))
    expect(durationValue(dur('thirtysecond'))).toEqual(rat(1, 32))
  })

  it('adds half again for a dot', () => {
    expect(durationValue(dur('quarter', 1))).toEqual(rat(3, 8))
    expect(durationValue(dur('half', 1))).toEqual(rat(3, 4))
  })

  it('adds three quarters again for two dots — exactly, not 0.875', () => {
    expect(durationValue(dur('half', 2))).toEqual(rat(7, 8))
    expect(durationValue(dur('quarter', 2))).toEqual(rat(7, 16))
  })

  it('squeezes tuplets into the space of fewer notes', () => {
    expect(durationValue(dur('eighth', 0, TRIPLET))).toEqual(rat(1, 12))
    expect(durationValue(dur('sixteenth', 0, QUINTUPLET))).toEqual(rat(1, 20))
    expect(durationValue(dur('sixteenth', 0, SEPTUPLET))).toEqual(rat(1, 28))
  })

  it('combines dots and tuplets', () => {
    // A dotted eighth triplet: 3/16 * 2/3 = 1/8.
    expect(durationValue(dur('eighth', 1, TRIPLET))).toEqual(rat(1, 8))
  })

  it('rejects a nonsense tuplet', () => {
    expect(() => durationValue(dur('eighth', 0, { actual: 0, normal: 2 }))).toThrow(RangeError)
  })
})

describe('durations close exactly', () => {
  it('three triplet eighths fill a quarter', () => {
    expect(sumDurations(Array.from({ length: 3 }, () => dur('eighth', 0, TRIPLET)))).toEqual(
      rat(1, 4),
    )
  })

  it('a double-dotted half plus a sixteenth fills a 4/4 bar', () => {
    expect(sumDurations([dur('half', 2), dur('sixteenth')])).toEqual(rat(15, 16))
    // ...and with one more sixteenth, exactly one whole note.
    expect(sumDurations([dur('half', 2), dur('sixteenth'), dur('sixteenth')])).toEqual(rat(1, 1))
  })

  it('four dotted quarters fill a 12/8 bar', () => {
    expect(sumDurations(Array.from({ length: 4 }, () => dur('quarter', 1)))).toEqual(rat(3, 2))
  })

  it('twelve eighths also fill a 12/8 bar', () => {
    expect(sumDurations(Array.from({ length: 12 }, () => dur('eighth')))).toEqual(rat(3, 2))
  })

  it('a 4/4 bar of quarter-note triplets closes, where floats would not', () => {
    const six = Array.from({ length: 6 }, () => dur('quarter', 0, TRIPLET))
    expect(sumDurations(six)).toEqual(rat(1, 1))
    expect(six.map(() => 1 / 6).reduce((a, b) => a + b, 0)).not.toBe(1)
  })
})

describe('ticks', () => {
  it('converts every notated duration to a whole number of ticks', () => {
    const values = [
      dur('whole'),
      dur('half', 2),
      dur('quarter', 1),
      dur('eighth', 0, TRIPLET),
      dur('sixteenth', 0, QUINTUPLET),
      dur('sixteenth', 0, SEPTUPLET),
      dur('thirtysecond', 0, TRIPLET),
    ]
    for (const d of values) {
      const t = ticksFromWholeNotes(durationValue(d))
      expect(Number.isInteger(t)).toBe(true)
      expect(t).toBeGreaterThan(0)
    }
  })

  it('anchors a quarter note at PPQ', () => {
    expect(ticksFromWholeNotes(durationValue(dur('quarter')))).toBe(PPQ)
    expect(ticksFromWholeNotes(durationValue(dur('quarter', 1)))).toBe(PPQ * 1.5)
    expect(ticksFromWholeNotes(durationValue(dur('half', 2)))).toBe(8820)
  })

  it('refuses a duration it cannot represent exactly', () => {
    // An eleven-tuplet does not divide PPQ 2520.
    expect(() => ticksFromWholeNotes(rat(1, 11))).toThrow(RangeError)
  })
})

describe('formatting and decomposition', () => {
  it('names durations the way a teacher would say them', () => {
    expect(formatDuration(dur('quarter', 1))).toBe('dotted quarter note')
    expect(formatDuration(dur('half', 2))).toBe('double-dotted half note')
    expect(formatDuration(dur('eighth', 0, TRIPLET))).toBe('eighth note triplet')
  })

  it('describes a leftover value as real notes', () => {
    expect(decompose(rat(3, 8)).map(formatDuration)).toEqual(['dotted quarter note'])
    expect(decompose(rat(1, 2)).map(formatDuration)).toEqual(['half note'])
    // Five eighths is a half tied to an eighth.
    expect(decompose(rat(5, 8)).map(formatDuration)).toEqual(['half note', 'eighth note'])
  })

  it('decomposes back to the value it was given', () => {
    for (const value of [rat(3, 8), rat(5, 8), rat(7, 16), rat(15, 16), rat(3, 2)]) {
      expect(rsum(decompose(value).map(durationValue))).toEqual(value)
    }
  })
})
