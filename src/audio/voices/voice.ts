/**
 * What it takes to sound one note.
 *
 * Four members, so a sampled viola and a synth fallback are interchangeable and
 * the sink never learns which one it has. When the samples fail to load, or have
 * not finished loading, the synth stands in for the same interface rather than
 * the app going silent.
 */

export interface Voice {
  /** Release early, before the scheduled duration is up. */
  release(atTime: number, fadeSec?: number): void
  /** Stop hard, for a global cancel. */
  stop(atTime: number): void
}

export interface Instrument {
  readonly name: string
  play(o: {
    midi: number
    atTime: number
    durationSec: number
    velocity: number
    destination: AudioNode
  }): Voice
  readonly lowMidi: number
  readonly highMidi: number
}

/** A voice that has already finished; returned when a note is out of range. */
export const SILENT_VOICE: Voice = {
  release() {},
  stop() {},
}
