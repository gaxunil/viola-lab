import { createComputed, createRoot } from 'solid-js'
import { describe, expect, it } from 'vitest'
import { createTransport } from '@audio/transport'
import { FakeClock, ManualTicker, RecordingSink } from '@audio/testing/fakes'
import { compileMetronome } from '@core/compile/metronome'
import { type Meter, meter } from '@core/rhythm/meter'
import { constantTempo } from '@core/tempo'
import { createManualFrameScheduler } from './frameScheduler'
import { createTransportState } from './useTransport'

interface HarnessOptions {
  readonly meter?: Meter
  readonly bars?: number
  readonly countInBars?: number
  readonly quarterBpm?: number
}

/**
 * A real transport on fake seams, plus a frame scheduler the test drives itself.
 *
 * Nothing here is mocked: the transport is the shipping one, and the only thing
 * standing in for the browser is a clock, a timer and a rAF loop, which is what
 * lets the whole suite run in a node environment with no jsdom.
 */
function harness(o: HarnessOptions = {}) {
  const clock = new FakeClock()
  const ticker = new ManualTicker(25)
  const sink = new RecordingSink()
  const frames = createManualFrameScheduler()

  const transport = createTransport({ clock, ticker, sink, scheduleAheadSec: 0 })

  transport.load(
    compileMetronome({
      meter: o.meter ?? meter(4, 4),
      bars: o.bars ?? 4,
      ...(o.countInBars === undefined ? {} : { countInBars: o.countInBars }),
    }),
    // A quarter note per second, so every time in these tests reads as seconds.
    constantTempo(o.quarterBpm ?? 60),
  )

  /** Advance the clock in ticker-sized steps, painting a frame at each one. */
  const run = (seconds: number): void => {
    const steps = Math.round((seconds * 1000) / ticker.intervalMs)
    for (let i = 0; i < steps; i++) {
      clock.advance(ticker.intervalMs / 1000)
      ticker.fire()
      frames.frame()
    }
  }

  return { clock, ticker, sink, frames, transport, run }
}

/** Nudge off the beat boundary, so no assertion rests on float luck. */
const SETTLE_SEC = 0.05

describe('before playback starts', () => {
  it('reports no beat and is not playing', () => {
    const { transport, frames } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })

      expect(signals.state()).toBe('idle')
      expect(signals.isPlaying()).toBe(false)
      expect(signals.beat()).toBe(-1)
      expect(signals.bar()).toBe(-1)
      dispose()
    })
  })

  it('leaves the frame loop stopped', () => {
    const { transport, frames } = harness()
    createRoot((dispose) => {
      createTransportState(transport, { frames })

      expect(frames.isRunning).toBe(false)
      dispose()
    })
  })

  it('has no position sample and nothing to highlight', () => {
    const { transport, frames } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })

      expect(signals.position()).toBeNull()
      expect(signals.noteIndex()).toBeNull()
      expect(signals.isCountIn()).toBe(false)
      dispose()
    })
  })
})

