import { describe, expect, it } from 'vitest'
import {
  type Grade,
  type GridPoint,
  type Tap,
  defaultWindows,
  gradeFor,
  scoreTaps,
} from './tapScore'

const ALLOWED_GRADES: readonly (Grade | 'missed' | 'extra')[] = [
  'perfect',
  'great',
  'good',
  'early',
  'late',
  'missed',
  'extra',
]

/** Accents follow a 4/4 feel so the fixtures look like real bars. */
function gridOf(times: readonly number[]): GridPoint[] {
  return times.map((time, index) => ({
    index,
    time,
    accent: index % 4 === 0 ? 'strong' : index % 2 === 0 ? 'medium' : 'weak',
  }))
}

function beatsOf(count: number, beatSec = 0.5, start = 0): number[] {
  return Array.from({ length: count }, (_, i) => start + i * beatSec)
}

function tapsOf(times: readonly number[]): Tap[] {
  return times.map((time) => ({ time }))
}

/** Taps that sit at each grid time plus the matching signed offset. */
function tapsOffsetFrom(times: readonly number[], offsets: readonly number[]): Tap[] {
  return times.map((t, i) => ({ time: t + (offsets[i] ?? 0) }))
}

const W = defaultWindows(0.5)

describe('matching taps to grid points', () => {
  const grid = gridOf([0, 0.5, 1.0, 1.5])
  const taps = tapsOf([0.52, 1.01, 1.53, 1.55])
  const result = scoreTaps(grid, taps, W)

  it('counts three hits, one miss and one extra for the worked example', () => {
    expect(result.hitCount).toBe(3)
    expect(result.missCount).toBe(1)
    expect(result.extraCount).toBe(1)
  })

  it('reports the missed grid point as index 0, the beat she never played', () => {
    const missed = result.matches.filter((m) => m.grade === 'missed')
    expect(missed).toHaveLength(1)
    expect(missed[0]?.gridIndex).toBe(0)
    expect(missed[0]?.tapIndex).toBeNull()
    expect(missed[0]?.errorSec).toBeNull()
  })

  // The whole point of the sorted-candidate pass. Nearest-neighbour-per-tap
  // would let the tap at 1.55 take grid point 3 and leave the tap at 1.53
  // homeless, which reads back as a miss she can hear she did not make.
  it('does not let the tap at 1.55 steal grid index 3 from the tap at 1.53', () => {
    const third = result.matches.find((m) => m.gridIndex === 3)
    expect(third?.tapIndex).toBe(2)
    expect(third?.errorSec).toBeCloseTo(0.03, 6)

    const extra = result.matches.find((m) => m.grade === 'extra')
    expect(extra?.tapIndex).toBe(3)
    expect(extra?.gridIndex).toBeNull()
  })

  it('pairs each remaining tap with the grid point it was aiming at', () => {
    expect(result.matches.find((m) => m.gridIndex === 1)?.tapIndex).toBe(0)
    expect(result.matches.find((m) => m.gridIndex === 2)?.tapIndex).toBe(1)
  })

  it('returns the matches in timeline order, extras included', () => {
    expect(result.matches.map((m) => m.gridIndex)).toEqual([0, 1, 2, 3, null])
  })

  it('is deterministic — the same input scores identically twice', () => {
    expect(scoreTaps(grid, taps, W)).toEqual(result)
  })
})

describe('grid slot consumption', () => {
  it('consumes each grid slot at most once when four taps crowd one beat', () => {
    const grid = gridOf([0, 0.5, 1.0])
    const result = scoreTaps(grid, tapsOf([0.48, 0.5, 0.52, 0.54, 0.98, 1.0]), W)

    const claimed = result.matches
      .filter((m) => m.gridIndex !== null && m.tapIndex !== null)
      .map((m) => m.gridIndex)

    expect(new Set(claimed).size).toBe(claimed.length)
    expect(result.hitCount).toBe(2)
    expect(result.extraCount).toBe(4)
  })

  it('consumes each tap at most once', () => {
    const result = scoreTaps(gridOf([0, 0.05, 0.1]), tapsOf([0.06]), W)
    const usedTaps = result.matches.map((m) => m.tapIndex).filter((t) => t !== null)
    expect(new Set(usedTaps).size).toBe(usedTaps.length)
    expect(result.hitCount).toBe(1)
    expect(result.missCount).toBe(2)
  })

  it('keeps hits, misses and extras summing back to the grid and the taps', () => {
    const grid = gridOf(beatsOf(8))
    const taps = tapsOf([0.01, 0.02, 0.52, 1.6, 2.02, 2.51, 2.52, 9.0])
    const result = scoreTaps(grid, taps, W)

    expect(result.hitCount + result.missCount).toBe(grid.length)
    expect(result.hitCount + result.extraCount).toBe(taps.length)
  })

  it('leaves a tap further away than maxMatch unmatched', () => {
    const result = scoreTaps(gridOf([0]), tapsOf([0.3]), W)
    expect(result.hitCount).toBe(0)
    expect(result.missCount).toBe(1)
    expect(result.extraCount).toBe(1)
  })

  it('still matches a tap sitting exactly on the maxMatch boundary', () => {
    const result = scoreTaps(gridOf([0]), tapsOf([W.maxMatch]), W)
    expect(result.hitCount).toBe(1)
  })
})

