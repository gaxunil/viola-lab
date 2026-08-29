import { describe, expect, it } from 'vitest'
import { computeCalibration, median, medianAbsoluteDeviation } from './calibration'

/** The fixtures read in milliseconds, which is how a musician thinks about them. */
function ms(...values: number[]): number[] {
  return values.map((v) => v / 1000)
}

/** Eight taps sitting steadily around a given offset, in milliseconds. */
function steadyAround(centreMs: number): number[] {
  return ms(
    centreMs,
    centreMs + 1,
    centreMs - 1,
    centreMs,
    centreMs + 2,
    centreMs - 2,
    centreMs,
    centreMs + 1,
  )
}

describe('median', () => {
  it('takes the middle value of an odd-length sample', () => {
    expect(median([3, 1, 2])).toBe(2)
    expect(median([5])).toBe(5)
  })

  it('averages the straddling pair of an even-length sample', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5)
    expect(median([4, 1])).toBe(2.5)
  })

  it('has no median for an empty sample, so returns the neutral zero', () => {
    expect(median([])).toBe(0)
  })

  it('does not disturb the caller array', () => {
    const xs = [3, 1, 2]
    median(xs)
    expect(xs).toEqual([3, 1, 2])
  })
})

describe('medianAbsoluteDeviation', () => {
  it('measures how far the sample typically sits from its own middle', () => {
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 5])).toBe(1)
    expect(medianAbsoluteDeviation([7, 7, 7])).toBe(0)
  })

  // A mean-based spread would triple here. This is the reason the module uses it.
  it('barely moves when one value goes wildly astray', () => {
    expect(medianAbsoluteDeviation([1, 2, 3, 4, 500])).toBe(1)
  })

  it('is zero for an empty sample', () => {
    expect(medianAbsoluteDeviation([])).toBe(0)
  })
})

describe('computeCalibration on a usable run', () => {
  // The dropped tap at 900 ms is exactly the case a mean would fall for: it
  // would report an offset of 204 ms and quietly wreck every future score.
  it('accepts 30, 32, 31, 900, 29 ms at a median of 31 ms', () => {
    const result = computeCalibration(ms(30, 32, 31, 900, 29), {
      discardFirst: 0,
      minTaps: 5,
    })

    expect(result.accepted).toBe(true)
    expect(result.reason).toBeUndefined()
    expect(result.medianSec).toBeCloseTo(0.031, 9)
    expect(result.offsetSec).toBeCloseTo(0.031, 9)
    expect(result.madSec).toBeCloseTo(0.001, 9)
    expect(result.usedCount).toBe(5)
  })

  it('reports a positive offset as the device landing behind the click', () => {
    const result = computeCalibration(steadyAround(40), { discardFirst: 0 })

    expect(result.accepted).toBe(true)
    expect(result.offsetSec).toBeGreaterThan(0)
    expect(result.message).toContain('behind the click')
    expect(result.message).toContain('40 ms')
  })

  it('accepts a negative offset just as readily and calls it ahead of the click', () => {
    const result = computeCalibration(steadyAround(-35), { discardFirst: 0 })

    expect(result.accepted).toBe(true)
    expect(result.offsetSec).toBeCloseTo(-0.035, 9)
    expect(result.message).toContain('ahead of the click')
  })

  it('ignores taps that never registered', () => {
    const result = computeCalibration([Number.NaN, ...steadyAround(20)], { discardFirst: 0 })

    expect(result.accepted).toBe(true)
    expect(result.usedCount).toBe(8)
    expect(result.offsetSec).toBeCloseTo(0.02, 9)
  })
})

describe('computeCalibration when it should refuse', () => {
  it('rejects 10, 200, -50, 400, 90 ms as inconsistent', () => {
    const result = computeCalibration(ms(10, 200, -50, 400, 90), {
      discardFirst: 0,
      minTaps: 5,
    })

    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('inconsistent')
    expect(result.madSec).toBeGreaterThan(0.035)
  })

  it('persists no offset at all when it refuses, rather than a garbage one', () => {
    const result = computeCalibration(ms(10, 200, -50, 400, 90), {
      discardFirst: 0,
      minTaps: 5,
    })

    expect(result.offsetSec).toBe(0)
    // The median is still reported for diagnostics; it just is not adopted.
    expect(result.medianSec).toBeCloseTo(0.09, 9)
  })

  it('rejects a run with fewer usable taps than minTaps', () => {
    const result = computeCalibration(steadyAround(30).slice(0, 5), { discardFirst: 0 })

    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('too-few-taps')
    expect(result.usedCount).toBe(5)
    expect(result.offsetSec).toBe(0)
  })

  it('rejects an empty run without dividing by anything', () => {
    const result = computeCalibration([])

    expect(result.accepted).toBe(false)
    expect(result.reason).toBe('too-few-taps')
    expect(result.usedCount).toBe(0)
    expect(result.medianSec).toBe(0)
    expect(result.madSec).toBe(0)
  })

  it('asks for another go instead of announcing a failure', () => {
    const scattered = computeCalibration(ms(10, 200, -50, 400, 90), {
      discardFirst: 0,
      minTaps: 5,
    })
    const sparse = computeCalibration(steadyAround(30).slice(0, 5), { discardFirst: 0 })

    expect(scattered.message).toContain("let's try that once more")
    for (const result of [scattered, sparse]) {
      expect(result.message).not.toMatch(/\b(fail|failed|error|invalid|bad|wrong)\b/i)
    }
  })
})

describe('computeCalibration options', () => {
  it('discards the first four taps by default, while she finds the beat', () => {
    const errors = [...ms(500, -400, 450, -350), ...steadyAround(20)]
    const result = computeCalibration(errors)

    expect(result.usedCount).toBe(8)
    expect(result.accepted).toBe(true)
    expect(result.offsetSec).toBeCloseTo(0.02, 9)
  })

  it('turns an otherwise usable run into too-few-taps once four are discarded', () => {
    const errors = [...steadyAround(20), ...ms(21, 19)]
    expect(errors).toHaveLength(10)

    expect(computeCalibration(errors).reason).toBe('too-few-taps')
    expect(computeCalibration(errors, { discardFirst: 0 }).accepted).toBe(true)
  })

  it('honours a custom discardFirst', () => {
    const errors = [...steadyAround(20), ...ms(21, 19)]

    expect(computeCalibration(errors, { discardFirst: 2 }).usedCount).toBe(8)
    expect(computeCalibration(errors, { discardFirst: 100 }).usedCount).toBe(0)
  })

  it('honours a custom minTaps', () => {
    const errors = steadyAround(20).slice(0, 6)

    expect(computeCalibration(errors, { discardFirst: 0 }).reason).toBe('too-few-taps')
    expect(computeCalibration(errors, { discardFirst: 0, minTaps: 6 }).accepted).toBe(true)
  })

  it('honours a custom maxMad, so a tighter standard can reject the same taps', () => {
    const errors = steadyAround(20)

    expect(computeCalibration(errors, { discardFirst: 0 }).accepted).toBe(true)
    expect(computeCalibration(errors, { discardFirst: 0, maxMad: 0.0005 }).reason).toBe(
      'inconsistent',
    )
  })
})
