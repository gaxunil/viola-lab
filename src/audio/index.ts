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
import { createDrone, type Drone } from './drone'
import { fetchManifest, loadSamples, type LoadProgress } from './loader'
import { createSamplerInstrument, modeFor, type SamplerMode } from './sampler'
import type { Instrument } from './voices/voice'

export interface AudioSystem {
  readonly engine: AudioEngine
  readonly transport: Transport
  /**
   * Null until the engine has been unlocked. Lives on its own bus, so stopping
   * the transport never silences it.
   */
  readonly drone: Drone | null
  /** Start or retune the drone, unlocking audio first if need be. */
  setDrone(spec: Parameters<Drone['start']>[0] | null): Promise<void>
  /** 'synth' until the samples land, then 'partial' or 'sampled'. */
  readonly instrumentMode: SamplerMode
  onInstrumentChange(cb: (mode: SamplerMode) => void): () => void
  onSampleProgress(cb: (progress: LoadProgress) => void): () => void
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
  let drone: Drone | null = null
  let mode: SamplerMode = 'synth'
  let sampleLoadStarted = false

  const modeListeners = new Set<(mode: SamplerMode) => void>()
  const progressListeners = new Set<(progress: LoadProgress) => void>()

  function setMode(next: SamplerMode): void {
    if (mode === next) return
    mode = next
    for (const listener of modeListeners) listener(next)
  }

  /**
   * Swap the synth for the real viola once the samples arrive.
   *
   * Never rejects. A school network that will not give us a megabyte of audio
   * leaves the app perfectly usable on the synth voice, which is why the synth
   * is a real fallback rather than a token one.
   */
  async function loadViola(context: AudioContext): Promise<void> {
    if (sampleLoadStarted) return
    sampleLoadStarted = true

    const baseUrl = '/samples/viola-v1'
    const synth = createSynthInstrument(context)

    try {
      const manifest = await fetchManifest(baseUrl)
      const onProgress = (progress: LoadProgress) => {
        for (const listener of progressListeners) listener(progress)
      }

      const { core, rest } = await loadSamples(manifest, { baseUrl, context, onProgress })

      const install = (buffers: ReadonlyMap<number, AudioBuffer>) => {
        if (buffers.size === 0) return
        instrument = createSamplerInstrument({ context, manifest, buffers, fallback: synth })
        setMode(modeFor(manifest, buffers.size))
      }

      install(core.buffers)
      // The remaining notes arrive behind the open strings; installing again
      // widens the range without interrupting anything already sounding.
      void rest.then((all) => install(all.buffers)).catch(() => undefined)
    } catch {
      setMode('synth')
    }
  }

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

    if (!drone && engine.droneBus) {
      drone = createDrone(context, engine.droneBus)
    }

    if (!instrument) {
      instrument = createSynthInstrument(context)
      // Kick off the sample load; playback works on the synth until it lands.
      void loadViola(context)
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

    get drone() {
      return drone
    },

    get instrumentMode() {
      return mode
    },

    onInstrumentChange(cb) {
      modeListeners.add(cb)
      return () => modeListeners.delete(cb)
    },

    onSampleProgress(cb) {
      progressListeners.add(cb)
      return () => progressListeners.delete(cb)
    },

    async setDrone(spec) {
      await ready()
      if (!drone) return
      if (spec === null) drone.stop()
      else drone.start(spec)
    },

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
      modeListeners.clear()
      progressListeners.clear()
      drone?.dispose()
      drone = null
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
