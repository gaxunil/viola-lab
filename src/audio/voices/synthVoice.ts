/**
 * The fallback instrument, and the first sound the app ever makes.
 *
 * This is deliberately not the slide deck's voice. That envelope was a plucked
 * shape — a 20ms attack decaying across the whole note — which is wrong for a
 * bowed string in a way a violist notices immediately. A bow takes time to speak
 * and then SUSTAINS, so the envelope holds and releases rather than decaying.
 *
 * The release is linear rather than exponential for two reasons: an exponential
 * ramp cannot legally target zero, and the usual workaround of ramping to 0.0001
 * leaves an audible tail on a sustained note.
 *
 * It will never be mistaken for a viola. It exists so the app still works on a
 * school network that will not give us the samples, and so the whole timing
 * engine could be shipped and tested before any audio assets existed.
 */

import { NOTE_PEAK, SYNTH_ATTACK_SEC, SYNTH_RELEASE_SEC } from '../constants'
import type { Instrument, Voice } from './voice'

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

export interface SynthOptions {
  /** Slight detune between the two oscillators, in cents. */
  readonly detuneCents?: number
  readonly vibratoHz?: number
  readonly vibratoCents?: number
}

export function createSynthInstrument(
  context: AudioContext,
  o: SynthOptions = {},
): Instrument {
  const detuneCents = o.detuneCents ?? 5
  const vibratoHz = o.vibratoHz ?? 5.2
  const vibratoCents = o.vibratoCents ?? 6

  return {
    name: 'synth',
    lowMidi: 0,
    highMidi: 127,

    play({ midi, atTime, durationSec, velocity, destination }): Voice {
      const freq = midiToFreq(midi)
      const attack = Math.min(SYNTH_ATTACK_SEC, durationSec * 0.4)
      const release = Math.min(SYNTH_RELEASE_SEC, durationSec * 0.4)
      const peak = NOTE_PEAK * velocity

      const env = context.createGain()
      env.gain.setValueAtTime(0, atTime)
      env.gain.linearRampToValueAtTime(peak, atTime + attack)
      env.gain.setValueAtTime(peak, Math.max(atTime + attack, atTime + durationSec - release))
      env.gain.linearRampToValueAtTime(0, atTime + durationSec)

      // Roll off the sawtooth's upper harmonics so it reads as a bowed string
      // rather than a buzzer.
      const filter = context.createBiquadFilter()
      filter.type = 'lowpass'
      filter.frequency.value = Math.min(freq * 5, 5200)
      filter.Q.value = 0.6

      env.connect(filter)
      filter.connect(destination)

      // A touch of vibrato above the open C, which is where a player would use it.
      let lfo: OscillatorNode | null = null
      let lfoGain: GainNode | null = null
      if (midi > 55) {
        lfo = context.createOscillator()
        lfo.frequency.value = vibratoHz
        lfoGain = context.createGain()
        lfoGain.gain.setValueAtTime(0, atTime)
        lfoGain.gain.linearRampToValueAtTime(vibratoCents, atTime + attack * 2)
        lfo.connect(lfoGain)
        lfo.start(atTime)
        lfo.stop(atTime + durationSec + 0.05)
      }

      const oscillators: OscillatorNode[] = []
      for (const cents of [-detuneCents, detuneCents]) {
        const osc = context.createOscillator()
        osc.type = 'sawtooth'
        osc.frequency.value = freq
        osc.detune.value = cents
        lfoGain?.connect(osc.detune)

        const half = context.createGain()
        half.gain.value = 0.5
        osc.connect(half)
        half.connect(env)

        osc.start(atTime)
        osc.stop(atTime + durationSec + 0.05)
        oscillators.push(osc)
      }

      return {
        release(at, fadeSec = SYNTH_RELEASE_SEC) {
          env.gain.cancelScheduledValues(at)
          env.gain.setValueAtTime(Math.max(env.gain.value, 0.0001), at)
          env.gain.linearRampToValueAtTime(0, at + fadeSec)
          for (const osc of oscillators) {
            try {
              osc.stop(at + fadeSec + 0.01)
            } catch {
              // Already stopped.
            }
          }
        },
        stop(at) {
          for (const osc of oscillators) {
            try {
              osc.stop(at)
            } catch {
              // Already stopped.
            }
          }
          try {
            lfo?.stop(at)
          } catch {
            // Already stopped.
          }
        },
      }
    },
  }
}
