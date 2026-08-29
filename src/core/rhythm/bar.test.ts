import { describe, expect, it } from 'vitest'
import { rat } from '../math/rational'
import { PPQ } from '../ticks'
import { TRIPLET, dur } from './duration'
import { meter } from './meter'
import {
  beamGroups,
  fillsWholeBars,
  note,
  placeEvents,
  resolveTies,
  rest,
  tieGroups,
  validateBar,
} from './bar'

const notes = (...ds: ReturnType<typeof dur>[]) => ds.map((d) => note(d))
const repeat = (n: number, d: ReturnType<typeof dur>) => Array.from({ length: n }, () => note(d))

describe('validateBar', () => {
  const twelveEight = meter(12, 8)

  it('accepts four dotted quarters in 12/8', () => {
    const result = validateBar(twelveEight, repeat(4, dur('quarter', 1)))
    expect(result.ok).toBe(true)
    expect(result.total).toEqual(rat(3, 2))
  })

  it('accepts twelve eighths in 12/8', () => {
    expect(validateBar(twelveEight, repeat(12, dur('eighth'))).ok).toBe(true)
  })

  it('reports what a short bar is missing, in real note names', () => {
    const result = validateBar(twelveEight, repeat(3, dur('quarter', 1)))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('short')
    expect(result.difference).toEqual(rat(3, 8))
    expect(result.missing.map((d) => d.base)).toEqual(['quarter'])
    expect(result.message).toBe('short by a dotted quarter note')
  })

  it('reports an overfull bar too', () => {
    const result = validateBar(meter(4, 4), repeat(5, dur('quarter')))
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.kind).toBe('long')
    expect(result.message).toBe('long by a quarter note')
  })

  it('accepts a double-dotted half plus two sixteenths in 4/4', () => {
    expect(
      validateBar(meter(4, 4), notes(dur('half', 2), dur('sixteenth'), dur('sixteenth'))).ok,
    ).toBe(true)
  })

  it('accepts triplets that close exactly', () => {
    const bar = [...repeat(3, dur('eighth', 0, TRIPLET)), note(dur('quarter')), note(dur('half'))]
    expect(validateBar(meter(4, 4), bar).ok).toBe(true)
  })

  it('accepts a 4/4 bar of quarter-note triplets, which floats would reject', () => {
    expect(validateBar(meter(4, 4), repeat(6, dur('quarter', 0, TRIPLET))).ok).toBe(true)
  })

  it('counts rests toward the bar', () => {
    expect(
      validateBar(meter(4, 4), [note(dur('half')), rest(dur('quarter')), note(dur('quarter'))]).ok,
    ).toBe(true)
  })

  it('recognises multi-bar passages', () => {
    expect(fillsWholeBars(meter(4, 4), repeat(8, dur('quarter')))).toBe(true)
    expect(fillsWholeBars(meter(4, 4), repeat(7, dur('quarter')))).toBe(false)
  })
})

describe('placeEvents', () => {
  const m = meter(12, 8)

  it('puts each dotted quarter on its own beat with the right accent', () => {
    const placed = placeEvents(m, repeat(4, dur('quarter', 1)))
    expect(placed.map((p) => p.beat)).toEqual([0, 1, 2, 3])
    expect(placed.every((p) => p.startsOnBeat)).toBe(true)
    expect(placed.map((p) => p.accent)).toEqual(['strong', 'weak', 'medium', 'weak'])
  })

  it('locates the eighths inside each compound beat', () => {
    const placed = placeEvents(m, repeat(12, dur('eighth')))
    expect(placed.map((p) => p.beat)).toEqual([0, 0, 0, 1, 1, 1, 2, 2, 2, 3, 3, 3])
    expect(placed.filter((p) => p.startsOnBeat).map((p) => p.index)).toEqual([0, 3, 6, 9])
    expect(placed[0]?.accent).toBe('strong')
    expect(placed[1]?.accent).toBeNull() // offbeat, so no accent at all
  })

  it('flags an event that spills over its beat as syncopation', () => {
    // An eighth then a DOTTED quarter: the dotted quarter starts one pulse into
    // beat 0 and runs a full beat, so it lands across the beat line.
    const placed = placeEvents(m, [note(dur('eighth')), note(dur('quarter', 1)), note(dur('eighth'))])
    expect(placed[1]?.startsOnBeat).toBe(false)
    expect(placed[1]?.crossesBeat).toBe(true)
    expect(placed[0]?.crossesBeat).toBe(false)
  })

  it('does not call an event that exactly completes its beat a crossing', () => {
    // An eighth plus a plain quarter fills a compound beat precisely (1 + 2 = 3
    // pulses). Ending on the beat line is not crossing it.
    const placed = placeEvents(m, [note(dur('eighth')), note(dur('quarter'))])
    expect(placed[1]?.crossesBeat).toBe(false)
  })

  it('numbers bars across a multi-bar passage', () => {
    const placed = placeEvents(meter(4, 4), repeat(8, dur('quarter')))
    expect(placed.map((p) => p.bar)).toEqual([0, 0, 0, 0, 1, 1, 1, 1])
    expect(placed[4]?.onsetTicks).toBe(4 * PPQ)
  })
})

