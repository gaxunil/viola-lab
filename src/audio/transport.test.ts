import { describe, expect, it } from 'vitest'
import { PPQ } from '@core/ticks'
import { meter } from '@core/rhythm/meter'
import { dur } from '@core/rhythm/duration'
import { note } from '@core/rhythm/bar'
import { constantTempo, tempoFromBeat } from '@core/tempo'
import { compileMetronome } from '@core/compile/metronome'
import { compileRhythm } from '@core/compile/rhythm'
import { createTransport } from './transport'
import { FakeClock, ManualTicker, RecordingSink } from './testing/fakes'

function harness(o: { lookaheadSec?: number; visualLatencySec?: number } = {}) {
  const clock = new FakeClock()
  const ticker = new ManualTicker(25)
  const sink = new RecordingSink()
  const transport = createTransport({
    clock,
    ticker,
    sink,
    lookaheadSec: o.lookaheadSec ?? 0.1,
    scheduleAheadSec: 0,
    ...(o.visualLatencySec === undefined
      ? {}
      : { visualLatencySec: () => o.visualLatencySec ?? 0 }),
  })
  return { clock, ticker, sink, transport }
}

describe('the lookahead window', () => {
  it('schedules ahead of the clock but not beyond the horizon', () => {
    const { clock, ticker, sink, transport } = harness({ lookaheadSec: 0.1 })
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 4 }), constantTempo(60))
    transport.start()

    // At 60bpm a quarter is one second, so only the downbeat is within 100ms.
    expect(sink.scheduled).toHaveLength(1)

    ticker.run(clock, 1.0)
    // One second in, everything up to about 1.1s has been scheduled.
    expect(sink.times.every((t) => t <= 1.1 + 1e-9)).toBe(true)
    expect(sink.scheduled.length).toBeGreaterThanOrEqual(2)
  })

  it('never schedules the same event twice', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 4 }), constantTempo(120))
    transport.start()
    ticker.run(clock, 10)

    expect(new Set(sink.ids).size).toBe(sink.ids.length)
  })

  it('schedules in strictly increasing time order', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(12, 8), bars: 2 }), constantTempo(120))
    transport.start()
    ticker.run(clock, 8)

    for (let i = 1; i < sink.times.length; i++) {
      expect(sink.times[i]!).toBeGreaterThan(sink.times[i - 1]!)
    }
  })

  it('opens a fresh run bus when playback starts', () => {
    const { sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 1 }), constantTempo(120))
    transport.start()
    expect(sink.runs).toBe(1)
  })
})

describe('timing is exact', () => {
  it('puts sixteen quarter notes exactly half a second apart at 120bpm', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 4 }), constantTempo(120))
    transport.start()
    ticker.run(clock, 9)

    expect(sink.scheduled).toHaveLength(16)
    sink.times.forEach((t, n) => {
      expect(t).toBeCloseTo(n * 0.5, 9)
    })
  })

  it('does not accumulate error over a long run', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 60 }), constantTempo(120))
    transport.start()
    ticker.run(clock, 121)

    expect(sink.scheduled).toHaveLength(240)
    // The last click of a two-minute run is still exactly where it should be.
    expect(sink.times[239]).toBeCloseTo(239 * 0.5, 9)
  })

  it('places a 12/8 bar as four dotted-quarter beats', () => {
    const m = meter(12, 8)
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: m, bars: 1 }), tempoFromBeat(90, m.beatUnit))
    transport.start()
    ticker.run(clock, 4)

    expect(sink.scheduled).toHaveLength(4)
    const beat = 60 / 90
    sink.times.forEach((t, n) => expect(t).toBeCloseTo(n * beat, 9))

    const accents = sink.scheduled.map((s) =>
      s.event.payload.type === 'click' ? s.event.payload.accent : null,
    )
    expect(accents).toEqual(['strong', 'weak', 'medium', 'weak'])
  })
})

