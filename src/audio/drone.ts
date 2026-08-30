/**
 * A sustained tonic to play scales against.
 *
 * The classic intonation tool for a string player, and probably the highest
 * value per line of code in the whole app: hearing a scale against a held tonic
 * is how you find out your fourth finger is flat.
 *
 * It hangs off its own bus, a sibling of the transport's rather than a child, so
 * stopping the metronome or the scale does NOT cut the drone she is tuning
 * against. Those are two separate affordances and conflating them would be
 * infuriating.
 *
 * The fifth defaults to JUST intonation — a pure 3:2 — rather than the
 * equal-tempered 1.4983. A violist tuning against a drone wants the interval
 * that actually locks and stops beating, which is the pure one. The companion
 * slide deck teaches exactly this distinction; this is where it pays off.
 */

const midiToFreq = (midi: number): number => 440 * Math.pow(2, (midi - 69) / 12)

export type FifthTuning = 'just' | 'equal'

export interface DroneSpec {
  readonly rootMidi: number
  readonly withFifth?: boolean
  readonly fifthTuning?: FifthTuning
  readonly octaveBelow?: boolean
  /** 0..1 */
  readonly gain?: number
}

export interface Drone {
  start(spec: DroneSpec): void
  update(spec: DroneSpec): void
  stop(fadeSec?: number): void
  setGain(value: number): void
  readonly isPlaying: boolean
  dispose(): void
}

const FADE_SEC = 0.25
const DEFAULT_GAIN = 0.22

interface Layer {
  readonly osc: OscillatorNode[]
  readonly gain: GainNode
}

export function createDrone(context: AudioContext, destination: AudioNode): Drone {
  let layer: Layer | null = null
  let level = DEFAULT_GAIN

  function buildLayer(spec: DroneSpec): Layer {
    const root = midiToFreq(spec.rootMidi)
    const tuning = spec.fifthTuning ?? 'just'

    const frequencies: number[] = [root]
    if (spec.octaveBelow === true) frequencies.push(root / 2)
    if (spec.withFifth !== false) {
      // 3:2 is the interval that stops beating; 2^(7/12) is the one a piano has.
      frequencies.push(tuning === 'just' ? root * 1.5 : root * Math.pow(2, 7 / 12))
    }

    const gain = context.createGain()
    gain.gain.value = 0

    // Gentle low pass: a raw sawtooth drone is fatiguing to practise against.
    const filter = context.createBiquadFilter()
    filter.type = 'lowpass'
    filter.frequency.value = Math.min(root * 8, 4000)
    filter.Q.value = 0.4
    gain.connect(filter)
    filter.connect(destination)

    const osc: OscillatorNode[] = []
    for (const frequency of frequencies) {
      // Two slightly detuned oscillators per pitch, so the drone breathes a
      // little instead of sounding like a test tone.
      for (const cents of [-4, 4]) {
        const o = context.createOscillator()
        o.type = 'sawtooth'
        o.frequency.value = frequency
        o.detune.value = cents
        const trim = context.createGain()
        trim.gain.value = 0.5 / frequencies.length
        o.connect(trim)
        trim.connect(gain)
        o.start()
        osc.push(o)
      }
    }

    return { osc, gain }
  }

  function fadeOut(target: Layer, fadeSec: number): void {
    const now = context.currentTime
    target.gain.gain.cancelScheduledValues(now)
    target.gain.gain.setValueAtTime(Math.max(target.gain.gain.value, 0.0001), now)
    target.gain.gain.linearRampToValueAtTime(0, now + fadeSec)
    for (const o of target.osc) {
      try {
        o.stop(now + fadeSec + 0.05)
      } catch {
        // Already stopped.
      }
    }
  }

  return {
    get isPlaying() {
      return layer !== null
    },

    start(spec) {
      if (layer) fadeOut(layer, FADE_SEC)
      level = spec.gain ?? level
      const next = buildLayer(spec)
      const now = context.currentTime
      next.gain.gain.setValueAtTime(0, now)
      next.gain.gain.linearRampToValueAtTime(level, now + FADE_SEC)
      layer = next
    },

    /**
     * Crossfade to a new root without a click, because she will drag the root
     * selector while it is sounding.
     */
    update(spec) {
      this.start(spec)
    },

    stop(fadeSec = FADE_SEC) {
      if (!layer) return
      fadeOut(layer, fadeSec)
      layer = null
    },

    setGain(value) {
      level = Math.max(0, Math.min(1, value))
      if (!layer) return
      const now = context.currentTime
      layer.gain.gain.setValueAtTime(layer.gain.gain.value, now)
      layer.gain.gain.linearRampToValueAtTime(level, now + 0.05)
    },

    dispose() {
      this.stop(0.02)
    },
  }
}
