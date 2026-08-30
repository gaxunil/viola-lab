import { describe, expect, it } from 'vitest'
import { PPQ } from '../ticks'
import { pc } from '../pitch/pitch'
import { SCALE_TYPES } from '../scale/scaleTypes'
import { buildScale } from '../scale/scale'
import { meter } from '../rhythm/meter'
import { dur } from '../rhythm/duration'
import { note, rest } from '../rhythm/bar'
import { constantTempo, tempoFromBeat } from '../tempo'
import { eventAtTick, noteEvents } from '../score'
import { compileMetronome } from './metronome'
import { compileScale } from './scale'
import { fingerScale } from '../viola/scaleFingering'
import { compileRhythm, tapGridFor } from './rhythm'

const clicks = (s: ReturnType<typeof compileMetronome>) =>
  s.events.filter((e) => e.payload.type === 'click')

const accentsOf = (s: ReturnType<typeof compileMetronome>) =>
  clicks(s).map((e) => (e.payload.type === 'click' ? e.payload.accent : null))

describe('the metronome', () => {
  it('clicks four times in a bar of 12/8, not twelve', () => {
    const score = compileMetronome({ meter: meter(12, 8), bars: 1 })
    expect(clicks(score)).toHaveLength(4)
    expect(accentsOf(score)).toEqual(['strong', 'weak', 'medium', 'weak'])
  })

  it('puts those four clicks on pulses 1, 4, 7 and 10', () => {
    const m = meter(12, 8)
    const score = compileMetronome({ meter: m, bars: 1 })
    expect(clicks(score).map((e) => e.tick / m.pulseTicks)).toEqual([0, 3, 6, 9])
  })

  it('lasts the right amount of time', () => {
    const m = meter(12, 8)
    const score = compileMetronome({ meter: m, bars: 2 })
    expect(score.lengthTicks).toBe(2 * m.barTicks)
    expect(clicks(score)).toHaveLength(8)

    // At 90 dotted-quarter bpm, one 12/8 bar is four beats.
    const tempo = tempoFromBeat(90, m.beatUnit)
    expect(tempo.secondsAtTick(m.barTicks)).toBeCloseTo((60 / 90) * 4, 6)
  })

  it('subdivides without competing with the beat', () => {
    const score = compileMetronome({ meter: meter(4, 4), bars: 1, subdivision: 2 })
    expect(clicks(score)).toHaveLength(8)
    expect(accentsOf(score)).toEqual([
      'strong', 'weak', 'weak', 'weak', 'medium', 'weak', 'weak', 'weak',
    ])
  })

  it('clicks the real groups of an asymmetric meter', () => {
    const m = meter(7, 8)
    const score = compileMetronome({ meter: m, bars: 1 })
    expect(clicks(score).map((e) => e.tick / m.pulseTicks)).toEqual([0, 2, 4])
    expect(accentsOf(score)).toEqual(['strong', 'medium', 'medium'])
  })

  it('hears a count-in once, then loops only the body', () => {
    const m = meter(4, 4)
    const score = compileMetronome({ meter: m, bars: 2, countInBars: 1, loop: true })

    expect(score.bodyStartTick).toBe(m.barTicks)
    expect(score.events.filter((e) => e.countIn)).toHaveLength(4)
    expect(score.loop).toEqual({ startTick: m.barTicks, endTick: 3 * m.barTicks })
  })

  it('refuses to compile no bars at all', () => {
    expect(() => compileMetronome({ meter: meter(4, 4), bars: 0 })).toThrow(RangeError)
  })
})

