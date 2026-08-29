/**
 * Where scheduled events actually go.
 *
 * Three methods, chosen for behaviour rather than to mirror Web Audio's shape.
 * The transport talks only to this, so a test can hand it a recorder and assert
 * on exactly what was scheduled and when, with no audio involved.
 */

import type { MusicalEvent } from '@core/score'

export interface EventSink {
  /** Open a fresh bus for a new playback run. */
  beginRun(): void

  /** Schedule one event to sound at an absolute time on the audio clock. */
  scheduleEvent(event: MusicalEvent, atTime: number, durationSec: number): void

  /**
   * Silence everything, including events already scheduled in the future.
   *
   * Must be idempotent: a double stop from an Escape key and a button click at
   * the same moment is a real user path.
   */
  allNotesOff(atTime: number, fadeSec: number): void
}

/** A sink that does nothing, for wiring up before there is any sound. */
export const NULL_SINK: EventSink = {
  beginRun() {},
  scheduleEvent() {},
  allNotesOff() {},
}
