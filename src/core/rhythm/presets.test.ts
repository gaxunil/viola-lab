import { describe, expect, it } from 'vitest'
import { rat, req, rmul } from '../math/rational'
import { barTotal, fillsWholeBars, placeEvents, resolveTies, validateBar } from './bar'
import { durationValue } from './duration'
import { type Meter, beatOnsets, meter } from './meter'
import {
  PRESET_METERS,
  type PresetTag,
  RHYTHM_PRESETS,
  type RhythmPreset,
  presetBars,
  presetById,
  presetsByTag,
  presetsForMeter,
} from './presets'

const rows = RHYTHM_PRESETS.map((p) => [p.id, p] as const)

const withId = (id: string): RhythmPreset => {
  const found = presetById(id)
  if (found === null) throw new Error(`no preset with id ${id}`)
  return found
}

const inMeter = (numerator: number, denominator: 1 | 2 | 4 | 8 | 16): RhythmPreset[] =>
  RHYTHM_PRESETS.filter(
    (p) => p.meter.numerator === numerator && p.meter.denominator === denominator,
  )

// The single most important test in the file. Every preset is a claim about how
// a bar is filled, and a preset that does not add up would render as a broken
// bar rather than as an error.
describe('every preset exactly fills its bar', () => {
  it.each(rows)('%s adds up', (_id, preset) => {
    const bars = presetBars(preset)

    if (bars === 1) {
      const result = validateBar(preset.meter, preset.events)
      // Surface the library's own message when this fails, not just `false`.
      expect(result.ok ? 'ok' : result.message).toBe('ok')
      return
    }

    const expected = rmul(preset.meter.barValue, rat(bars))
    expect(req(barTotal(preset.events), expected)).toBe(true)
  })

  it.each(rows)('%s fills a whole number of bars', (_id, preset) => {
    expect(fillsWholeBars(preset.meter, preset.events)).toBe(true)
  })

  it('has no preset whose events are empty', () => {
    for (const p of RHYTHM_PRESETS) expect(p.events.length).toBeGreaterThan(0)
  })
})

describe('multi-bar presets', () => {
  const multi = RHYTHM_PRESETS.filter((p) => presetBars(p) > 1)

  it('exist, because a tie across a barline needs two bars to show', () => {
    expect(multi.length).toBeGreaterThanOrEqual(2)
  })

  it.each(multi.map((p) => [p.id, p] as const))(
    '%s spans exactly its declared number of bars',
    (_id, preset) => {
      const bars = presetBars(preset)
      expect(req(barTotal(preset.events), rmul(preset.meter.barValue, rat(bars)))).toBe(true)

      const placed = placeEvents(preset.meter, preset.events)
      const lastBar = Math.max(...placed.map((p) => p.bar))
      expect(lastBar).toBe(bars - 1)
    },
  )

  it('ties the last event of the first bar into the second, in both barline examples', () => {
    for (const id of ['4-4-tie-across-the-barline', '12-8-tie-across-the-barline']) {
      const preset = withId(id)
      const placed = placeEvents(preset.meter, preset.events)
      const crossing = placed.find((p) => p.bar === 0 && p.event.tiedToNext === true)
      expect(crossing).toBeDefined()
      // The tie must be on the LAST event of bar 1, or it does not cross anything.
      const next = crossing === undefined ? undefined : placed[crossing.index + 1]
      expect(next?.bar).toBe(1)
    }
  })
})

describe('preset identity', () => {
  it('gives every preset a unique id', () => {
    const ids = RHYTHM_PRESETS.map((p) => p.id)
    expect(new Set(ids).size).toBe(ids.length)
  })

  it('writes every id in kebab-case', () => {
    for (const p of RHYTHM_PRESETS) {
      expect(p.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/)
    }
  })

  it('finds a preset by id and returns null for one that does not exist', () => {
    expect(presetById('12-8-basic-pulse')?.name).toBe('Four dotted quarters')
    expect(presetById('nope')).toBeNull()
  })

  it('gives every preset a non-empty name', () => {
    for (const p of RHYTHM_PRESETS) expect(p.name.trim().length).toBeGreaterThan(0)
  })
})

describe('the teaching note on each preset', () => {
  const normalize = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

  it('is present and long enough to teach something', () => {
    for (const p of RHYTHM_PRESETS) {
      expect(p.note.trim().length, `${p.id} has an empty note`).toBeGreaterThan(0)
      expect(p.note.trim().length, `${p.id} has a stub note`).toBeGreaterThan(60)
    }
  })

  it('does not merely restate the preset name', () => {
    for (const p of RHYTHM_PRESETS) {
      const note = normalize(p.note)
      const name = normalize(p.name)
      expect(note).not.toBe(name)
      // Even with the name quoted inside it, the note must carry real content.
      const remainder = note.replace(name, '').trim()
      expect(remainder.length, `${p.id} says little beyond its name`).toBeGreaterThan(50)
    }
  })

  it('ends each note as a sentence', () => {
    for (const p of RHYTHM_PRESETS) expect(p.note.trim().endsWith('.')).toBe(true)
  })
})

