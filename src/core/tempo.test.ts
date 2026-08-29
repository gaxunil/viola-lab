import { describe, expect, it } from 'vitest'
import { PPQ } from './ticks'
import { dur } from './rhythm/duration'
import { bpmInBeat, clampBpm, constantTempo, rebaseTempo, tempoFromBeat } from './tempo'

describe('constantTempo', () => {
  it('makes a quarter note last half a second at 120', () => {
    const t = constantTempo(120)
    expect(t.secondsAtTick(PPQ)).toBeCloseTo(0.5, 9)
    expect(t.secondsAtTick(4 * PPQ)).toBeCloseTo(2, 9)
  })

  it('inverts exactly', () => {
    const t = constantTempo(96)
    for (const tick of [0, PPQ, 3 * PPQ, 7 * PPQ + 13]) {
      expect(t.tickAtSeconds(t.secondsAtTick(tick))).toBeCloseTo(tick, 6)
    }
  })

  it('refuses a nonsense tempo', () => {
    expect(() => constantTempo(0)).toThrow(RangeError)
    expect(() => constantTempo(-40)).toThrow(RangeError)
  })
})

describe('the beat unit matters', () => {
  // Getting this wrong runs a compound-meter metronome at two thirds speed.
  it('reads 90 bpm in 12/8 as ninety DOTTED quarters', () => {
    const t = tempoFromBeat(90, dur('quarter', 1))
    expect(t.quarterBpm).toBeCloseTo(135, 9)

    // One dotted quarter is one beat, so a bar of 12/8 is four of them.
    const barSeconds = t.secondsAtTick(6 * PPQ)
    expect(barSeconds).toBeCloseTo((60 / 90) * 4, 9)
  })

  it('reads 90 bpm in 4/4 as ninety plain quarters', () => {
    expect(tempoFromBeat(90, dur('quarter')).quarterBpm).toBeCloseTo(90, 9)
  })

  it('round-trips back into the beat the player is counting', () => {
    const t = tempoFromBeat(90, dur('quarter', 1))
    expect(bpmInBeat(t, dur('quarter', 1))).toBeCloseTo(90, 9)
    expect(bpmInBeat(t, dur('quarter'))).toBeCloseTo(135, 9)
  })

  it('handles a half-note beat in cut time', () => {
    expect(tempoFromBeat(60, dur('half')).quarterBpm).toBeCloseTo(120, 9)
  })
})

describe('rebaseTempo', () => {
  // Without the anchor, dragging a tempo slider mid-playback makes already
  // scheduled events land in the past, which sounds like a stutter.
  it('agrees with the old tempo at the moment of the change', () => {
    const slow = constantTempo(60)
    const atTick = 3 * PPQ
    const fast = rebaseTempo(slow, atTick, 120)

    expect(fast.secondsAtTick(atTick)).toBeCloseTo(slow.secondsAtTick(atTick), 9)
  })

  it('never moves time backwards after the change', () => {
    const slow = constantTempo(60)
    const atTick = 3 * PPQ
    const fast = rebaseTempo(slow, atTick, 200)

    let previous = fast.secondsAtTick(atTick)
    for (let tick = atTick; tick < atTick + 8 * PPQ; tick += 97) {
      const now = fast.secondsAtTick(tick)
      expect(now).toBeGreaterThanOrEqual(previous)
      previous = now
    }
  })

  it('runs at the new rate afterwards', () => {
    const fast = rebaseTempo(constantTempo(60), 2 * PPQ, 120)
    const oneQuarterLater = fast.secondsAtTick(3 * PPQ) - fast.secondsAtTick(2 * PPQ)
    expect(oneQuarterLater).toBeCloseTo(0.5, 9)
  })

  it('still inverts exactly', () => {
    const t = rebaseTempo(constantTempo(72), 5 * PPQ, 144)
    expect(t.tickAtSeconds(t.secondsAtTick(9 * PPQ))).toBeCloseTo(9 * PPQ, 6)
  })
})

describe('clampBpm', () => {
  it('keeps the tempo somewhere a human could play', () => {
    expect(clampBpm(5)).toBe(20)
    expect(clampBpm(1000)).toBe(300)
    expect(clampBpm(92.4)).toBe(92)
  })
})
