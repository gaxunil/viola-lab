/**
 * The shape of a tap target.
 *
 * Kept in its own module so the rhythm compiler (which produces grids) and the
 * scorer (which consumes them) share one definition without either importing the
 * other.
 */

import type { AccentLevel } from '../rhythm/meter'

export interface GridPoint {
  readonly index: number
  /** Seconds in the audio timebase. */
  readonly time: number
  /**
   * Carried through for the UI to render. Deliberately not weighted into the
   * score: at this stage a dropped offbeat and a dropped downbeat are the same
   * amount of "play it again", and weighting them differently would make the
   * number move for reasons she cannot see.
   */
  readonly accent: AccentLevel
}