describe('12/8, the meter she asked about', () => {
  const twelveEight = presetsForMeter(meter(12, 8))

  it('has at least five presets, more than any other compound meter', () => {
    expect(twelveEight.length).toBeGreaterThanOrEqual(5)
    expect(twelveEight.length).toBeGreaterThan(presetsForMeter(meter(6, 8)).length)
    expect(twelveEight.length).toBeGreaterThan(presetsForMeter(meter(9, 8)).length)
  })

  it('returns only 12/8 presets from presetsForMeter', () => {
    expect(twelveEight.length).toBe(inMeter(12, 8).length)
    for (const p of twelveEight) {
      expect(p.meter.label).toBe('12/8')
      expect(p.meter.grouping).toEqual([3, 3, 3, 3])
    }
  })

  it('covers the pulse, the eighths, the shuffle, the dotted values and a tie', () => {
    const ids = twelveEight.map((p) => p.id)
    expect(ids).toContain('12-8-basic-pulse')
    expect(ids).toContain('12-8-twelve-eighths')
    expect(ids).toContain('12-8-shuffle')
    expect(ids).toContain('12-8-dotted-half-and-dotted-quarter')
    expect(twelveEight.some((p) => p.tags.includes('ties'))).toBe(true)
  })

  it('writes the basic pulse as four dotted quarters, one per felt beat', () => {
    const preset = withId('12-8-basic-pulse')
    expect(preset.events.length).toBe(preset.meter.beats)
    for (const e of preset.events) {
      expect(req(durationValue(e.duration), preset.meter.beatValue)).toBe(true)
    }
  })

  it('puts an attack on every beat in the shuffle and on none of them in the offbeat preset', () => {
    const shuffle = withId('12-8-shuffle')
    const onShuffleBeats = placeEvents(shuffle.meter, shuffle.events).filter(
      (p) => p.startsOnBeat && p.event.kind === 'note',
    )
    expect(onShuffleBeats.length).toBe(4)

    const offbeat = withId('12-8-offbeat-accents')
    const onOffbeatBeats = placeEvents(offbeat.meter, offbeat.events).filter(
      (p) => p.startsOnBeat && p.event.kind === 'note',
    )
    expect(onOffbeatBeats.length).toBe(0)
  })

  it('leaves beat 3 unattacked in the tie preset, which is the point of it', () => {
    const preset = withId('12-8-tie-into-beat-three')
    // Ties are resolved before anything sounds, so the tied pair is one span
    // with one onset — the beat 3 notehead is held, not struck.
    const onsets = resolveTies(preset.meter, preset.events).map(
      (s) => s.onsetTicks / preset.meter.pulseTicks,
    )
    expect(onsets).toEqual([0, 3, 4, 5, 9])
    expect(onsets).not.toContain(6)
  })
})

describe('asymmetric meters, where the grouping is the meter', () => {
  const seven = (grouping: readonly number[]): RhythmPreset[] =>
    presetsForMeter(meter(7, 8, { grouping }))

  it('separates 7/8 as 2+2+3 from 7/8 as 3+2+2', () => {
    const a = seven([2, 2, 3])
    const b = seven([3, 2, 2])
    expect(a.length).toBeGreaterThan(0)
    expect(b.length).toBeGreaterThan(0)

    // Same time signature, so a lookup that compared only labels would merge them.
    const bIds = new Set(b.map((p) => p.id))
    expect(a.filter((p) => bIds.has(p.id))).toEqual([])
  })

  it('moves the beats when 7/8 is regrouped', () => {
    const a = seven([2, 2, 3])[0]
    const b = seven([3, 2, 2])[0]
    expect(a).toBeDefined()
    expect(b).toBeDefined()
    if (a === undefined || b === undefined) return

    const pulses = (m: Meter): number[] => beatOnsets(m).map((t) => t / m.pulseTicks)
    expect(pulses(a.meter)).toEqual([0, 2, 4])
    expect(pulses(b.meter)).toEqual([0, 3, 5])
    expect(pulses(a.meter)).not.toEqual(pulses(b.meter))
  })

  it('places its notes on those beats, so the regrouping is audible and not just labelled', () => {
    const onsets = (id: string): number[] => {
      const preset = withId(id)
      return placeEvents(preset.meter, preset.events).map(
        (p) => p.onsetTicks / preset.meter.pulseTicks,
      )
    }
    expect(onsets('7-8-two-two-three')).toEqual([0, 2, 4])
    expect(onsets('7-8-three-two-two')).toEqual([0, 3, 5])
  })

  it('does the same for 5/8 as 3+2 versus 2+3', () => {
    const threeTwo = presetsForMeter(meter(5, 8, { grouping: [3, 2] }))
    const twoThree = presetsForMeter(meter(5, 8, { grouping: [2, 3] }))
    expect(threeTwo.length).toBeGreaterThan(0)
    expect(twoThree.length).toBeGreaterThan(0)

    const secondBeat = (m: Meter): number | undefined => {
      const onsets = beatOnsets(m).map((t) => t / m.pulseTicks)
      return onsets[1]
    }
    expect(secondBeat(meter(5, 8, { grouping: [3, 2] }))).toBe(3)
    expect(secondBeat(meter(5, 8, { grouping: [2, 3] }))).toBe(2)
  })

  it('has at least three presets covering the regroupings', () => {
    const asymmetric = presetsByTag('asymmetric')
    expect(asymmetric.length).toBeGreaterThanOrEqual(3)
    for (const p of asymmetric) expect(p.meter.class).toBe('asymmetric')
  })
})

