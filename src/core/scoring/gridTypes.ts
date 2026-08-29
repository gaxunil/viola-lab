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
  readonly accent: AccentLevel
}
