/**
 * The sampled viola.
 *
 * Implements the same `Instrument` interface as the synth, so the sink never
 * learns which one it has and the app degrades to the synth without a branch
 * anywhere else.
 *
 * The set is fully chromatic, so `maxShiftSemitones` is 0 and nothing is
 * pitch-shifted at all. That is worth stating because it retires a whole class
 * of problem: no chipmunking at the top of the range, no formant smear on a
 * bowed timbre, no argument about how far a sample can be stretched. The
 * zone-selection code still exists for a sparser set, but with this manifest it
 * always finds an exact match.
 *
 * The envelope is deliberately not the synth's. A recorded bow already contains
 * its own attack and body, so applying another one would double the articulation.
 * All this adds is a short de-click ramp in and a bow-lift ramp out.
 */

import { NOTE_PEAK } from './constants'
import type { InstrumentManifest } from './loader'
import type { Instrument, Voice } from './voices/voice'

export type SamplerMode = 'sampled' | 'partial' | 'synth'

export interface ZoneChoice {
  readonly midi: number
  readonly shiftSemitones: number
}

/**
 * Nearest sampled zone, or null when nothing is close enough.
 *
 * Ties break DOWNWARD: shifting a bowed sample up thins it and raises the body
 * resonance into a nasal place, which is more objectionable than the slight
 * dullness of shifting down.
 */
export function pickZone(
  available: readonly number[],
  midi: number,
  maxShift: number,
): ZoneChoice | null {
  let best: ZoneChoice | null = null

  for (const candidate of available) {
    const shift = midi - candidate
    if (Math.abs(shift) > maxShift) continue
    if (best === null || Math.abs(shift) < Math.abs(best.shiftSemitones)) {
      best = { midi: candidate, shiftSemitones: shift }
      continue
    }
    // Equal distance: prefer the lower sample, i.e. a positive shift.
    if (Math.abs(shift) === Math.abs(best.shiftSemitones) && shift > 0) {
      best = { midi: candidate, shiftSemitones: shift }
    }
  }

  return best
}

export interface SamplerOptions {
  readonly context: AudioContext
  readonly manifest: InstrumentManifest
  readonly buffers: ReadonlyMap<number, AudioBuffer>
  /** Used for any pitch the sample set cannot cover. */
  readonly fallback: Instrument
}

export function createSamplerInstrument(o: SamplerOptions): Instrument {
  const available = [...o.buffers.keys()].sort((a, b) => a - b)
  const maxShift = o.manifest.maxShiftSemitones

  return {
    name: 'viola',
    lowMidi: o.manifest.lowestMidi,
    highMidi: o.manifest.highestMidi,

    play({ midi, atTime, durationSec, velocity, destination }): Voice {
      const choice = pickZone(available, midi, maxShift)
      const buffer = choice ? o.buffers.get(choice.midi) : undefined

      // Nothing sampled within reach — the synth covers it rather than silence.
      if (!choice || !buffer) {
        return o.fallback.play({ midi, atTime, durationSec, velocity, destination })
      }

      const source = o.context.createBufferSource()
      source.buffer = buffer
      source.playbackRate.value = Math.pow(2, choice.shiftSemitones / 12)

      const attack = Math.min(o.manifest.attackSec, durationSec * 0.25)
      const release = Math.min(o.manifest.releaseSec, durationSec * 0.4)
      const peak = NOTE_PEAK * velocity

      const env = o.context.createGain()
      env.gain.setValueAtTime(0, atTime)
      // A de-click ramp only. The bow attack is already in the recording.
      env.gain.linearRampToValueAtTime(peak, atTime + attack)
      env.gain.setValueAtTime(peak, Math.max(atTime + attack, atTime + durationSec - release))
      // Linear, because an exponential ramp cannot reach zero and the usual
      // ramp-to-0.0001 leaves a tail on a sustained note.
      env.gain.linearRampToValueAtTime(0, atTime + durationSec)

      source.connect(env)
      env.connect(destination)

      source.start(atTime)
      source.stop(atTime + durationSec + 0.05)

      return {
        release(at, fadeSec = o.manifest.releaseSec) {
          env.gain.cancelScheduledValues(at)
          env.gain.setValueAtTime(Math.max(env.gain.value, 0.0001), at)
          env.gain.linearRampToValueAtTime(0, at + fadeSec)
          try {
            source.stop(at + fadeSec + 0.02)
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

/** How much of the manifest actually made it into memory. */
export function modeFor(manifest: InstrumentManifest, loaded: number): SamplerMode {
  if (loaded === 0) return 'synth'
  return loaded >= manifest.zones.length ? 'sampled' : 'partial'
}
