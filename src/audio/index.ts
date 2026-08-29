/**
 * The composition root.
 *
 * One AudioSystem per app, created lazily and held for the app's lifetime — not
 * per route, so decoded samples and the unlocked context survive navigation.
 */

import type { Score } from '@core/score'
import type { TempoMap } from '@core/tempo'
import { createAudioEngine, type AudioEngine } from './context'
import { createTicker } from './clock'
import { WebAudioClock } from './clock'
import { createTransport, type Transport } from './transport'
import { NULL_SINK, type EventSink } from './sink'
import { createWebAudioSink } from './webAudioSink'
import { createSynthInstrument } from './voices/synthVoice'
import { createClickInstrument } from './voices/clickVoice'
import type { Instrument } from './voices/voice'

export interface AudioSystem {
  readonly engine: AudioEngine
  readonly transport: Transport
  /** Unlock and prepare. Must be called from inside a user gesture. */
  ready(): Promise<void>
  play(score: Score, tempo: TempoMap): Promise<void>
  stop(): void
  setMasterGain(value: number): void
  dispose(): void
}

export function createAudioSystem(): AudioSystem {
  const engine = createAudioEngine()

  let sink: EventSink = NULL_SINK
  let instrument: Instrument | null = null

  // The transport is built before there is any audio, against a null sink, so
  // nothing has to wait for the context to exist. The real sink is swapped in
  // once the engine unlocks.
  const clockProxy = {
    get currentTime() {
      return engine.context?.currentTime ?? 0
    },
  }

  const transport = createTransport({
    clock: clockProxy,
    ticker: createTicker(),
    sink: {
      beginRun: () => sink.beginRun(),
      scheduleEvent: (event, at, duration) => sink.scheduleEvent(event, at, duration),
      allNotesOff: (at, fade) => sink.allNotesOff(at, fade),
    },
    visualLatencySec: () => outputLatencySec(engine),
  })

  async function ready(): Promise<void> {
    await engine.unlock()
    const context = engine.context
    const master = engine.master
    if (!context || !master) return

    if (!instrument) {
      instrument = createSynthInstrument(context)
      sink = createWebAudioSink({
        context,
        destination: master,
        instrument: () => instrument ?? createSynthInstrument(context),
        click: createClickInstrument(context),
      })
    }
  }

  return {
    engine,
    transport,
    ready,

    async play(score, tempo) {
      await ready()
      if (engine.context?.state !== 'running') return
      transport.stop(0.01)
      transport.load(score, tempo)
      transport.start()
    },

    stop() {
      transport.stop()
    },

    setMasterGain(value) {
      engine.setMasterGain(value)
    },

    dispose() {
      transport.dispose()
      engine.dispose()
    },
  }
}

/**
 * The best available estimate of how long sound takes to reach her ears.
 *
 * `outputLatency` is the real answer and shipped in iOS Safari 18.4.
 * `baseLatency` only covers the graph's internal buffering and badly
 * under-reports the speaker path, hence doubling it. The constant is a
 * conservative mobile default, and the calibration flow exists because none of
 * these are trustworthy enough on their own.
 */
export function outputLatencySec(engine: AudioEngine): number {
  const context = engine.context
  if (!context) return 0
  const withLatency = context as AudioContext & { outputLatency?: number }
  if (typeof withLatency.outputLatency === 'number' && withLatency.outputLatency > 0) {
    return withLatency.outputLatency
  }
  if (typeof context.baseLatency === 'number' && context.baseLatency > 0) {
    return context.baseLatency * 2
  }
  return 0.06
}

export { WebAudioClock }