describe('a scale', () => {
  it('emits one note per realized pitch, evenly spaced', () => {
    const scale = buildScale(pc('C'), SCALE_TYPES.major)
    const { score, pitches } = compileScale({ scale, startOctave: 3, octaves: 2 })

    expect(pitches).toHaveLength(15)
    expect(noteEvents(score)).toHaveLength(15)

    const eighth = PPQ / 2
    expect(noteEvents(score).map((e) => e.tick)).toEqual(
      Array.from({ length: 15 }, (_, i) => i * eighth),
    )
  })

  it('tags every note with its position in the run, for highlighting', () => {
    const scale = buildScale(pc('D'), SCALE_TYPES.major)
    const { score } = compileScale({ scale, startOctave: 3, octaves: 2 })
    expect(noteEvents(score).map((e) => e.uiIndex)).toEqual(
      Array.from({ length: 15 }, (_, i) => i),
    )
  })

  it('sounds the pitches the scale actually contains', () => {
    const scale = buildScale(pc('E', -1), SCALE_TYPES.major)
    const { score, pitches } = compileScale({ scale, startOctave: 3, octaves: 1 })
    const midis = noteEvents(score).map((e) => (e.payload.type === 'note' ? e.payload.midi : -1))
    expect(midis[0]).toBe(51) // E flat 3
    expect(midis[midis.length - 1]).toBe(63) // E flat 4
    expect(midis).toHaveLength(pitches.length)
  })

  it('plays melodic minor asymmetrically', () => {
    const scale = buildScale(pc('A'), SCALE_TYPES['melodic-minor'])
    const { pitches } = compileScale({
      scale,
      startOctave: 3,
      octaves: 1,
      direction: 'up-down',
    })
    const midis = pitches.map((p) => p.letter + (p.alter === 1 ? '#' : p.alter === -1 ? 'b' : ''))
    expect(midis[5]).toBe('F#') // ascending
    expect(midis[9]).toBe('F') // descending reverts
  })

  it('counts her in with clicks, not with notes', () => {
    const scale = buildScale(pc('C'), SCALE_TYPES.major)
    const { score } = compileScale({ scale, startOctave: 4, octaves: 1, countInBars: 1 })
    const countIn = score.events.filter((e) => e.countIn)
    expect(countIn).toHaveLength(4)
    expect(countIn.every((e) => e.payload.type === 'click')).toBe(true)
    expect(noteEvents(score).every((e) => e.tick >= score.bodyStartTick)).toBe(true)
  })
})

describe('a rhythm exercise', () => {
  const m = meter(12, 8)

  it('sounds four dotted quarters over four clicks', () => {
    const events = Array.from({ length: 4 }, () => note(dur('quarter', 1)))
    const score = compileRhythm({ meter: m, events })

    expect(noteEvents(score)).toHaveLength(4)
    expect(score.events.filter((e) => e.payload.type === 'click')).toHaveLength(4)
  })

  it('can be played without a click', () => {
    const events = Array.from({ length: 4 }, () => note(dur('quarter', 1)))
    const score = compileRhythm({ meter: m, events, withClick: false })
    expect(score.events.filter((e) => e.payload.type === 'click')).toHaveLength(0)
  })

  it('does not rearticulate a note tied across a barline', () => {
    const fourFour = meter(4, 4)
    const events = [
      note(dur('half')),
      note(dur('half'), { tiedToNext: true }),
      note(dur('quarter')),
      note(dur('half', 1)),
    ]
    const score = compileRhythm({ meter: fourFour, events, withClick: false })

    expect(noteEvents(score)).toHaveLength(3)
    // Nothing starts at the barline.
    expect(noteEvents(score).map((e) => e.tick)).not.toContain(4 * PPQ)
    // The tied note lasts a half plus a quarter.
    expect(noteEvents(score)[1]?.durationTicks).toBe(3 * PPQ)
  })

  it('leaves a rest silent but still takes its time', () => {
    const fourFour = meter(4, 4)
    const events = [note(dur('half')), rest(dur('quarter')), note(dur('quarter'))]
    const score = compileRhythm({ meter: fourFour, events, withClick: false })

    expect(noteEvents(score)).toHaveLength(2)
    expect(noteEvents(score)[1]?.tick).toBe(3 * PPQ)
    expect(score.lengthTicks).toBe(4 * PPQ)
  })

  it('accents notes that land on strong beats', () => {
    const events = Array.from({ length: 4 }, () => note(dur('quarter', 1)))
    const score = compileRhythm({ meter: m, events, withClick: false })
    const velocities = noteEvents(score).map((e) => (e.payload.type === 'note' ? e.payload.velocity : 0))
    expect(velocities[0]).toBeGreaterThan(velocities[1]!)
    expect(velocities[2]).toBeGreaterThan(velocities[1]!)
  })

  it('derives the bar count from the events themselves', () => {
    const fourFour = meter(4, 4)
    const twoBars = Array.from({ length: 8 }, () => note(dur('quarter')))
    expect(compileRhythm({ meter: fourFour, events: twoBars }).lengthTicks).toBe(8 * PPQ)
  })

  it('refuses a rhythm that does not fit its meter', () => {
    expect(() =>
      compileRhythm({ meter: m, events: Array.from({ length: 3 }, () => note(dur('quarter', 1))) }),
    ).toThrow(RangeError)
  })
})

