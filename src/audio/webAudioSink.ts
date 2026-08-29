/**
 * Turning scheduled events into sound.
 *
 * The cancellable per-run bus is carried over from the slide deck, where it was
 * the fix for a real bug: stopping playback has to silence notes that were
 * SCHEDULED but have not started yet. Ramping a shared gain to zero is not
 * enough on its own, because a source that has not begun will happily start
 * afterwards — every node has to be stopped individually too.
 *
 * So a run gets its own bus, and stopping ramps that bus down, stops every node
 * created on it, and then DISCARDS the bus. The next run lazily opens a fresh
 * one, which means a stop can never leave a half-faded gain node in the path of
 * the next note.
 */

import type { MusicalEvent } from '@core/score'
import { STOP_FADE_SEC } from './constants'
import type { EventSink } from './sink'
import type { Instrument, Voice } from './voices/voice'
import type { ClickInstrument } from './voices/clickVoice'

export interface WebAudioSinkDeps {
  readonly context: AudioContext
  readonly destination: AudioNode
  readonly instrument: () => Instrument
  readonly click: ClickInstrument
}

export function createWebAudioSink(deps: WebAudioSinkDeps): EventSink {
  let bus: GainNode | null = null
  let voices: Voice[] = []

  function currentBus(): GainNode {
    if (!bus) {
      bus = deps.context.createGain()
      bus.gain.value = 1
      bus.connect(deps.destination)
    }
    return bus
  }

  return {
    beginRun() {
      // A previous run's bus is discarded rather than reused, so a fade that was
      // in progress cannot bleed into the new run.
      bus = null
      voices = []
    },

    scheduleEvent(event: MusicalEvent, atTime: number, durationSec: number) {
      const destination = currentBus()

      if (event.payload.type === 'click') {
        voices.push(
          deps.click.play({ accent: event.payload.accent, atTime, destination }),
        )
        return
      }

      if (event.payload.type === 'note') {
        const instrument = deps.instrument()
        if (event.payload.midi < instrument.lowMidi || event.payload.midi > instrument.highMidi) {
          return
        }
        voices.push(
          instrument.play({
            midi: event.payload.midi,
            atTime,
            durationSec,
            velocity: event.payload.velocity,
            destination,
          }),
        )
      }
      // A cue makes no sound; it is a marker for the UI.
    },

    allNotesOff(atTime: number, fadeSec: number = STOP_FADE_SEC) {
      if (!bus) return

      const fade = Math.max(0.01, fadeSec)
      bus.gain.cancelScheduledValues(atTime)
      bus.gain.setValueAtTime(Math.max(bus.gain.value, 0.0001), atTime)
      bus.gain.linearRampToValueAtTime(0, atTime + fade)

      // Ramping the bus is not enough on its own: a source scheduled to start
      // after the ramp finishes would still speak. Stop each one explicitly.
      for (const voice of voices) {
        voice.stop(atTime + fade + 0.02)
      }

      bus = null
      voices = []
    },
  }
}
