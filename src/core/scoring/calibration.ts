/**
 * Working out a device's systematic timing offset from a run of practice taps.
 *
 * Every phone, tablet and browser sits a different distance behind the sound it
 * plays. That distance is a constant, and once it is known it can simply be
 * subtracted, at which point a player who was "always 40 ms late" turns out to
 * have been on the beat the whole time. Getting this wrong in the other
 * direction is much worse than not calibrating at all: a bad offset is applied
 * silently to every future session, so a scored run that was actually accurate
 * comes back reading as sloppy and there is nothing on screen to explain why.
 *
 * Two decisions follow from that, and they are the whole module:
 *
 *   - Use the MEDIAN, not the mean. One tap where she sneezed, or one where the
 *     screen missed a touch and the next tap landed a beat late, moves a mean by
 *     tens of milliseconds. The median of the same data does not move at all.
 *
 *   - REFUSE when the taps disagree with each other. The median absolute
 *     deviation says how much they disagree. If it is large, there is no
 *     constant offset hiding in this data — there is just an unsteady run — and
 *     the honest answer is to ask for another go rather than to persist a
 *     number invented from noise.
 */

/** Median of a sample. Empty input has no median; 0 is returned as the neutral offset. */
export function median(xs: readonly number[]): number {
  if (xs.length === 0) return 0

  const sorted = [...xs].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  const upper = sorted[mid] ?? 0

  // Odd length has a true middle element; even length averages the straddling pair.
  if (sorted.length % 2 === 1) return upper
  return ((sorted[mid - 1] ?? 0) + upper) / 2
}

/**
 * Median absolute deviation — the median distance of the sample from its own
 * median. Reported raw, without the 1.4826 normal-consistency factor, because
 * it is used here as a plain "how much do these taps disagree" threshold rather
 * than as an estimate of a standard deviation.
 */
export function medianAbsoluteDeviation(xs: readonly number[]): number {
  if (xs.length === 0) return 0
  const centre = median(xs)
  return median(xs.map((x) => Math.abs(x - centre)))
}

export interface CalibrationResult {
  readonly accepted: boolean
  /** Seconds to subtract from future tap times. Zero whenever `accepted` is false. */
  readonly offsetSec: number
  readonly medianSec: number
  readonly madSec: number
  readonly usedCount: number
  readonly reason?: 'too-few-taps' | 'inconsistent'
  readonly message: string
}

export interface CalibrationOptions {
  /** Taps to drop from the front — she is still finding the beat. */
  readonly discardFirst?: number
  readonly minTaps?: number
  readonly maxMad?: number
}

const DEFAULT_DISCARD_FIRST = 4
const DEFAULT_MIN_TAPS = 8

/**
 * 35 ms is roughly where a listener stops hearing "together" and starts hearing
 * two events, so a run whose taps disagree by more than that is not describing a
 * fixed device latency, whatever its median happens to be.
 */
const DEFAULT_MAX_MAD = 0.035

function ms(seconds: number): number {
  return Math.round(seconds * 1000)
}

/**
 * `errorsSec` are signed offsets against the click, positive meaning the tap
 * landed late. A positive `offsetSec` therefore means the device reports taps
 * late and that amount should be subtracted from future taps.
 */
export function computeCalibration(
  errorsSec: readonly number[],
  o: CalibrationOptions = {},
): CalibrationResult {
  const discardFirst = Math.max(0, Math.trunc(o.discardFirst ?? DEFAULT_DISCARD_FIRST))
  const minTaps = Math.max(1, Math.trunc(o.minTaps ?? DEFAULT_MIN_TAPS))
  const maxMad = o.maxMad ?? DEFAULT_MAX_MAD

  // A dropped tap arrives as NaN rather than as a missing element, so filter for
  // finiteness instead of trusting the caller to have cleaned the array.
  const usable = errorsSec.slice(discardFirst).filter((x) => Number.isFinite(x))

  const medianSec = median(usable)
  const madSec = medianAbsoluteDeviation(usable)
  const usedCount = usable.length

  if (usedCount < minTaps) {
    return {
      accepted: false,
      offsetSec: 0,
      medianSec,
      madSec,
      usedCount,
      reason: 'too-few-taps',
      message:
        usedCount === 0
          ? `I did not catch enough taps to measure anything — tap along with about ${minTaps + discardFirst} clicks and I will sort it out.`
          : `I only caught ${usedCount} usable ${usedCount === 1 ? 'tap' : 'taps'}, and I need ${minTaps} — keep going a little longer and let's try that once more.`,
    }
  }

  if (madSec > maxMad) {
    return {
      accepted: false,
      offsetSec: 0,
      medianSec,
      madSec,
      usedCount,
      reason: 'inconsistent',
      message: `Those taps were spread over about ${ms(madSec)} ms, which is too varied for me to pin down your device — I have left your timing exactly as it was, so let's try that once more with the click nice and loud.`,
    }
  }

  const direction = medianSec >= 0 ? 'behind' : 'ahead of'
  return {
    accepted: true,
    offsetSec: medianSec,
    medianSec,
    madSec,
    usedCount,
    message: `Locked in from ${usedCount} taps: this device lands about ${ms(Math.abs(medianSec))} ms ${direction} the click, and your taps agreed to within ${ms(madSec)} ms — that is a lovely steady reading.`,
  }
}