describe('the tap target grid', () => {
  it('targets the notated rhythm, not the click track', () => {
    const fourFour = meter(4, 4)
    const events = [note(dur('quarter')), rest(dur('quarter')), note(dur('half'))]
    const tempo = constantTempo(120)

    const grid = tapGridFor(fourFour, events, tempo.secondsAtTick)
    expect(grid).toHaveLength(2) // the rest is not a target
    expect(grid[0]?.time).toBeCloseTo(0, 9)
    expect(grid[1]?.time).toBeCloseTo(1, 9) // two quarters in at 120bpm
  })

  it('makes a tied note one target, not two', () => {
    const fourFour = meter(4, 4)
    const events = [
      note(dur('half'), { tiedToNext: true }),
      note(dur('half')),
      note(dur('whole')),
    ]
    const grid = tapGridFor(fourFour, events, constantTempo(120).secondsAtTick)
    expect(grid).toHaveLength(2)
  })

  it('carries the accent so the UI can show which taps matter most', () => {
    const events = Array.from({ length: 4 }, () => note(dur('quarter', 1)))
    const grid = tapGridFor(meter(12, 8), events, constantTempo(120).secondsAtTick)
    expect(grid.map((g) => g.accent)).toEqual(['strong', 'weak', 'medium', 'weak'])
  })

  it('offsets the grid past a count-in', () => {
    const fourFour = meter(4, 4)
    const events = Array.from({ length: 4 }, () => note(dur('quarter')))
    const grid = tapGridFor(fourFour, events, constantTempo(120).secondsAtTick, { countInBars: 1 })
    expect(grid[0]?.time).toBeCloseTo(2, 9) // one bar of 4/4 at 120bpm
  })
})

describe('score housekeeping', () => {
  it('numbers events by their position after sorting', () => {
    const score = compileMetronome({ meter: meter(4, 4), bars: 2 })
    expect(score.events.map((e) => e.id)).toEqual(score.events.map((_, i) => i))
  })

  it('keeps events in tick order', () => {
    const score = compileRhythm({
      meter: meter(4, 4),
      events: Array.from({ length: 8 }, () => note(dur('eighth'))),
    })
    const ticksOut = score.events.map((e) => e.tick)
    expect([...ticksOut].sort((a, b) => a - b)).toEqual(ticksOut)
  })

  it('finds the event sounding at a moment, for highlighting', () => {
    const scale = buildScale(pc('C'), SCALE_TYPES.major)
    const { score } = compileScale({ scale, startOctave: 4, octaves: 1 })
    const eighth = PPQ / 2

    expect(eventAtTick(score, 0)?.uiIndex).toBe(0)
    expect(eventAtTick(score, eighth + 10)?.uiIndex).toBe(1)
    expect(eventAtTick(score, 3 * eighth)?.uiIndex).toBe(3)
  })
})

describe('the fingering and the playback must agree', () => {
  /**
   * A real bug this pins: the fingerboard highlights by index into the fingering
   * plan, and playback supplies that index. If the plan is built in one
   * direction while the scale plays in another, every index past the top note
   * has no dot to light and the descent silently goes dark — the notes still
   * sound, the diagram just stops following.
   */
  const cases: Array<{ direction: 'up' | 'down' | 'up-down'; octaves: 1 | 2 | 3 }> = [
    { direction: 'up', octaves: 1 },
    { direction: 'up', octaves: 2 },
    { direction: 'up-down', octaves: 1 },
    { direction: 'up-down', octaves: 2 },
    { direction: 'down', octaves: 2 },
  ]

  it('produces one fingered note per sounded note, in every direction', () => {
    const scale = buildScale(pc('C'), SCALE_TYPES.major)

    for (const { direction, octaves } of cases) {
      const plan = fingerScale(scale, { startOctave: 3, octaves, direction })
      const { score } = compileScale({ scale, startOctave: 3, octaves, direction })
      const sounded = noteEvents(score)

      expect(plan.notes.length, `${direction} over ${octaves} octaves`).toBe(sounded.length)

      // And every sounded note must be findable in the plan by its own index.
      for (const event of sounded) {
        const fingered = plan.notes[event.uiIndex ?? -1]
        expect(fingered, `no fingering for note ${event.uiIndex}`).toBeDefined()
      }
    }
  })

  it('keeps them aligned for an asymmetric scale, where the descent differs', () => {
    const melodic = buildScale(pc('A'), SCALE_TYPES['melodic-minor'])
    const plan = fingerScale(melodic, { startOctave: 3, octaves: 2, direction: 'up-down' })
    const { score, pitches } = compileScale({
      scale: melodic,
      startOctave: 3,
      octaves: 2,
      direction: 'up-down',
    })

    expect(plan.notes.length).toBe(noteEvents(score).length)
    // The fingered pitches are the pitches that sound, descent included.
    expect(plan.notes.map((n) => n.pitch)).toEqual(pitches)
  })
})