describe('bias and precision as separate readings', () => {
  it('scores a perfectly on-time performance at 100 with no bias and no spread', () => {
    const times = beatsOf(8)
    const result = scoreTaps(gridOf(times), tapsOf(times), W)

    expect(result.score100).toBeCloseTo(100, 6)
    expect(result.biasSec).toBeCloseTo(0, 9)
    expect(result.precisionSec).toBeCloseTo(0, 9)
    expect(result.missCount).toBe(0)
    expect(result.extraCount).toBe(0)
  })

  // Steady but offset: the player is doing well and the device is lying.
  it('reads a consistently 45 ms late run as steady, biased, and worth recalibrating', () => {
    const times = beatsOf(8)
    const offsets = [0.044, 0.045, 0.046, 0.045, 0.044, 0.046, 0.045, 0.045]
    const result = scoreTaps(gridOf(times), tapsOffsetFrom(times, offsets), W)

    expect(result.hitCount).toBe(8)
    expect(result.biasSec).toBeCloseTo(0.045, 6)
    expect(result.precisionSec).toBeLessThan(0.002)
    expect(result.suggestRecalibration).toBe(true)
  })

  // Scattered but centred: the opposite diagnosis, from a bias of exactly zero.
  it('does not suggest recalibration for a scattered run with no bias', () => {
    const times = beatsOf(8)
    const offsets = [-0.09, 0.09, -0.06, 0.06, -0.03, 0.03, 0, 0]
    const result = scoreTaps(gridOf(times), tapsOffsetFrom(times, offsets), W)

    expect(result.biasSec).toBeCloseTo(0, 9)
    expect(result.precisionSec).toBeGreaterThan(0.04)
    expect(result.suggestRecalibration).toBe(false)
  })

  it('does not suggest recalibration from too few taps to be sure', () => {
    const times = beatsOf(3)
    const result = scoreTaps(gridOf(times), tapsOffsetFrom(times, [0.05, 0.05, 0.05]), W)

    expect(result.hitCount).toBe(3)
    expect(result.biasSec).toBeCloseTo(0.05, 6)
    expect(result.suggestRecalibration).toBe(false)
  })

  it('takes the bias as a median, so one wild tap does not drag it', () => {
    const times = beatsOf(8)
    const offsets = [0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.02, 0.2]
    const result = scoreTaps(gridOf(times), tapsOffsetFrom(times, offsets), W)

    expect(result.biasSec).toBeCloseTo(0.02, 6)
  })

  it('reports the same precision whether or not the whole run is shifted', () => {
    const times = beatsOf(6)
    const shape = [0, 0.01, -0.01, 0.02, -0.02, 0]
    const centred = scoreTaps(gridOf(times), tapsOffsetFrom(times, shape), W)
    const shifted = scoreTaps(
      gridOf(times),
      tapsOffsetFrom(times, shape.map((x) => x + 0.03)),
      W,
    )

    expect(shifted.precisionSec).toBeCloseTo(centred.precisionSec, 9)
    expect(shifted.biasSec).toBeCloseTo(centred.biasSec + 0.03, 6)
  })
})

describe('grades', () => {
  it('grades inside the windows without ever naming a failure', () => {
    expect(gradeFor(0, W)).toBe('perfect')
    expect(gradeFor(0.035, W)).toBe('perfect')
    expect(gradeFor(-0.035, W)).toBe('perfect')
    expect(gradeFor(0.036, W)).toBe('great')
    expect(gradeFor(0.07, W)).toBe('great')
    expect(gradeFor(0.071, W)).toBe('good')
    expect(gradeFor(0.12, W)).toBe('good')
  })

  it('reports anything past good as a direction rather than a verdict', () => {
    expect(gradeFor(0.121, W)).toBe('late')
    expect(gradeFor(-0.121, W)).toBe('early')
    expect(gradeFor(5, W)).toBe('late')
    expect(gradeFor(-5, W)).toBe('early')
  })

  it('never produces a grade outside the five plus missed and extra', () => {
    const grid = gridOf(beatsOf(8))
    const taps = tapsOf([0.01, 0.2, 0.53, 1.09, 1.11, 2.4, 2.52, 3.4, 7.0])
    const result = scoreTaps(grid, taps, W)

    for (const m of result.matches) {
      expect(ALLOWED_GRADES).toContain(m.grade)
    }
    expect(result.matches.some((m) => m.grade === 'missed')).toBe(true)
    expect(result.matches.some((m) => m.grade === 'extra')).toBe(true)
  })

  it('still counts a tap outside the good window as a hit, graded directionally', () => {
    const slow = defaultWindows(1.0)
    const result = scoreTaps(gridOf([0, 1.0]), tapsOf([0.22]), slow)

    expect(result.hitCount).toBe(1)
    expect(result.matches.find((m) => m.gridIndex === 0)?.grade).toBe('late')
  })
})

