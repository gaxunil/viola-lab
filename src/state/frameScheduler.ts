/**
 * The seam between "once per animation frame" and the state layer.
 *
 * The transport already has its seams for audio time; this is the matching one
 * for display time. Without it, every test of the signal layer would need a DOM
 * to supply `requestAnimationFrame`, which would drag jsdom into a project whose
 * whole test story is that a node environment and a fake clock are enough.
 *
 * There is deliberately no rate limiting here. Deciding when to sample is the
 * scheduler's job; deciding what to do with a sample belongs upstairs.
 */

export interface FrameScheduler {
  /** Invoke `callback` once per frame until `stop`. Calling twice is a no-op. */
  start(callback: () => void): void
  stop(): void
  readonly isRunning: boolean
}

/** Roughly 60Hz, for the environments that have no rAF to defer to. */
const FALLBACK_INTERVAL_MS = 16

export function createAnimationFrameScheduler(): FrameScheduler {
  let running = false
  let frameHandle: number | null = null
  let intervalHandle: ReturnType<typeof setInterval> | null = null

  return {
    get isRunning() {
      return running
    },

    start(callback) {
      if (running) return
      running = true

      // A worker, a server render, or a node test has no rAF. Falling back to an
      // interval keeps the caller from having to care which one it is running in.
      if (typeof requestAnimationFrame !== 'function') {
        intervalHandle = setInterval(callback, FALLBACK_INTERVAL_MS)
        return
      }

      const step = (): void => {
        if (!running) return
        // Queue the next frame before running the callback, so a throw in the
        // callback costs one dropped frame rather than the whole loop.
        frameHandle = requestAnimationFrame(step)
        callback()
      }
      frameHandle = requestAnimationFrame(step)
    },

    stop() {
      running = false
      if (frameHandle !== null) {
        cancelAnimationFrame(frameHandle)
        frameHandle = null
      }
      if (intervalHandle !== null) {
        clearInterval(intervalHandle)
        intervalHandle = null
      }
    },
  }
}

/** A scheduler whose frames a test fires by hand. */
export function createManualFrameScheduler(): FrameScheduler & { frame(): void } {
  let callback: (() => void) | null = null

  return {
    get isRunning() {
      return callback !== null
    },

    start(next) {
      if (callback !== null) return
      callback = next
    },

    stop() {
      callback = null
    },

    frame() {
      callback?.()
    },
  }
}