describe('the felt beat', () => {
  it('advances 0, 1, 2, 3 through a bar of 4/4', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()

      const seen: number[] = []
      run(SETTLE_SEC)
      seen.push(signals.beat())
      for (let i = 0; i < 3; i++) {
        run(1)
        seen.push(signals.beat())
      }

      expect(seen).toEqual([0, 1, 2, 3])
      dispose()
    })
  })

  it('returns to beat 0 at the start of the next bar', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()

      run(SETTLE_SEC)
      expect(signals.beat()).toBe(0)
      run(4)
      expect(signals.beat()).toBe(0)
      dispose()
    })
  })

  it('counts bars as playback moves through the score', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()

      const seen: number[] = []
      run(SETTLE_SEC)
      seen.push(signals.bar())
      run(4)
      seen.push(signals.bar())
      run(4)
      seen.push(signals.bar())

      expect(seen).toEqual([0, 1, 2])
      dispose()
    })
  })

  it('reports the four felt beats of 12/8, not its twelve pulses', () => {
    const { transport, frames, run } = harness({ meter: meter(12, 8), bars: 2 })
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()

      // A dotted-quarter beat is 1.5s here, so twelve half-second samples walk
      // the whole bar three pulses at a time.
      const seen: number[] = []
      run(SETTLE_SEC)
      seen.push(signals.beat())
      for (let i = 0; i < 11; i++) {
        run(0.5)
        seen.push(signals.beat())
      }

      expect(seen).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3])
      dispose()
    })
  })

  it('still exposes the pulse on the raw position while the felt beat holds', () => {
    const { transport, frames, run } = harness({ meter: meter(12, 8), bars: 2 })
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()

      const pulses: number[] = []
      const beats: number[] = []
      run(SETTLE_SEC)
      for (let i = 0; i < 3; i++) {
        pulses.push(signals.position()?.pulseInBar ?? -1)
        beats.push(signals.beat())
        run(0.5)
      }

      expect(pulses).toEqual([0, 1, 2])
      expect(beats).toEqual([0, 0, 0])
      dispose()
    })
  })
})

describe('accents', () => {
  it('marks the downbeat strong', () => {
    const { transport, frames, run } = harness({ meter: meter(12, 8), bars: 2 })
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(SETTLE_SEC)

      expect(signals.accent()).toBe('strong')
      dispose()
    })
  })

  it('marks the third felt beat of 12/8 medium', () => {
    const { transport, frames, run } = harness({ meter: meter(12, 8), bars: 2 })
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()

      // Beat three of a dotted-quarter count lands three seconds in.
      run(3 + SETTLE_SEC)

      expect(signals.beat()).toBe(2)
      expect(signals.accent()).toBe('medium')
      dispose()
    })
  })

  it('marks the second beat of 4/4 weak', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(1 + SETTLE_SEC)

      expect(signals.beat()).toBe(1)
      expect(signals.accent()).toBe('weak')
      dispose()
    })
  })
})

describe('collapsing sixty frames a second into integers', () => {
  it('does not re-notify the beat while the position moves within one beat', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })

      // createComputed rather than createEffect: user effects are queued to the
      // end of the enclosing root, which would flush after these assertions had
      // already run. A pure computation observes the memo eagerly, so the count
      // is exact at the moment it is read.
      let beatNotifications = 0
      let positionNotifications = 0
      createComputed(() => {
        signals.beat()
        beatNotifications += 1
      })
      createComputed(() => {
        signals.position()
        positionNotifications += 1
      })

      transport.start()
      run(SETTLE_SEC)
      const beatBaseline = beatNotifications
      const positionBaseline = positionNotifications

      // Twenty frames, all of them inside beat 0, which is a whole second long.
      run(0.5)

      expect(signals.beat()).toBe(0)
      expect(beatNotifications - beatBaseline).toBe(0)
      expect(positionNotifications - positionBaseline).toBe(20)
      dispose()
    })
  })

  it('notifies the beat exactly once at each beat boundary', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })

      let beatNotifications = 0
      createComputed(() => {
        signals.beat()
        beatNotifications += 1
      })

      transport.start()
      run(SETTLE_SEC)
      const baseline = beatNotifications

      // One hundred and sixty frames spanning four beat boundaries.
      run(4)

      expect(beatNotifications - baseline).toBe(4)
      dispose()
    })
  })

  it('updates the raw position on every single frame', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()

      const times: number[] = []
      for (let i = 0; i < 5; i++) {
        run(0.025)
        times.push(signals.position()?.contextTime ?? -1)
      }

      expect(times).toEqual([0.025, 0.05, 0.075, 0.1, 0.125])
      dispose()
    })
  })

  it('does not re-notify the accent while the accent is unchanged', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })

      let accentNotifications = 0
      createComputed(() => {
        signals.accent()
        accentNotifications += 1
      })

      transport.start()
      run(SETTLE_SEC)
      const baseline = accentNotifications
      run(0.5)

      expect(signals.accent()).toBe('strong')
      expect(accentNotifications - baseline).toBe(0)
      dispose()
    })
  })
})