describe('stopping', () => {
  it('cancels every event still in the future', () => {
    const { clock, ticker, sink, transport } = harness()
    const score = compileMetronome({ meter: meter(4, 4), bars: 8 })
    transport.load(score, constantTempo(120))
    transport.start()

    ticker.run(clock, 1.5)
    const scheduledBefore = sink.scheduled.length
    transport.stop()

    expect(sink.stops).toHaveLength(1)
    expect(transport.state).toBe('stopped')

    // Keep the timer going: nothing more may be scheduled.
    ticker.run(clock, 5)
    expect(sink.scheduled).toHaveLength(scheduledBefore)
    expect(scheduledBefore).toBeLessThan(score.events.length)
  })

  it('is idempotent, because Escape and a button click can land together', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 4 }), constantTempo(120))
    transport.start()
    ticker.run(clock, 1)

    transport.stop()
    transport.stop()
    transport.stop()

    expect(sink.stops).toHaveLength(1)
  })

  it('fades rather than cutting, so stopping does not click', () => {
    const { transport, sink, clock, ticker } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 4 }), constantTempo(120))
    transport.start()
    ticker.run(clock, 0.5)
    transport.stop()

    expect(sink.stops[0]?.fadeSec).toBeGreaterThan(0)
  })
})

describe('recovering from a stalled timer', () => {
  // A backgrounded tab or a suspended context stops the timer. A naive
  // scheduler then discovers the whole missed window and fires it as a burst.
  it('drops past-due events instead of machine-gunning them', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 20 }), constantTempo(120))
    transport.start()

    ticker.fire()
    const before = sink.scheduled.length

    // Five seconds pass with no ticks at all, then one tick.
    clock.advance(5)
    ticker.fire()

    const added = sink.scheduled.length - before
    expect(added).toBeLessThanOrEqual(2)
    expect(transport.droppedCount).toBeGreaterThan(0)
  })

  it('never schedules anything in the past', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 20 }), constantTempo(120))
    transport.start()

    ticker.fire()
    clock.advance(3)
    ticker.fire()
    clock.advance(0.2)
    ticker.run(clock, 2)

    for (const call of sink.scheduled) {
      expect(call.atTime).toBeGreaterThanOrEqual(0)
    }
    // Every scheduled time was in the future at the moment it was scheduled,
    // which the transport enforces; the clock only ever moved forward.
    expect(sink.times).toEqual([...sink.times].sort((a, b) => a - b))
  })
})

describe('looping', () => {
  it('wraps without a gap or a doubled onset', () => {
    const m = meter(4, 4)
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: m, bars: 1, loop: true }), constantTempo(120))
    transport.start()
    ticker.run(clock, 10)

    expect(sink.scheduled.length).toBeGreaterThan(16)
    for (let i = 1; i < sink.times.length; i++) {
      expect(sink.times[i]! - sink.times[i - 1]!).toBeCloseTo(0.5, 9)
    }
  })

  it('keeps a long loop sample-exact', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 1, loop: true }), constantTempo(120))
    transport.start()
    ticker.run(clock, 60)

    const last = sink.times[sink.times.length - 1]!
    const n = sink.times.length - 1
    expect(last).toBeCloseTo(n * 0.5, 9)
  })

  it('hears a count-in once and then loops only the body', () => {
    const m = meter(4, 4)
    const { clock, ticker, sink, transport } = harness()
    transport.load(
      compileMetronome({ meter: m, bars: 1, countInBars: 1, loop: true }),
      constantTempo(120),
    )
    transport.start()
    ticker.run(clock, 10)

    const countInCalls = sink.scheduled.filter((s) => s.event.countIn === true)
    expect(countInCalls).toHaveLength(4)
  })
})

describe('changing tempo while running', () => {
  it('does not make time jump backwards', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 20 }), constantTempo(60))
    transport.start()
    ticker.run(clock, 1.5)

    const lastBefore = sink.times[sink.times.length - 1]!
    transport.setTempo(120)
    ticker.run(clock, 2)

    const after = sink.times.slice(sink.times.indexOf(lastBefore) + 1)
    for (const t of after) expect(t).toBeGreaterThan(lastBefore)
  })

  it('runs at the new tempo afterwards', () => {
    const { clock, ticker, sink, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 40 }), constantTempo(60))
    transport.start()
    ticker.run(clock, 2)
    transport.setTempo(120)
    ticker.run(clock, 4)

    const tail = sink.times.slice(-4)
    for (let i = 1; i < tail.length; i++) {
      expect(tail[i]! - tail[i - 1]!).toBeCloseTo(0.5, 6)
    }
  })
})

