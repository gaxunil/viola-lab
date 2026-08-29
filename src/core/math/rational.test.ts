import { describe, expect, it } from 'vitest'
import {
  ONE,
  ZERO,
  formatRational,
  isZero,
  radd,
  rat,
  rcmp,
  rdiv,
  req,
  rmul,
  rsub,
  rsum,
  toNumber,
} from './rational'

describe('rat', () => {
  it('normalizes to lowest terms so equality is structural', () => {
    expect(rat(6, 8)).toEqual({ n: 3, d: 4 })
    expect(rat(10, 5)).toEqual({ n: 2, d: 1 })
    expect(req(rat(6, 8), rat(3, 4))).toBe(true)
  })

  it('normalizes sign onto the numerator', () => {
    expect(rat(1, -2)).toEqual({ n: -1, d: 2 })
    expect(rat(-1, -2)).toEqual({ n: 1, d: 2 })
  })

  it('defaults the denominator to 1', () => {
    expect(rat(3)).toEqual({ n: 3, d: 1 })
  })

  it('rejects a zero denominator and non-integer parts', () => {
    expect(() => rat(1, 0)).toThrow(RangeError)
    expect(() => rat(1.5, 2)).toThrow(RangeError)
  })
})

describe('arithmetic', () => {
  it('adds and subtracts exactly', () => {
    expect(radd(rat(1, 3), rat(1, 6))).toEqual(rat(1, 2))
    expect(rsub(rat(1, 2), rat(1, 3))).toEqual(rat(1, 6))
  })

  it('multiplies and divides exactly', () => {
    expect(rmul(rat(2, 3), rat(3, 4))).toEqual(rat(1, 2))
    expect(rdiv(rat(1, 2), rat(2, 3))).toEqual(rat(3, 4))
    expect(() => rdiv(ONE, ZERO)).toThrow(RangeError)
  })

  it('compares without floats', () => {
    expect(rcmp(rat(1, 3), rat(1, 2))).toBe(-1)
    expect(rcmp(rat(1, 2), rat(1, 3))).toBe(1)
    expect(rcmp(rat(2, 4), rat(1, 2))).toBe(0)
  })

  it('sums an empty list to zero', () => {
    expect(rsum([])).toEqual(ZERO)
    expect(isZero(rsum([]))).toBe(true)
  })
})

describe('exactness under repeated addition', () => {
  // The reason this module exists. Note that many musical sums happen to be
  // exact in binary floating point already (dotted values are dyadic, and so is
  // 3 x 1/12). The cases below are the ones that genuinely break, verified by
  // measurement rather than assumed.

  it('a 4/4 bar of quarter-note triplets sums exactly to one whole note', () => {
    // Three in the space of two quarters, so each is 1/6. Six of them fill 4/4.
    const quarterTriplet = rat(1, 6)
    const total = rsum(Array.from({ length: 6 }, () => quarterTriplet))
    expect(total).toEqual(ONE)
    expect(req(total, ONE)).toBe(true)

    // In floating point this bar is short by 1.1e-16, so a naive validator
    // rejects a perfectly correct bar.
    const asFloats = Array.from({ length: 6 }, () => 1 / 6).reduce((a, b) => a + b, 0)
    expect(asFloats).not.toBe(1)
    expect(asFloats).toBeLessThan(1)
  })

  it('septuplet sixteenths sum exactly to a quarter', () => {
    const total = rsum(Array.from({ length: 7 }, () => rat(1, 28)))
    expect(total).toEqual(rat(1, 4))

    const asFloats = Array.from({ length: 7 }, () => 1 / 28).reduce((a, b) => a + b, 0)
    expect(asFloats).not.toBe(0.25)
  })

  it('quintuplets across a half note stay exact', () => {
    expect(rsum(Array.from({ length: 10 }, () => rat(1, 20)))).toEqual(rat(1, 2))

    const asFloats = Array.from({ length: 10 }, () => 1 / 20).reduce((a, b) => a + b, 0)
    expect(asFloats).not.toBe(0.5)
  })

  it('dotted values sum exactly (a double-dotted half plus a sixteenth fills 4/4)', () => {
    expect(radd(rat(7, 8), rat(1, 16))).toEqual(rat(15, 16))
    expect(rsum(Array.from({ length: 8 }, () => rat(7, 256)))).toEqual(rat(7, 32))
  })

  it('a bar of twelve eighths in 12/8 sums exactly to the bar length', () => {
    const eighth = rat(1, 8)
    expect(rsum(Array.from({ length: 12 }, () => eighth))).toEqual(rat(3, 2))
  })
})

describe('boundaries', () => {
  it('converts to a float only when asked', () => {
    expect(toNumber(rat(3, 4))).toBe(0.75)
  })

  it('formats whole numbers without a denominator', () => {
    expect(formatRational(rat(4, 2))).toBe('2')
    expect(formatRational(rat(7, 8))).toBe('7/8')
  })
})
