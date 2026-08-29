/**
 * The metronome click.
 *
 * A short filtered noise burst rather than a sine blip: noise cuts through a
 * bowed instrument at a much lower level than a tone does, so she can hear the
 * pulse without it drowning the note she is trying to tune.
 *
 * Accent is carried by pitch and level together. Level alone is not enough on a
 * phone speaker at practice-room volume.
 */

import { CLICK_FREQ, CLICK_LENGTH_SEC, CLICK_PEAK } from '../constants'
import type { AccentLevel } from '@core/rhythm/meter'
import type { Voice } from './voice'

export interface ClickInstrument {
  play(o: { accent: AccentLevel; atTime: number; destination: AudioNode }): Voice
}

export function createClickInstrument(context: AudioContext): ClickInstrument {
  // One short noise buffer, reused by every click.
  const length = Math.ceil(context.sampleRate * CLICK_LENGTH_SEC)
  const buffer = context.createBuffer(1, length, context.sampleRate)
  const data = buffer.getChannelData(0)
  for (let i = 0; i < length; i++) {
    data[i] = Math.random() * 2 - 1
  }

  const LEVEL: Readonly<Record<AccentLevel, number>> = {
    strong: 1,
    medium: 0.72,
    weak: 0.5,
  }

  return {
    play({ accent, atTime, destination }): Voice {
      const source = context.createBufferSource()
      source.buffer = buffer

      const band = context.createBiquadFilter()
      band.type = 'bandpass'
      band.frequency.value = CLICK_FREQ[accent]
      band.Q.value = 1.6

      const env = context.createGain()
      const peak = CLICK_PEAK * LEVEL[accent]
      env.gain.setValueAtTime(0, atTime)
      env.gain.linearRampToValueAtTime(peak, atTime + 0.001)
      env.gain.exponentialRampToValueAtTime(0.0001, atTime + CLICK_LENGTH_SEC)

      source.connect(band)
      band.connect(env)
      env.connect(destination)

      source.start(atTime)
      source.stop(atTime + CLICK_LENGTH_SEC + 0.01)

      return {
        release(at) {
          try {
            source.stop(at + 0.01)
          } catch {
            // Already stopped.
          }
        },
        stop(at) {
          try {
            source.stop(at)
          } catch {
            // Already stopped.
          }
        },
      }
    },
  }
}