describe('highlighting', () => {
  it('reports the sounding event index, and null in the gaps between clicks', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()

      const seen: Array<number | null> = []
      run(SETTLE_SEC)
      seen.push(signals.noteIndex())
      // A click is a quarter of a beat long, so mid-beat nothing is sounding.
      run(0.5)
      seen.push(signals.noteIndex())
      run(0.5)
      seen.push(signals.noteIndex())

      expect(seen).toEqual([0, null, 1])
      dispose()
    })
  })
})

describe('the frame loop', () => {
  it('runs while the transport is playing', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      createTransportState(transport, { frames })
      transport.start()
      run(SETTLE_SEC)

      expect(frames.isRunning).toBe(true)
      dispose()
    })
  })

  it('stops when the transport is stopped', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(1)
      transport.stop()

      expect(frames.isRunning).toBe(false)
      expect(signals.isPlaying()).toBe(false)
      expect(signals.beat()).toBe(-1)
      dispose()
    })
  })

  it('stops when the score finishes', () => {
    const { transport, frames, run } = harness({ bars: 1 })
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(4.5)

      expect(signals.state()).toBe('finished')
      expect(frames.isRunning).toBe(false)
      expect(signals.beat()).toBe(-1)
      dispose()
    })
  })

  it('starts again when playback is restarted', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(1)
      transport.stop()
      expect(frames.isRunning).toBe(false)

      transport.start()
      run(SETTLE_SEC)

      expect(frames.isRunning).toBe(true)
      expect(signals.isPlaying()).toBe(true)
      expect(signals.beat()).toBe(0)
      dispose()
    })
  })
})

describe('the count-in', () => {
  it('is flagged while the count-in bar is sounding', () => {
    const { transport, frames, run } = harness({ bars: 2, countInBars: 1 })
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(SETTLE_SEC)

      expect(signals.state()).toBe('countIn')
      expect(signals.isPlaying()).toBe(true)
      expect(signals.isCountIn()).toBe(true)
      dispose()
    })
  })

  it('clears once the body of the score begins', () => {
    const { transport, frames, run } = harness({ bars: 2, countInBars: 1 })
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(SETTLE_SEC)
      expect(signals.isCountIn()).toBe(true)

      run(4)

      expect(signals.isCountIn()).toBe(false)
      expect(signals.state()).toBe('running')
      expect(signals.bar()).toBe(0)
      dispose()
    })
  })

  it('numbers count-in bars before the first bar of the music', () => {
    const { transport, frames, run } = harness({ bars: 2, countInBars: 1 })
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(SETTLE_SEC)

      expect(signals.bar()).toBe(-1)
      expect(signals.beat()).toBe(0)
      dispose()
    })
  })
})

describe('disposal', () => {
  it('stops the frame loop', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(1)
      expect(frames.isRunning).toBe(true)

      signals.dispose()

      expect(frames.isRunning).toBe(false)
      expect(signals.beat()).toBe(-1)
      dispose()
    })
  })

  it('stops listening to the transport', () => {
    const { transport, frames, run } = harness()
    createRoot((dispose) => {
      const signals = createTransportState(transport, { frames })
      transport.start()
      run(1)
      signals.dispose()

      transport.stop()

      // Still reporting the last state it saw, which is the proof that the
      // subscription is gone rather than merely quiet.
      expect(signals.state()).toBe('running')
      expect(transport.state).toBe('stopped')
      dispose()
    })
  })

  it('runs from onCleanup when the enclosing root is disposed', () => {
    const { transport, frames } = harness()
    transport.start()

    createRoot((dispose) => {
      createTransportState(transport, { frames })
      // A transport that was already playing gets its loop started on creation.
      expect(frames.isRunning).toBe(true)

      dispose()

      expect(frames.isRunning).toBe(false)
    })
  })
})