describe('position reporting', () => {
  it('reports nothing when not playing', () => {
    const { transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 2 }), constantTempo(120))
    expect(transport.positionNow()).toBeNull()
  })

  it('advances monotonically and cycles the beat', () => {
    const { clock, ticker, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 8 }), constantTempo(120))
    transport.start()

    let previousTick = -1
    const beats: number[] = []
    for (let i = 0; i < 40; i++) {
      clock.advance(0.125)
      ticker.fire()
      const position = transport.positionNow()
      expect(position).not.toBeNull()
      expect(position!.tick).toBeGreaterThanOrEqual(previousTick)
      previousTick = position!.tick
      beats.push(position!.beatInBar)
    }
    expect(new Set(beats)).toEqual(new Set([0, 1, 2, 3]))
  })

  it('reports the felt beat in 12/8, not the pulse', () => {
    const m = meter(12, 8)
    const { clock, ticker, transport } = harness()
    transport.load(compileMetronome({ meter: m, bars: 4 }), tempoFromBeat(90, m.beatUnit))
    transport.start()

    clock.advance(60 / 90 + 0.01) // just past beat 2
    ticker.fire()
    const position = transport.positionNow()
    expect(position?.beatInBar).toBe(1)
    expect(position?.accent).toBe('weak')

    clock.advance(2 * (60 / 90)) // beat 4
    ticker.fire()
    expect(transport.positionNow()?.beatInBar).toBe(3)
  })

  // The scheduler runs ahead of the sound, so position must come from the clock
  // and be pulled back by the output latency, or the flash leads the click.
  it('compensates for output latency so visuals match what is heard', () => {
    const withLatency = harness({ visualLatencySec: 0.05 })
    withLatency.transport.load(
      compileMetronome({ meter: meter(4, 4), bars: 8 }),
      constantTempo(120),
    )
    withLatency.transport.start()

    withLatency.clock.advance(0.55)
    withLatency.ticker.fire()

    // 0.55s in, minus 50ms of latency, is 0.5s heard — beat 1, not beat 2.
    expect(withLatency.transport.positionNow()?.beatInBar).toBe(1)
  })

  it('marks the count-in as such', () => {
    const { clock, ticker, transport } = harness()
    transport.load(
      compileMetronome({ meter: meter(4, 4), bars: 2, countInBars: 1 }),
      constantTempo(120),
    )
    transport.start()

    clock.advance(1)
    ticker.fire()
    expect(transport.positionNow()?.isCountIn).toBe(true)
    expect(transport.state).toBe('countIn')

    clock.advance(1.5)
    ticker.fire()
    expect(transport.positionNow()?.isCountIn).toBe(false)
    expect(transport.state).toBe('running')
  })

  it('names the event currently sounding, for highlighting', () => {
    const { clock, ticker, transport } = harness()
    const score = compileRhythm({
      meter: meter(4, 4),
      events: Array.from({ length: 4 }, () => note(dur('quarter'))),
      withClick: false,
    })
    transport.load(score, constantTempo(120))
    transport.start()

    clock.advance(0.1)
    ticker.fire()
    const first = transport.positionNow()?.eventIndex
    expect(first).not.toBeNull()

    clock.advance(0.5)
    ticker.fire()
    expect(transport.positionNow()?.eventIndex).not.toBe(first)
  })
})

describe('lifecycle', () => {
  it('announces state changes', () => {
    const { clock, ticker, transport } = harness()
    const seen: string[] = []
    transport.onStateChange((s) => seen.push(s))
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 1 }), constantTempo(240))
    transport.start()
    ticker.run(clock, 2)

    expect(seen).toContain('running')
    expect(seen).toContain('finished')
  })

  it('fires completion once at the end', () => {
    const { clock, ticker, transport } = harness()
    let completions = 0
    transport.onComplete(() => (completions += 1))
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 1 }), constantTempo(240))
    transport.start()
    ticker.run(clock, 3)

    expect(completions).toBe(1)
    expect(transport.state).toBe('finished')
  })

  it('stops the timer when disposed', () => {
    const { ticker, transport } = harness()
    transport.load(compileMetronome({ meter: meter(4, 4), bars: 4 }), constantTempo(120))
    transport.start()
    expect(ticker.isRunning).toBe(true)

    transport.dispose()
    expect(ticker.isRunning).toBe(false)
  })
})
