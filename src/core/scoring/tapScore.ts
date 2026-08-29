/**
 * Matching tapped rhythms to a click grid, and turning the result into feedback
 * a fourteen-year-old will want to read.
 *
 * Two things here are easy to get wrong and both are fixed deliberately.
 *
 * The MATCHING is not nearest-neighbour per tap. If each tap independently
 * claims its closest grid point, then two taps landing close together both claim
 * the same onset, one of them wins by a coin toss, and the NEXT onset is
 * reported as missed even though she played it. The player then sees a miss she
 * cannot hear, which is the fastest way to make a practice tool untrustworthy.
 * Instead every plausible pairing is generated, sorted by how good it is, and
 * accepted greedily — so the tightest pairings claim their slots first and each
 * grid point is consumed at most once. It is a global-ish assignment rather than
 * a per-tap decision, and it is deterministic.
 *
 * The REPORTING keeps bias and precision apart. Bias is where the taps sit
 * relative to the click; precision is how much they wander. They are different
 * skills and only one of them is really hers. A player 45 ms late with an 8 ms
 * spread is playing beautifully on an uncalibrated device; a player averaging
 * 0 ms with a 90 ms spread is not playing steadily at all. Any single "accuracy"
 * number tells the first of those two the exact opposite of the truth, so no
 * such number is produced. There is also no failing grade: past `good`, the
 * result is reported as EARLY or LATE, because a direction is something she can
 * act on during the next repetition and "bad" is not.
 */

import { median } from './calibration'
import type { GridPoint } from './gridTypes'

// Re-exported so callers can take the whole scoring API from one module.
export type { GridPoint }


/** A tap, already converted to the audio timebase and already latency-compensated. */
export interface Tap {
  readonly time: number
}

export type Grade = 'perfect' | 'great' | 'good' | 'early' | 'late'

export interface TapMatch {
  /** null means an extra tap that matched nothing. */
  readonly gridIndex: number | null
  /** null means a missed grid point. */
  readonly tapIndex: number | null
  /** Positive = late. null for a miss or an extra, where no error is defined. */
  readonly errorSec: number | null
  readonly grade: Grade | 'missed' | 'extra'
}

export interface ScoringWindows {
  readonly perfect: number
  readonly great: number
  readonly good: number
  /** Beyond this, a tap matches nothing. */
  readonly maxMatch: number
}

export interface TapResult {
  /** In timeline order: grid points at their own time, extra taps at theirs. */
  readonly matches: readonly TapMatch[]
  readonly hitCount: number
  readonly missCount: number
  readonly extraCount: number
  /** Median signed error; positive = dragging. */
  readonly biasSec: number
  /** Standard deviation of the errors — the spread, i.e. steadiness. */
  readonly precisionSec: number
  readonly bestStreak: number
  readonly score100: number
  readonly suggestRecalibration: boolean
  readonly summary: string
}

function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x
}

/**
 * Windows scale with tempo, because 60 ms off at 60 bpm is much better playing
 * than 60 ms off at 160 bpm — the same absolute error is a far smaller fraction
 * of the beat. The clamp stops the slow end from becoming so generous that
 * nothing is ever wrong, and the fast end from becoming unhittable.
 */
export function defaultWindows(beatSec: number): ScoringWindows {
  const k = clamp(beatSec / 0.5, 0.7, 1.6) // 0.5 s beat = 120 bpm is the reference
  return {
    perfect: 0.035 * k,
    great: 0.07 * k,
    good: 0.12 * k,
    // Never reach more than halfway to the neighbouring beat, or a tap could be
    // matched to a grid point on the far side of the one she actually meant.
    maxMatch: Math.min(0.25, beatSec * 0.5),
  }
}

export function gradeFor(errorSec: number, w: ScoringWindows): Grade {
  const magnitude = Math.abs(errorSec)
  if (magnitude <= w.perfect) return 'perfect'
  if (magnitude <= w.great) return 'great'
  if (magnitude <= w.good) return 'good'
  // Past `good` the useful information is not "how wrong" but "which way".
  return errorSec < 0 ? 'early' : 'late'
}

/**
 * Population standard deviation, not the sample estimator. We are describing the
 * spread of the taps she actually played, not estimating a parameter of some
 * larger population of hypothetical taps, so there is no n-1 correction to make.
 */
function standardDeviation(xs: readonly number[]): number {
  if (xs.length < 2) return 0
  const mean = xs.reduce((a, x) => a + x, 0) / xs.length
  const variance = xs.reduce((a, x) => a + (x - mean) ** 2, 0) / xs.length
  return Math.sqrt(variance)
}

interface SortedGridEntry {
  /** Position in the caller's `grid` array — the consumption key. */
  readonly pos: number
  readonly time: number
}