describe('ties', () => {
  it('sounds a note tied across a barline as one event', () => {
    const m = meter(4, 4)
    // Bar 1: half, half(tied) | Bar 2: quarter, dotted half
    const events = [
      note(dur('half')),
      note(dur('half'), { tiedToNext: true }),
      note(dur('quarter')),
      note(dur('half', 1)),
    ]

    const spans = resolveTies(m, events)
    expect(spans).toHaveLength(3)

    const tied = spans[1]
    expect(tied?.sourceIndices).toEqual([1, 2]) // both noteheads still known
    expect(tied?.durationValue).toEqual(rat(3, 4)) // half + quarter
    expect(tied?.onsetTicks).toBe(2 * PPQ)

    // The critical negative: nothing is rearticulated at the barline.
    expect(spans.map((s) => s.onsetTicks)).not.toContain(4 * PPQ)
  })

  it('chains three tied notes into one span', () => {
    const events = [
      note(dur('quarter'), { tiedToNext: true }),
      note(dur('quarter'), { tiedToNext: true }),
      note(dur('quarter')),
      note(dur('quarter')),
    ]
    const spans = resolveTies(meter(4, 4), events)
    expect(spans).toHaveLength(2)
    expect(spans[0]?.sourceIndices).toEqual([0, 1, 2])
    expect(spans[0]?.durationValue).toEqual(rat(3, 4))
  })

  it('leaves untied events alone', () => {
    const spans = resolveTies(meter(4, 4), repeat(4, dur('quarter')))
    expect(spans).toHaveLength(4)
    expect(spans.every((s) => s.sourceIndices.length === 1)).toBe(true)
  })

  it('does not tie into a rest', () => {
    const events = [note(dur('quarter'), { tiedToNext: true }), rest(dur('quarter')), note(dur('half'))]
    const spans = resolveTies(meter(4, 4), events)
    expect(spans).toHaveLength(3)
    expect(spans[0]?.sourceIndices).toEqual([0])
  })

  it('reports tie groups for drawing the curves', () => {
    const events = [
      note(dur('quarter'), { tiedToNext: true }),
      note(dur('quarter')),
      note(dur('quarter'), { tiedToNext: true }),
      note(dur('quarter')),
    ]
    expect(tieGroups(events)).toEqual([[0, 1], [2, 3]])
  })
})

describe('beam groups', () => {
  it('beams 12/8 in threes, not sixes', () => {
    const groups = beamGroups(meter(12, 8), repeat(12, dur('eighth')))
    expect(groups).toEqual([
      [0, 1, 2],
      [3, 4, 5],
      [6, 7, 8],
      [9, 10, 11],
    ])
  })

  it('beams 6/8 in threes', () => {
    expect(beamGroups(meter(6, 8), repeat(6, dur('eighth')))).toEqual([
      [0, 1, 2],
      [3, 4, 5],
    ])
  })

  it('beams 4/4 eighths per quarter-note beat', () => {
    expect(beamGroups(meter(4, 4), repeat(8, dur('eighth')))).toEqual([
      [0, 1],
      [2, 3],
      [4, 5],
      [6, 7],
    ])
  })

  it('beams 7/8 by its 2+2+3 grouping', () => {
    expect(beamGroups(meter(7, 8), repeat(7, dur('eighth')))).toEqual([
      [0, 1],
      [2, 3],
      [4, 5, 6],
    ])
  })

  it('does not beam notes a beat long or longer', () => {
    expect(beamGroups(meter(4, 4), repeat(4, dur('quarter')))).toEqual([])
  })

  it('does not beam a rest into a group', () => {
    const events = [note(dur('eighth')), rest(dur('eighth')), note(dur('eighth')), note(dur('eighth'))]
    const groups = beamGroups(meter(2, 4), events)
    expect(groups.flat()).not.toContain(1)
  })
})
