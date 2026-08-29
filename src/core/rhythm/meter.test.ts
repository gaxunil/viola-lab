import { describe, expect, it } from 'vitest'
import { rat, req } from '../math/rational'
import { PPQ } from '../ticks'
import { dur, durationValue } from './duration'
import {
  COMMON_METERS,
  accentsFor,
  beatAt,
  beatOnsets,
  defaultGrouping,
  groupingOptions,
  meter,
  subdivisionOnsets,
} from './meter'

describe('12/8 — the meter she asked about', () => {
  const m = meter(12, 8)

  it('is four dotted-quarter beats, not twelve eighths', () => {
    expect(m.class).toBe('compound')
    expect(m.beats).toBe(4)
    expect(m.grouping).toEqual([3, 3, 3, 3])
    expect(m.beatUnit).toEqual(dur('quarter', 1))
    expect(req(m.beatValue, durationValue(dur('quarter', 1)))).toBe(true)
  })

  it('fills a bar and a half of 4/4 worth of time', () => {
    expect(m.barValue).toEqual(rat(3, 2))
    expect(m.barTicks).toBe(6 * PPQ)
    expect(m.pulseTicks).toBe(PPQ / 2)
  })

  // The metrical hierarchy: 12/8 is 4/4 with every beat split in three, so it
  // is felt ONE two THREE four, not ONE two three four all equal.
  it('accents beats 1 and 3, which is pulses 1, 4, 7 and 10', () => {
    expect(m.accents).toEqual(['strong', 'weak', 'medium', 'weak'])
    expect(beatOnsets(m).map((t) => t / m.pulseTicks)).toEqual([0, 3, 6, 9])
  })

  it('describes itself in words a beginner can use', () => {
    expect(m.description).toBe('compound quadruple — 4 dotted beats')
    expect(m.label).toBe('12/8')
  })
})

describe('6/8 versus 3/4 — the teaching point', () => {
  it('occupies the same time but is felt differently', () => {
    const six = meter(6, 8)
    const three = meter(3, 4)

    expect(req(six.barValue, three.barValue)).toBe(true)
    expect(six.barTicks).toBe(three.barTicks)

    expect(six.beats).toBe(2)
    expect(three.beats).toBe(3)
    expect(six.grouping).toEqual([3, 3])
    expect(three.grouping).toEqual([1, 1, 1])
    expect(six.beatUnit).toEqual(dur('quarter', 1)) // dotted quarter
    expect(three.beatUnit).toEqual(dur('quarter', 0))
  })
})

describe('simple meters', () => {
  it('accents 4/4 on one and three', () => {
    expect(meter(4, 4).accents).toEqual(['strong', 'weak', 'medium', 'weak'])
  })

  it('accents 3/4 only on the downbeat', () => {
    expect(meter(3, 4).accents).toEqual(['strong', 'weak', 'weak'])
  })

  it('accents 2/4 only on the downbeat', () => {
    expect(meter(2, 4).accents).toEqual(['strong', 'weak'])
  })

  it('does not give a duple meter a spurious mid-bar accent', () => {
    // Two beats has a "midpoint" at index 1, which must NOT become an accent.
    expect(meter(6, 8).accents).toEqual(['strong', 'weak'])
    expect(meter(2, 2).accents).toEqual(['strong', 'weak'])
  })

  it('treats 9/8 as compound triple', () => {
    const m = meter(9, 8)
    expect(m.class).toBe('compound')
    expect(m.beats).toBe(3)
    expect(m.accents).toEqual(['strong', 'weak', 'weak'])
  })

  it('does not call 3/8 compound — it is three eighths, not one beat', () => {
    expect(meter(3, 8).class).toBe('simple')
    expect(meter(3, 8).beats).toBe(3)
  })
})

describe('asymmetric meters', () => {
  it('defaults 7/8 to 2+2+3 and accents every group start', () => {
    const m = meter(7, 8)
    expect(m.class).toBe('asymmetric')
    expect(m.grouping).toEqual([2, 2, 3])
    expect(m.beats).toBe(3)
    expect(m.accents).toEqual(['strong', 'medium', 'medium'])
    expect(beatOnsets(m).map((t) => t / m.pulseTicks)).toEqual([0, 2, 4])
  })

  it('moves the accents when regrouped as 3+2+2', () => {
    const m = meter(7, 8, { grouping: [3, 2, 2] })
    expect(beatOnsets(m).map((t) => t / m.pulseTicks)).toEqual([0, 3, 5])
    expect(m.description).toBe('asymmetric — grouped 3+2+2')
  })

  it('offers the real alternatives for the UI to present', () => {
    expect(groupingOptions(7, 8)).toEqual([
      [2, 2, 3],
      [3, 2, 2],
      [2, 3, 2],
    ])
    expect(groupingOptions(4, 4)).toEqual([[1, 1, 1, 1]])
  })

  it('lets 5/4 be counted in five or grouped 3+2', () => {
    const even = meter(5, 4)
    expect(even.class).toBe('simple')
    expect(even.beats).toBe(5)

    const grouped = meter(5, 4, { grouping: [3, 2] })
    expect(grouped.class).toBe('asymmetric')
    expect(grouped.beats).toBe(2)
    expect(grouped.accents).toEqual(['strong', 'medium'])
  })

  it('defaults 5/8 to 3+2', () => {
    expect(defaultGrouping(5, 8)).toEqual([3, 2])
  })
})

describe('validation', () => {
  it('rejects a grouping that does not sum to the numerator', () => {
    expect(() => meter(7, 8, { grouping: [2, 2, 2] })).toThrow(RangeError)
    expect(() => meter(4, 4, { grouping: [1, 1, 1, 1, 1] })).toThrow(RangeError)
  })

  it('rejects a nonsense numerator', () => {
    expect(() => meter(0, 4)).toThrow(RangeError)
    expect(() => meter(-3, 4)).toThrow(RangeError)
  })

  it('gives every common meter an exact tick count', () => {
    for (const m of COMMON_METERS) {
      expect(Number.isInteger(m.barTicks)).toBe(true)
      expect(Number.isInteger(m.pulseTicks)).toBe(true)
      expect(m.pulseTicks * m.numerator).toBe(m.barTicks)
      expect(m.accents).toHaveLength(m.beats)
      expect(m.grouping.reduce((a, b) => a + b, 0)).toBe(m.numerator)
    }
  })
})

describe('the grid', () => {
  it('lists every subdivision', () => {
    const m = meter(12, 8)
    expect(subdivisionOnsets(m)).toHaveLength(12)
    expect(subdivisionOnsets(m)[3]).toBe(3 * m.pulseTicks)
  })

  it('locates a tick within its beat', () => {
    const m = meter(12, 8)
    expect(beatAt(m, 0)).toEqual({ beat: 0, offsetTicks: 0 })
    expect(beatAt(m, 3 * m.pulseTicks)).toEqual({ beat: 1, offsetTicks: 0 })
    expect(beatAt(m, 4 * m.pulseTicks)).toEqual({ beat: 1, offsetTicks: m.pulseTicks })
    expect(beatAt(m, 9 * m.pulseTicks)).toEqual({ beat: 3, offsetTicks: 0 })
  })

  it('derives accents purely from the grouping', () => {
    expect(accentsFor([3, 3, 3, 3])).toEqual(['strong', 'weak', 'medium', 'weak'])
    expect(accentsFor([2, 2, 3])).toEqual(['strong', 'medium', 'medium'])
    expect(accentsFor([1, 1, 1])).toEqual(['strong', 'weak', 'weak'])
  })
})