describe('best streak', () => {
  it('counts the longest run of consecutive hits', () => {
    const times = beatsOf(8)
    const result = scoreTaps(gridOf(times), tapsOf([0, 0.5, 1.0, 2.0, 2.5, 3.0, 3.5]), W)

    expect(result.missCount).toBe(1)
    expect(result.bestStreak).toBe(4)
  })

  it('reports the best run, not the most recent one', () => {
    const result = scoreTaps(gridOf(beatsOf(7)), tapsOf([0, 0.5, 1.0, 1.5, 2.0, 3.0]), W)
    expect(result.bestStreak).toBe(5)
  })

  it('equals the grid length for a flawless run', () => {
    const times = beatsOf(6)
    expect(scoreTaps(gridOf(times), tapsOf(times), W).bestStreak).toBe(6)
  })

  it('is zero when nothing landed', () => {
    expect(scoreTaps(gridOf(beatsOf(4)), [], W).bestStreak).toBe(0)
  })
})

describe('tempo-scaled windows', () => {
  it('uses the plain figures at the 120 bpm reference tempo', () => {
    const w = defaultWindows(0.5)
    expect(w.perfect).toBeCloseTo(0.035, 9)
    expect(w.great).toBeCloseTo(0.07, 9)
    expect(w.good).toBeCloseTo(0.12, 9)
    expect(w.maxMatch).toBeCloseTo(0.25, 9)
  })

  it('widens at slow tempos and narrows at fast ones', () => {
    const slow = defaultWindows(0.8)
    const reference = defaultWindows(0.5)
    const fast = defaultWindows(0.4)

    expect(slow.perfect).toBeGreaterThan(reference.perfect)
    expect(reference.perfect).toBeGreaterThan(fast.perfect)
    expect(slow.good).toBeGreaterThan(reference.good)
    expect(reference.good).toBeGreaterThan(fast.good)
  })

  it('clamps so a very slow tempo never becomes absurdly forgiving', () => {
    expect(defaultWindows(4.0).perfect).toBeCloseTo(0.035 * 1.6, 9)
    expect(defaultWindows(4.0).perfect).toBeCloseTo(defaultWindows(0.8).perfect, 9)
  })

  it('clamps so a very fast tempo never becomes unhittable', () => {
    expect(defaultWindows(0.1).perfect).toBeCloseTo(0.035 * 0.7, 9)
    expect(defaultWindows(0.1).perfect).toBeCloseTo(defaultWindows(0.35).perfect, 9)
  })

  it('never reaches more than halfway to the next beat, and caps at 250 ms', () => {
    expect(defaultWindows(0.2).maxMatch).toBeCloseTo(0.1, 9)
    expect(defaultWindows(1.0).maxMatch).toBeCloseTo(0.25, 9)
    expect(defaultWindows(4.0).maxMatch).toBeCloseTo(0.25, 9)
  })
})

describe('the score curve', () => {
  const times = beatsOf(4)
  const scoreAtOffset = (offset: number): number =>
    scoreTaps(gridOf(times), tapsOffsetFrom(times, times.map(() => offset)), W).score100

  it('improves for every 2 ms improvement, with no flat spots', () => {
    const offsets = Array.from({ length: 24 }, (_, i) => 0.03 + i * 0.002)
    const scores = offsets.map(scoreAtOffset)

    for (let i = 1; i < scores.length; i++) {
      expect(scores[i] ?? 0).toBeLessThan(scores[i - 1] ?? 0)
    }
  })

  it('has no cliff at the perfect or great boundary', () => {
    const offsets = Array.from({ length: 24 }, (_, i) => 0.03 + i * 0.002)
    const scores = offsets.map(scoreAtOffset)

    for (let i = 1; i < scores.length; i++) {
      const drop = (scores[i - 1] ?? 0) - (scores[i] ?? 0)
      expect(drop).toBeGreaterThan(0.1)
      expect(drop).toBeLessThan(3)
    }
  })

  it('charges an extra tap less than a missed beat', () => {
    const times8 = beatsOf(8)
    const oneMissed = scoreTaps(gridOf(times8), tapsOf(times8.slice(0, 7)), W)
    const oneExtra = scoreTaps(gridOf(times8), tapsOf([...times8, 9.0]), W)

    expect(oneExtra.missCount).toBe(0)
    expect(oneExtra.extraCount).toBe(1)
    expect(oneExtra.score100).toBeGreaterThan(oneMissed.score100)
  })

  it('stays inside 0..100 even for a run of pure extras', () => {
    const result = scoreTaps(gridOf([0]), tapsOf([10, 11, 12, 13, 14, 15]), W)
    expect(result.score100).toBeGreaterThanOrEqual(0)
    expect(result.score100).toBeLessThanOrEqual(100)
  })
})

