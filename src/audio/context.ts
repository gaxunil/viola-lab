/**
 * The one place an AudioContext is created, unlocked, or resumed.
 *
 * No play path anywhere else touches the context; they all await `ready()`.
 * Centralising it is what makes the iOS gesture rule tractable — the context is
 * constructed INSIDE the unlocking gesture, because one created at module load
 * starts suspended on iOS and sometimes cannot be revived at all.
 *
 * The graph:
 *
 *   transport run bus ─┐
 *                      ├─ master ─ limiter ─ destination
 *   drone bus ─────────┘
 *
 * The drone hangs off its own bus deliberately: stopping the transport must not
 * silence the drone she is tuning against.
 */

import { LIMITER, MASTER_GAIN } from './constants'
import {
  type AudioSessionType,
  type SessionState,
  type SilentElementKeepAlive,
  applyPlaybackSession,
  createSilentKeepAlive,
  isIOS,
} from './session'

export interface AudioEngine {
  readonly state: SessionState
  readonly context: AudioContext | null
  /** Where the transport's per-run bus should connect. */
  readonly master: GainNode | null
  /** A sibling of the transport bus, so the drone survives a stop. */
  readonly droneBus: GainNode | null
  /**
   * True when we could not guarantee the ring/silent switch is bypassed, so the
   * UI should offer the sound check.
   */
  readonly silentSwitchRisk: boolean

  /** Must be called synchronously from inside a user gesture. */
  unlock(): Promise<void>
  ready(): Promise<void>
  setMasterGain(value: number): void
  /** For the sound-check level meter. Proves signal is being produced. */
  createAnalyser(): AnalyserNode | null
  setSessionType(type: AudioSessionType): boolean
  onStateChange(cb: (state: SessionState) => void): () => void
  dispose(): void
}

type ContextConstructor = new () => AudioContext

function resolveContextConstructor(): ContextConstructor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as {
    AudioContext?: ContextConstructor
    webkitAudioContext?: ContextConstructor
  }
  return w.AudioContext ?? w.webkitAudioContext ?? null
}

export function createAudioEngine(): AudioEngine {
  let context: AudioContext | null = null
  let master: GainNode | null = null
  let droneBus: GainNode | null = null
  let state: SessionState = 'locked'
  let sessionApplied = false
  let keepAlive: SilentElementKeepAlive | null = null
  let readyPromise: Promise<void> | null = null

  const listeners = new Set<(s: SessionState) => void>()

  function setState(next: SessionState): void {
    if (state === next) return
    state = next
    for (const listener of listeners) listener(next)
  }

  function buildGraph(ctx: AudioContext): void {
    master = ctx.createGain()
    master.gain.value = MASTER_GAIN

    droneBus = ctx.createGain()
    droneBus.gain.value = 1

    const limiter = ctx.createDynamicsCompressor()
    limiter.threshold.value = LIMITER.threshold
    limiter.knee.value = LIMITER.knee
    limiter.ratio.value = LIMITER.ratio
    limiter.attack.value = LIMITER.attack
    limiter.release.value = LIMITER.release

    master.connect(limiter)
    droneBus.connect(master)
    limiter.connect(ctx.destination)
  }

  /**
   * Push one sample of silence through the graph.
   *
   * iOS otherwise swallows the first note of the first playback, because the
   * audio pipeline has not actually started until something has been rendered.
   */
  function primePipeline(ctx: AudioContext): void {
    const buffer = ctx.createBuffer(1, 1, ctx.sampleRate)
    const source = ctx.createBufferSource()
    source.buffer = buffer
    source.connect(ctx.destination)
    source.start(0)
  }

  function watchInterruptions(ctx: AudioContext): void {
    ctx.addEventListener('statechange', () => {
      // WebKit exposes a non-standard 'interrupted' state for a phone call,
      // Siri, or the screen locking.
      const raw = ctx.state as string
      if (raw === 'running') setState('ready')
      else if (raw === 'interrupted' || raw === 'suspended') setState('interrupted')
      else if (raw === 'closed') setState('failed')
    })
  }

  async function doUnlock(): Promise<void> {
    if (state === 'ready' && context?.state === 'running') return

    const Ctor = resolveContextConstructor()
    if (!Ctor) {
      setState('failed')
      return
    }

    setState('unlocking')

    // Declare the page a media player before the context exists, so the very
    // first sound is already on a non-mixing session.
    sessionApplied = applyPlaybackSession('playback')

    if (isIOS() && !sessionApplied) {
      keepAlive ??= createSilentKeepAlive()
      keepAlive.start()
    }

    if (!context) {
      context = new Ctor()
      buildGraph(context)
      watchInterruptions(context)
    }

    try {
      await context.resume()
    } catch {
      // iOS can reject; the state check below is the real verdict.
    }

    // Never assume resume() worked — check.
    if (context.state === 'running') {
      primePipeline(context)
      setState('ready')
    } else {
      setState('locked')
    }
  }

  return {
    get state() {
      return state
    },
    get context() {
      return context
    },
    get master() {
      return master
    },
    get droneBus() {
      return droneBus
    },
    get silentSwitchRisk() {
      return isIOS() && !sessionApplied
    },

    unlock() {
      readyPromise = doUnlock()
      return readyPromise
    },

    ready() {
      return readyPromise ?? doUnlock()
    },

    setMasterGain(value) {
      if (!master || !context) return
      const now = context.currentTime
      master.gain.setValueAtTime(master.gain.value, now)
      master.gain.linearRampToValueAtTime(Math.max(0, value), now + 0.02)
    },

    createAnalyser() {
      if (!context || !master) return null
      const analyser = context.createAnalyser()
      analyser.fftSize = 1024
      master.connect(analyser)
      return analyser
    },

    setSessionType(type) {
      sessionApplied = applyPlaybackSession(type)
      if (type === 'playback' && sessionApplied) keepAlive?.stop()
      return sessionApplied
    },

    onStateChange(cb) {
      listeners.add(cb)
      return () => listeners.delete(cb)
    },

    dispose() {
      keepAlive?.stop()
      keepAlive = null
      listeners.clear()
      void context?.close()
      context = null
      master = null
      droneBus = null
      setState('locked')
    },
  }
}
