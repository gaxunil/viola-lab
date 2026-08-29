/**
 * The two seams that make the scheduler testable.
 *
 * `AudioClock` is one property and `Ticker` is two methods. Between them they
 * isolate every timing decision — lookahead windowing, drift, catch-up after a
 * stall, loop wrap, tempo changes — into a plain object with no Web Audio in it
 * at all. A test supplies a fake clock it advances by hand, and assertions about
 * event times become exact rather than approximate, because there is no real
 * jitter to tolerate.
 *
 * Note what is deliberately NOT here: an interface mirroring the Web Audio node
 * graph. Mocking forty members of `AudioContext` would be writing a second,
 * worse implementation of Web Audio and then testing against our beliefs about
 * it rather than its behaviour. Those parts are covered by rendering real audio
 * offline instead.
 */

export interface AudioClock {
  readonly currentTime: number
}

export interface Ticker {
  start(callback: () => void): void
  stop(): void
  readonly intervalMs: number
}

export class WebAudioClock implements AudioClock {
  readonly #context: BaseAudioContext

  constructor(context: BaseAudioContext) {
    this.#context = context
  }

  get currentTime(): number {
    return this.#context.currentTime
  }
}

/** How often the scheduler wakes to look ahead. */
export const DEFAULT_TICK_MS = 25

/** How far ahead of the clock events are scheduled. */
export const DEFAULT_LOOKAHEAD_SEC = 0.1

/**
 * A ticker backed by a worker.
 *
 * Browsers clamp `setInterval` in a backgrounded tab to roughly once a second,
 * which would stall the scheduler mid-lookahead and drop most of a bar. A worker
 * timer is not throttled, so the metronome keeps its footing while she switches
 * apps to look at her music.
 */
export function createWorkerTicker(intervalMs: number = DEFAULT_TICK_MS): Ticker {
  const source = `
    let id = null;
    self.onmessage = (e) => {
      if (e.data.command === 'start') {
        if (id !== null) clearInterval(id);
        id = setInterval(() => self.postMessage('tick'), e.data.intervalMs);
      } else if (e.data.command === 'stop') {
        if (id !== null) clearInterval(id);
        id = null;
      }
    };
  `

  let worker: Worker | null = null
  let url: string | null = null

  return {
    intervalMs,
    start(callback) {
      if (worker) return
      url = URL.createObjectURL(new Blob([source], { type: 'application/javascript' }))
      worker = new Worker(url)
      worker.onmessage = () => callback()
      worker.postMessage({ command: 'start', intervalMs })
    },
    stop() {
      if (worker) {
        worker.postMessage({ command: 'stop' })
        worker.terminate()
        worker = null
      }
      if (url) {
        URL.revokeObjectURL(url)
        url = null
      }
    },
  }
}

/** Fallback for environments where a blob worker is blocked by a strict CSP. */
export function createIntervalTicker(intervalMs: number = DEFAULT_TICK_MS): Ticker {
  let handle: ReturnType<typeof setInterval> | null = null

  return {
    intervalMs,
    start(callback) {
      if (handle !== null) return
      handle = setInterval(callback, intervalMs)
    },
    stop() {
      if (handle !== null) {
        clearInterval(handle)
        handle = null
      }
    },
  }
}

/** A worker ticker where one is available, otherwise a plain interval. */
export function createTicker(intervalMs: number = DEFAULT_TICK_MS): Ticker {
  try {
    if (typeof Worker !== 'undefined' && typeof URL.createObjectURL === 'function') {
      return createWorkerTicker(intervalMs)
    }
  } catch {
    // Fall through — a blocked blob URL is not worth failing over.
  }
  return createIntervalTicker(intervalMs)
}