describe('the summary sentence', () => {
  it('leads with steadiness and always surfaces the best streak', () => {
    const times = beatsOf(8)
    const result = scoreTaps(gridOf(times), tapsOf(times), W)

    expect(result.summary).toMatch(/^Rock steady/)
    expect(result.summary).toContain('best run was 8 in a row')
  })

  it('offers a direction and a figure rather than a verdict when she rushes', () => {
    const times = beatsOf(8)
    const offsets = [-0.03, -0.028, -0.032, -0.03, -0.031, -0.029, -0.03, -0.03]
    const result = scoreTaps(gridOf(times), tapsOffsetFrom(times, offsets), W)

    expect(result.biasSec).toBeCloseTo(-0.03, 6)
    expect(result.summary).toContain('ahead of the beat')
    expect(result.summary).toContain('30 ms')
  })

  it('blames the device, not the player, when the offset is steady enough', () => {
    const times = beatsOf(8)
    const offsets = [0.044, 0.045, 0.046, 0.045, 0.044, 0.046, 0.045, 0.045]
    const result = scoreTaps(gridOf(times), tapsOffsetFrom(times, offsets), W)

    expect(result.summary).toContain('calibration')
    expect(result.summary).toContain('the device rather than you')
  })

  it('never scolds, however messy the run', () => {
    const grid = gridOf(beatsOf(8))
    const taps = tapsOf([0.2, 0.9, 1.4, 3.9, 6.0])
    const result = scoreTaps(grid, taps, W)

    expect(result.summary).not.toMatch(/\b(bad|fail|failed|wrong|poor|sloppy|terrible)\b/i)
    expect(result.summary.length).toBeGreaterThan(0)
  })
})

describe('degenerate input', () => {
  it('returns a well-formed empty result for an empty grid', () => {
    const result = scoreTaps([], tapsOf([1.0]), W)

    expect(result.hitCount).toBe(0)
    expect(result.missCount).toBe(0)
    expect(result.extraCount).toBe(1)
    expect(result.score100).toBe(0)
    expect(result.bestStreak).toBe(0)
    expect(result.summary).toBe('Nothing to score yet — start the click and tap along.')
  })

  it('marks every grid point missed when she never taps', () => {
    const result = scoreTaps(gridOf(beatsOf(4)), [], W)

    expect(result.missCount).toBe(4)
    expect(result.matches.every((m) => m.grade === 'missed')).toBe(true)
    expect(result.score100).toBe(0)
    expect(result.summary).toContain('find the pulse together')
  })

  it('matches correctly even when the grid arrives out of order', () => {
    const grid: GridPoint[] = [
      { index: 2, time: 1.0, accent: 'medium' },
      { index: 0, time: 0, accent: 'strong' },
      { index: 1, time: 0.5, accent: 'weak' },
    ]
    const result = scoreTaps(grid, tapsOf([0.01, 0.51, 1.01]), W)

    expect(result.hitCount).toBe(3)
    expect(result.bestStreak).toBe(3)
    expect(result.matches.map((m) => m.gridIndex)).toEqual([0, 1, 2])
  })
})

describe('the summary never contradicts itself', () => {
  // Precision and bias are separate facts, and the sentence has to keep them
  // separate: someone can be perfectly even AND consistently late.
  it('does not claim perfect placement for a player who is steady but late', () => {
    const grid = [0, 0.5, 1.0, 1.5].map((time, index) => ({
      index,
      time,
      accent: 'weak' as const,
    }))
    const taps = grid.map((g) => ({ time: g.time + 0.045 }))
    const result = scoreTaps(grid, taps, defaultWindows(0.5))

    expect(result.precisionSec).toBeCloseTo(0, 6)
    expect(result.biasSec).toBeCloseTo(0.045, 6)
    expect(result.suggestRecalibration).toBe(true)

    // It may praise the consistency, but must not say she was on the click.
    expect(result.summary).not.toMatch(/dead on|on the click\b/i)
    expect(result.summary).toMatch(/same place|steady/i)
    expect(result.summary).toMatch(/45 ms/)
  })
})