describe('coverage of the meters a student meets first', () => {
  it('includes every meter named in the curriculum', () => {
    const labels = new Set(RHYTHM_PRESETS.map((p) => p.meter.label))
    for (const label of ['4/4', '3/4', '2/4', '2/2', '6/8', '9/8', '12/8', '5/8', '7/8', '5/4']) {
      expect(labels.has(label), `no presets in ${label}`).toBe(true)
    }
  })

  it('lists each distinct meter once, in teaching order', () => {
    const keys = PRESET_METERS.map((m) => `${m.label}:${m.grouping.join('+')}`)
    expect(new Set(keys).size).toBe(keys.length)
    expect(keys[0]).toBe('4/4:1+1+1+1')
    // Simple meters before compound, compound before asymmetric.
    const classes = PRESET_METERS.map((m) => m.class)
    expect(classes.indexOf('simple')).toBeLessThan(classes.indexOf('compound'))
    expect(classes.indexOf('compound')).toBeLessThan(classes.indexOf('asymmetric'))
  })

  it('has a preset for every meter it lists, and lists a meter for every preset', () => {
    for (const m of PRESET_METERS) expect(presetsForMeter(m).length).toBeGreaterThan(0)

    const listed = new Set(PRESET_METERS.map((m) => `${m.label}:${m.grouping.join('+')}`))
    for (const p of RHYTHM_PRESETS) {
      expect(listed.has(`${p.meter.label}:${p.meter.grouping.join('+')}`)).toBe(true)
    }
  })

  it('is large enough to browse without being a dump', () => {
    expect(RHYTHM_PRESETS.length).toBeGreaterThanOrEqual(30)
    expect(RHYTHM_PRESETS.length).toBeLessThanOrEqual(60)
  })

  it('covers 4/4 with the whole progression from whole notes to triplets and ties', () => {
    const ids = inMeter(4, 4).map((p) => p.id)
    for (const id of [
      '4-4-whole-note',
      '4-4-half-notes',
      '4-4-quarter-notes',
      '4-4-eighth-notes',
      '4-4-sixteenth-notes',
      '4-4-dotted-quarter-eighth',
      '4-4-long-short',
      '4-4-syncopation',
      '4-4-quarter-triplets',
      '4-4-eighth-triplets',
      '4-4-tie-across-beats',
      '4-4-tie-across-the-barline',
      '4-4-rest-on-the-downbeat',
    ]) {
      expect(ids).toContain(id)
    }
  })

  it('contrasts 6/8 with 3/4 using bars of identical length', () => {
    const sixEight = withId('6-8-eighth-notes')
    const threeFour = withId('3-4-eighth-notes')
    expect(req(sixEight.meter.barValue, threeFour.meter.barValue)).toBe(true)
    // Same durations, different felt beats: two in 6/8, three in 3/4.
    expect(sixEight.meter.beats).toBe(2)
    expect(threeFour.meter.beats).toBe(3)
  })
})

describe('tags', () => {
  const ALL_TAGS: readonly PresetTag[] = [
    'beginner',
    'compound',
    'syncopation',
    'tuplet',
    'asymmetric',
    'dotted',
    'ties',
  ]

  it('returns only presets carrying the tag', () => {
    for (const tag of ALL_TAGS) {
      for (const p of presetsByTag(tag)) expect(p.tags).toContain(tag)
    }
  })

  it('uses every tag it declares', () => {
    for (const tag of ALL_TAGS) {
      expect(presetsByTag(tag).length, `nothing is tagged ${tag}`).toBeGreaterThan(0)
    }
  })

  it('gives every preset at least one tag and no duplicates within it', () => {
    for (const p of RHYTHM_PRESETS) {
      expect(p.tags.length).toBeGreaterThan(0)
      expect(new Set(p.tags).size).toBe(p.tags.length)
    }
  })

  it('tags every compound-meter preset as compound', () => {
    for (const p of RHYTHM_PRESETS) {
      if (p.meter.class !== 'compound') continue
      expect(p.tags, `${p.id} is in ${p.meter.label} but is not tagged compound`).toContain(
        'compound',
      )
    }
  })

  it('tags every preset containing a tie as ties', () => {
    for (const p of RHYTHM_PRESETS) {
      const hasTie = p.events.some((e) => e.tiedToNext === true)
      expect(hasTie, `${p.id}`).toBe(p.tags.includes('ties'))
    }
  })

  it('tags every preset containing a tuplet as tuplet', () => {
    for (const p of RHYTHM_PRESETS) {
      const hasTuplet = p.events.some((e) => e.duration.tuplet !== undefined)
      expect(hasTuplet, `${p.id}`).toBe(p.tags.includes('tuplet'))
    }
  })
})