describe('looping a scale', () => {
  it('carries no loop unless asked', () => {
    const scale = buildScale(pc('C'), SCALE_TYPES.major)
    const { score } = compileScale({ scale, startOctave: 3, octaves: 2 })
    expect(score.loop).toBeUndefined()
  })

  it('loops the run only, so a count-in is heard once', () => {
    const scale = buildScale(pc('C'), SCALE_TYPES.major)
    const { score } = compileScale({
      scale,
      startOctave: 3,
      octaves: 2,
      direction: 'up-down',
      countInBars: 1,
      loop: true,
    })

    expect(score.loop).toBeDefined()
    expect(score.loop!.startTick).toBe(score.bodyStartTick)
    expect(score.loop!.endTick).toBe(score.lengthTicks)
    // The count-in sits before the loop and is therefore played once.
    expect(score.bodyStartTick).toBeGreaterThan(0)
  })

  it('keeps every note inside the loop it repeats', () => {
    const scale = buildScale(pc('D'), SCALE_TYPES.major)
    const { score } = compileScale({
      scale,
      startOctave: 3,
      octaves: 2,
      direction: 'up-down',
      loop: true,
    })

    for (const event of noteEvents(score)) {
      expect(event.tick).toBeGreaterThanOrEqual(score.loop!.startTick)
      expect(event.tick).toBeLessThan(score.loop!.endTick)
    }
  })
})

describe('where the beat lands is audible', () => {
  /**
   * A weak BEAT is still a beat. In 12/8 the accent pattern is
   * strong-weak-medium-weak, so beats two and four are marked weak — and
   * sounding them exactly like the subdivisions around them hides the pulse,
   * which is the one thing a rhythm exercise is for.
   */
  it('gives four tiers: downbeat, secondary accent, other beats, offbeats', () => {
    const score = compileRhythm({
      meter: meter(12, 8),
      events: Array.from({ length: 12 }, () => note(dur('eighth'))),
      withClick: false,
    })
    const velocities = noteEvents(score).map((e) =>
      e.payload.type === 'note' ? e.payload.velocity : 0,
    )

    const downbeat = velocities[0]!
    const secondary = velocities[6]!
    const otherBeat = velocities[3]!
    const offbeat = velocities[1]!

    expect(downbeat).toBeGreaterThan(secondary)
    expect(secondary).toBeGreaterThan(otherBeat)
    expect(otherBeat).toBeGreaterThan(offbeat)

    // Beats two and four match each other, and neither sounds like an offbeat.
    expect(velocities[9]).toBe(otherBeat)
    expect(velocities[3]).not.toBe(velocities[4])
  })

  it('marks every beat above every offbeat, in simple meters too', () => {
    const score = compileRhythm({
      meter: meter(4, 4),
      events: Array.from({ length: 8 }, () => note(dur('eighth'))),
      withClick: false,
    })
    const velocities = noteEvents(score).map((e) =>
      e.payload.type === 'note' ? e.payload.velocity : 0,
    )

    const onBeats = velocities.filter((_, i) => i % 2 === 0)
    const offBeats = velocities.filter((_, i) => i % 2 === 1)
    expect(Math.min(...onBeats)).toBeGreaterThan(Math.max(...offBeats))
  })
})
