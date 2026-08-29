/**
 * Test doubles for the three scheduler seams.
 *
 * Thirty-odd lines, and with them a test that would take eight real seconds of
 * metronome runs in under a millisecond — deterministically, in a node
 * environment, with no browser and no Web Audio. Because there is no real
 * jitter, timing assertions can be exact rather than tolerance-based.
 */

import type { MusicalEvent } from '@core/score'
import type { AudioClock, Ticker } from '../clock'
import type { EventSink } from '../sink'

export class FakeClock implements AudioClock {
  currentTime = 0

  advance(seconds: number): void {
    // Round to nanoseconds so accumulated float error never shows up in an
    // assertion about the clock itself.
    this.currentTime = Number((this.currentTime + seconds).toFixed(9))
  }
}

export class ManualTicker implements Ticker {
  readonly intervalMs: number
  #callback: (() => void) | null = null

  constructor(intervalMs = 25) {
    this.intervalMs = intervalMs
  }

  get isRunning(): boolean {
    return this.#callback !== null
  }

  start(callback: () => void): void {
    this.#callback = callback
  }

  stop(): void {
    this.#callback = null
  }

  /** Fire one tick, as the real timer would. */
  fire(): void {
    this.#callback?.()
  }

  /** Advance the clock in ticker-sized steps, firing at each one. */
  run(clock: FakeClock, seconds: number): void {
    const steps = Math.round((seconds * 1000) / this.intervalMs)
    for (let i = 0; i < steps; i++) {
      clock.advance(this.intervalMs / 1000)
      this.fire()
    }
  }
}

export interface ScheduledCall {
  readonly event: MusicalEvent
  readonly atTime: number
  readonly durationSec: number
}

export class RecordingSink implements EventSink {
  readonly scheduled: ScheduledCall[] = []
  readonly stops: Array<{ atTime: number; fadeSec: number }> = []
  runs = 0

  beginRun(): void {
    this.runs += 1
  }

  scheduleEvent(event: MusicalEvent, atTime: number, durationSec: number): void {
    this.scheduled.push({ event, atTime, durationSec })
  }

  allNotesOff(atTime: number, fadeSec: number): void {
    this.stops.push({ atTime, fadeSec })
  }

  get times(): number[] {
    return this.scheduled.map((s) => s.atTime)
  }

  get ids(): number[] {
    return this.scheduled.map((s) => s.event.id)
  }
}