interface Candidate {
  readonly tapIndex: number
  readonly gridPos: number
  readonly errorSec: number
  readonly absError: number
}

/** First entry whose time is >= `t`, over a time-sorted grid. */
function lowerBoundByTime(sorted: readonly SortedGridEntry[], t: number): number {
  let lo = 0
  let hi = sorted.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    const entry = sorted[mid]
    if (entry !== undefined && entry.time < t) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * Recalibration is only worth suggesting once there is enough data to tell a
 * device offset from a couple of eager taps.
 */
const MIN_HITS_FOR_RECALIBRATION = 4
const RECALIBRATION_BIAS_SEC = 0.04
const RECALIBRATION_PRECISION_SEC = 0.025

/**
 * An extra tap costs half what a missed grid point costs. A miss removes a beat
 * she was asked to play; an extra is usually a double-bounce on the screen or an
 * ornament, so it should register without being punished like a hole in the bar.
 */
const EXTRA_TAP_COST = 0.5

export function scoreTaps(
  grid: readonly GridPoint[],
  taps: readonly Tap[],
  w: ScoringWindows,
): TapResult {
  const sorted: SortedGridEntry[] = grid
    .map((gp, pos) => ({ pos, time: gp.time }))
    .sort((a, b) => a.time - b.time || a.pos - b.pos)

  // Step 1: every (tap, grid point) pairing within maxMatch. Found through the
  // time-sorted grid so only the handful of onsets near each tap are visited.
  const candidates: Candidate[] = []
  for (let tapIndex = 0; tapIndex < taps.length; tapIndex++) {
    const tap = taps[tapIndex]
    if (tap === undefined || !Number.isFinite(tap.time)) continue

    for (let s = lowerBoundByTime(sorted, tap.time - w.maxMatch); s < sorted.length; s++) {
      const entry = sorted[s]
      if (entry === undefined) break
      if (entry.time > tap.time + w.maxMatch) break
      const errorSec = tap.time - entry.time
      candidates.push({ tapIndex, gridPos: entry.pos, errorSec, absError: Math.abs(errorSec) })
    }
  }

  // Step 2: best pairings first. The index tie-breaks keep the result identical
  // for identical input, which matters because these scores get compared across
  // sessions and a coin toss inside the sort would make two identical runs differ.
  candidates.sort(
    (a, b) => a.absError - b.absError || a.gridPos - b.gridPos || a.tapIndex - b.tapIndex,
  )

  // Step 3: accept greedily, skipping anything whose tap or slot is already gone.
  const UNCONSUMED = -1
  const gridToTap = Array.from({ length: grid.length }, () => UNCONSUMED)
  const tapConsumed = Array.from({ length: taps.length }, () => false)
  for (const c of candidates) {
    if (tapConsumed[c.tapIndex] === true) continue
    if ((gridToTap[c.gridPos] ?? UNCONSUMED) !== UNCONSUMED) continue
    gridToTap[c.gridPos] = c.tapIndex
    tapConsumed[c.tapIndex] = true
  }

  // Step 4: whatever is left over on each side.
  interface TimelineEntry {
    readonly at: number
    readonly isExtra: boolean
    readonly order: number
    readonly match: TapMatch
  }

  const timeline: TimelineEntry[] = []
  const errors: number[] = []

  for (let pos = 0; pos < grid.length; pos++) {
    const gp = grid[pos]
    if (gp === undefined) continue
    const tapIndex = gridToTap[pos] ?? UNCONSUMED

    if (tapIndex === UNCONSUMED) {
      timeline.push({
        at: gp.time,
        isExtra: false,
        order: gp.index,
        match: { gridIndex: gp.index, tapIndex: null, errorSec: null, grade: 'missed' },
      })
      continue
    }

    const tap = taps[tapIndex]
    if (tap === undefined) continue
    const errorSec = tap.time - gp.time
    errors.push(errorSec)
    timeline.push({
      at: gp.time,
      isExtra: false,
      order: gp.index,
      match: { gridIndex: gp.index, tapIndex, errorSec, grade: gradeFor(errorSec, w) },
    })
  }

  for (let tapIndex = 0; tapIndex < taps.length; tapIndex++) {
    if (tapConsumed[tapIndex] === true) continue
    const tap = taps[tapIndex]
    if (tap === undefined) continue
    timeline.push({
      at: tap.time,
      isExtra: true,
      order: tapIndex,
      match: { gridIndex: null, tapIndex, errorSec: null, grade: 'extra' },
    })
  }

  // Grid points come first at an equal time so a hit reads before a stray tap.
  timeline.sort(
    (a, b) => a.at - b.at || Number(a.isExtra) - Number(b.isExtra) || a.order - b.order,
  )
  const matches = timeline.map((e) => e.match)

  const hitCount = errors.length
  const missCount = grid.length - hitCount
  const extraCount = taps.length - hitCount

  const biasSec = hitCount === 0 ? 0 : median(errors)
  const precisionSec = standardDeviation(errors)

  // The streak runs over grid points in time order. An extra tap does not break
  // it: it has no place in the grid sequence, and there is no reading of the
  // music under which a stray double-bounce undoes the beats around it.
  let bestStreak = 0
  let run = 0
  for (const entry of sorted) {
    if ((gridToTap[entry.pos] ?? UNCONSUMED) !== UNCONSUMED) {
      run += 1
      if (run > bestStreak) bestStreak = run
    } else {
      run = 0
    }
  }

  // A Gaussian falloff rather than the buckets. The grades are for reading; the
  // score is for tracking, and it has to move for a 2 ms improvement instead of
  // sitting flat inside a bucket and then jumping at its edge.
  const good = w.good > 0 ? w.good : Number.EPSILON
  const meanWeight =
    hitCount === 0 ? 0 : errors.reduce((a, e) => a + Math.exp(-((e / good) ** 2)), 0) / hitCount
  const hitRate = grid.length === 0 ? 0 : hitCount / grid.length
  const extraFactor =
    grid.length === 0 ? 1 : clamp(1 - (EXTRA_TAP_COST * extraCount) / grid.length, 0, 1)
  const score100 = clamp(100 * meanWeight * hitRate * extraFactor, 0, 100)

  // Consistently off, but consistent: that is a device that needs measuring, not
  // a player who needs to practise, and saying so is the whole point.
  const suggestRecalibration =
    hitCount >= MIN_HITS_FOR_RECALIBRATION &&
    Math.abs(biasSec) > RECALIBRATION_BIAS_SEC &&
    precisionSec < RECALIBRATION_PRECISION_SEC

  return {
    matches,
    hitCount,
    missCount,
    extraCount,
    biasSec,
    precisionSec,
    bestStreak,
    score100,
    suggestRecalibration,
    summary: summarize({
      gridLength: grid.length,
      hitCount,
      missCount,
      biasSec,
      precisionSec,
      bestStreak,
      suggestRecalibration,
    }),
  }
}

interface SummaryInput {
  readonly gridLength: number
  readonly hitCount: number
  readonly missCount: number
  readonly biasSec: number
  readonly precisionSec: number
  readonly bestStreak: number
  readonly suggestRecalibration: boolean
}

/**
 * Steadiness leads, because it is the skill. The bands are wide on purpose:
 * every one of them is a compliment, and the difference between them is how much
 * room the sentence leaves for "and here is the next thing to try".
 */
function steadinessLead(precisionSec: number): string {
  const spread = precisionSec * 1000
  if (spread < 12) return 'Rock steady'
  if (spread < 25) return 'Really steady'
  if (spread < 45) return 'Steady, and getting steadier'
  if (spread < 80) return 'The pulse is in there'
  return 'Good energy, and the steadiness will follow'
}

/** At most one tip, so the sentence stays short enough to actually be read. */
function tipFor(input: SummaryInput): string {
  const biasMs = Math.round(Math.abs(input.biasSec) * 1000)
  const direction = input.biasSec < 0 ? 'ahead of' : 'behind'

  if (input.suggestRecalibration) {
    return `you sat about ${biasMs} ms ${direction} the beat every single time, which is usually the device rather than you — worth running the calibration`
  }

  if (biasMs >= 15) {
    const size = biasMs >= 60 ? 'clearly' : 'a hair'
    const nudge = input.biasSec < 0 ? 'wait for the click' : 'lean onto the click'
    return `you're ${size} ${direction} the beat — about ${biasMs} ms — so ${nudge} on the next go`
  }

  if (input.missCount > 0 && input.hitCount / input.gridLength < 0.6) {
    return 'a fair few beats slipped past, so drop the tempo a notch and keep exactly this feel'
  }

  return ''
}

function summarize(input: SummaryInput): string {
  if (input.gridLength === 0) return 'Nothing to score yet — start the click and tap along.'
  if (input.hitCount === 0) {
    return "Nothing landed on the grid this time, so let's take the tempo right down and find the pulse together."
  }

  const spreadMs = Math.round(input.precisionSec * 1000)
  const lead = steadinessLead(input.precisionSec)
  // Describe CONSISTENCY here, never accuracy. A player can be perfectly even
  // and still sit behind the beat every time, and saying "dead on the click"
  // would contradict the bias tip that follows two clauses later.
  const core =
    spreadMs < 1
      ? `${lead} — every tap landed in the same place`
      : `${lead} — about ${spreadMs} ms of spread`
  const streak = `your best run was ${input.bestStreak} in a row`
  const tip = tipFor(input)

  return tip === '' ? `${core}, and ${streak}.` : `${core}, and ${streak}; ${tip}.`
}
