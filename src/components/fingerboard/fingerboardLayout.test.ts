import { describe, expect, it } from 'vitest'
import { formatPitch, pc, toMidi } from '@core/pitch/pitch'
import { buildScale } from '@core/scale/scale'
import { SCALE_TYPES } from '@core/scale/scaleTypes'
import { fingerScale } from '@core/viola/scaleFingering'
import { STRINGS } from '@core/viola/strings'
import {
  type FingerboardLayout,
  buildFingerboardLayout,
  describeFingerboard,
  dotForPlanNote,
} from './fingerboardLayout'

const major = (letter: Parameters<typeof pc>[0], alter: -1 | 0 | 1 = 0) =>
  buildScale(pc(letter, alter), SCALE_TYPES.major)

const cMajor = major('C')
const gMajor = major('G')
const bFlatMajor = major('B', -1)

const cMajorPlan = fingerScale(cMajor, { startOctave: 3, octaves: 2 })
const gMajorPlan = fingerScale(gMajor, { startOctave: 3, octaves: 2 })
const bFlatPlan = fingerScale(bFlatMajor, { startOctave: 3, octaves: 2 })

const played = (layout: FingerboardLayout) => layout.dots.filter((dot) => dot.inPlan)

describe('how the strings are laid out', () => {
  it('puts string I at the top and string IV at the bottom', () => {
    const layout = buildFingerboardLayout({})
    const [first] = layout.strings
    const last = layout.strings[layout.strings.length - 1]

    expect(first?.id).toBe('I')
    expect(last?.id).toBe('IV')
    expect(first!.y).toBeLessThan(last!.y)
  })

  it('orders the four strings by y, highest string first', () => {
    const layout = buildFingerboardLayout({})
    const ys = layout.strings.map((s) => s.y)

    expect(layout.strings.map((s) => s.id)).toEqual(['I', 'II', 'III', 'IV'])
    expect(ys).toEqual([...ys].sort((a, b) => a - b))
    for (const y of ys) {
      expect(y).toBeGreaterThan(0)
      expect(y).toBeLessThan(1)
    }
  })

  it('names each string by its numeral and its open note', () => {
    const layout = buildFingerboardLayout({})
    const fourth = layout.strings.find((s) => s.id === 'IV')

    expect(fourth?.label).toBe('IV (C)')
    expect(fourth?.openLabel).toBe('C3')
  })

  it('gives a dot the same y as the string it sits on', () => {
    const layout = buildFingerboardLayout({ plan: cMajorPlan })
    for (const dot of layout.dots) {
      const line = layout.strings.find((s) => s.id === dot.string)
      expect(dot.y).toBe(line?.y)
      expect(dot.stringIndex).toBe(STRINGS[dot.string].index)
    }
  })
})

describe('the open strings', () => {
  it('shows all four open strings at the nut, open and unfingered', () => {
    const layout = buildFingerboardLayout({ scale: cMajor })
    const open = layout.dots.filter((dot) => dot.semitonesAboveOpen === 0)

    expect(open.map((dot) => dot.string)).toEqual(['I', 'II', 'III', 'IV'])
    for (const dot of open) {
      expect(dot.x).toBe(0)
      expect(dot.isOpen).toBe(true)
      expect(dot.finger).toBe(0)
    }
  })

  it('shows the open strings the plan plays as open, with finger zero', () => {
    const layout = buildFingerboardLayout({ plan: cMajorPlan })
    const open = played(layout).filter((dot) => dot.isOpen)

    expect(open.map((dot) => dot.string)).toEqual(['I', 'II', 'III', 'IV'])
    for (const dot of open) {
      expect(dot.x).toBe(0)
      expect(dot.finger).toBe(0)
    }
  })

  it('does not call a stopped note open', () => {
    const layout = buildFingerboardLayout({ plan: cMajorPlan })
    for (const dot of layout.dots) {
      expect(dot.isOpen).toBe(dot.semitonesAboveOpen === 0)
    }
  })

  it('leaves out an open string whose note is not in the scale', () => {
    // E flat major has an A flat where the open A string is, so the A string
    // has nothing to play open — the first thing a violist notices about it.
    const layout = buildFingerboardLayout({ scale: major('E', -1) })
    const openOnA = layout.dots.find((dot) => dot.string === 'I' && dot.semitonesAboveOpen === 0)

    expect(openOnA).toBeUndefined()
  })
})

describe('two-octave C major, the scale that needs no shift', () => {
  it('covers all four strings', () => {
    const layout = buildFingerboardLayout({ plan: cMajorPlan })
    const strings = new Set(played(layout).map((dot) => dot.string))

    expect([...strings].sort()).toEqual(['I', 'II', 'III', 'IV'])
  })

  it('uses only fingers zero to three, and never shifts', () => {
    const layout = buildFingerboardLayout({ plan: cMajorPlan })
    const fingers = new Set(played(layout).map((dot) => dot.finger))

    expect([...fingers].sort()).toEqual([0, 1, 2, 3])
    expect(cMajorPlan.shifts).toHaveLength(0)
    expect(played(layout).every((dot) => dot.position === 1)).toBe(true)
  })

  it('marks the tonic in every octave it appears', () => {
    const layout = buildFingerboardLayout({ scale: cMajor, plan: cMajorPlan })
    const tonics = played(layout).filter((dot) => dot.isTonic)

    expect(tonics.map((dot) => formatPitch(dot.pitch))).toEqual(['C5', 'C4', 'C3'])
  })

  it('marks nothing but the tonic as the tonic', () => {
    const layout = buildFingerboardLayout({ scale: cMajor, plan: cMajorPlan })
    for (const dot of layout.dots) {
      expect(dot.isTonic).toBe(dot.pitch.letter === 'C' && dot.pitch.alter === 0)
    }
  })
})

describe('two-octave G major, the scale that shifts', () => {
  it('marks a shift up to third position', () => {
    expect(gMajorPlan.shifts).toHaveLength(1)
    expect(gMajorPlan.shifts[0]?.toPosition).toBe(3)
    expect(gMajorPlan.shifts[0]?.direction).toBe('up')
  })

  it('produces at least one dot in third position', () => {
    const layout = buildFingerboardLayout({ plan: gMajorPlan })
    const third = played(layout).filter((dot) => dot.position === 3)

    expect(third.length).toBeGreaterThanOrEqual(1)
    expect(third.every((dot) => dot.string === 'I')).toBe(true)
  })

  it('puts the note the shift lands on further up the string than the note before it', () => {
    const layout = buildFingerboardLayout({ plan: gMajorPlan })
    const shift = gMajorPlan.shifts[0]
    const arrival = dotForPlanNote(layout, gMajorPlan, shift!.atIndex)
    const departure = dotForPlanNote(layout, gMajorPlan, shift!.atIndex - 1)

    expect(arrival?.x).toBeGreaterThan(departure!.x)
    expect(arrival?.position).toBe(3)
  })

  it('leaves the open A string out of third position but keeps it in the plan', () => {
    const layout = buildFingerboardLayout({ plan: gMajorPlan })
    const openA = played(layout).find((dot) => dot.string === 'I' && dot.isOpen)

    expect(openA?.finger).toBe(0)
    expect(formatPitch(openA!.pitch)).toBe('A4')
  })
})

describe('the pitch arithmetic behind every dot', () => {
  it('gives every dot a midi number matching the pitch it claims', () => {
    for (const plan of [cMajorPlan, gMajorPlan, bFlatPlan]) {
      const layout = buildFingerboardLayout({ plan })
      for (const dot of layout.dots) {
        expect(dot.midi).toBe(toMidi(dot.pitch))
      }
    }
  })

  it('places every dot exactly its own semitones above its open string', () => {
    const layout = buildFingerboardLayout({ scale: cMajor, plan: cMajorPlan })
    for (const dot of layout.dots) {
      expect(dot.midi).toBe(STRINGS[dot.string].openMidi + dot.semitonesAboveOpen)
    }
  })

  it('never places a dot below its open string', () => {
    const layout = buildFingerboardLayout({ scale: gMajor })
    for (const dot of layout.dots) {
      expect(dot.semitonesAboveOpen).toBeGreaterThanOrEqual(0)
    }
  })

  it('gives one dot per spot, even when the plan visits a spot twice', () => {
    const upAndDown = fingerScale(cMajor, { startOctave: 3, octaves: 2, direction: 'up-down' })
    const layout = buildFingerboardLayout({ plan: upAndDown })
    const keys = layout.dots.map((dot) => `${dot.string}:${dot.semitonesAboveOpen}`)

    expect(upAndDown.notes.length).toBeGreaterThan(layout.dots.length)
    expect(new Set(keys).size).toBe(keys.length)
  })
})

describe('the x axis along the string', () => {
  it('starts at zero at the nut and never runs past the end of the board', () => {
    const layout = buildFingerboardLayout({ scale: cMajor, plan: cMajorPlan })
    for (const dot of layout.dots) {
      expect(dot.x).toBeGreaterThanOrEqual(0)
      expect(dot.x).toBeLessThanOrEqual(1)
    }
    expect(layout.dots.some((dot) => dot.x === 0)).toBe(true)
  })

  it('increases monotonically with semitones above the open string', () => {
    const layout = buildFingerboardLayout({ scale: cMajor })
    const onOneString = layout.dots.filter((dot) => dot.string === 'III')

    for (let i = 1; i < onOneString.length; i += 1) {
      const previous = onOneString[i - 1]!
      const current = onOneString[i]!
      expect(current.semitonesAboveOpen).toBeGreaterThan(previous.semitonesAboveOpen)
      expect(current.x).toBeGreaterThan(previous.x)
    }
  })

  it('spaces every semitone evenly, which a real fingerboard does not', () => {
    const layout = buildFingerboardLayout({ scale: cMajor })
    for (const dot of layout.dots) {
      expect(dot.x).toBeCloseTo(dot.semitonesAboveOpen / layout.rows, 12)
    }
  })

  it('grows the board when a plan reaches past the default twelve rows', () => {
    // Two-octave B flat major climbs to B flat 5, a thirteenth semitone above
    // the open A string, and must not be clipped off the end of the diagram.
    const layout = buildFingerboardLayout({ plan: bFlatPlan })
    const top = played(layout).find((dot) => dot.midi === Math.max(...played(layout).map((d) => d.midi)))

    expect(layout.rows).toBe(13)
    expect(formatPitch(top!.pitch)).toBe('B♭5')
    expect(top?.x).toBe(1)
  })

  it('keeps the default twelve rows when nothing reaches higher', () => {
    expect(buildFingerboardLayout({ scale: cMajor }).rows).toBe(12)
    expect(buildFingerboardLayout({ plan: gMajorPlan }).rows).toBe(12)
  })
})

describe('the position markers', () => {
  it('marks first, third and fifth position, left to right', () => {
    const layout = buildFingerboardLayout({ scale: cMajor })

    expect(layout.positionMarkers.map((m) => m.position)).toEqual([1, 3, 5])
    expect(layout.positionMarkers.map((m) => m.label)).toEqual(['1st', '3rd', '5th'])
    const xs = layout.positionMarkers.map((m) => m.x)
    expect(xs).toEqual([...xs].sort((a, b) => a - b))
  })

  it('puts each marker where that position s first finger falls', () => {
    // First finger is a whole step up in 1st position, a fourth in 3rd, a
    // sixth in 5th: 2, 5 and 9 semitones from the open string.
    const layout = buildFingerboardLayout({ scale: cMajor })

    expect(layout.positionMarkers.map((m) => m.x)).toEqual([2 / 12, 5 / 12, 9 / 12])
  })

  it('lines the markers up with the notes the plan actually plays there', () => {
    const layout = buildFingerboardLayout({ plan: gMajorPlan })
    const third = layout.positionMarkers.find((m) => m.position === 3)
    const firstFingerInThird = played(layout).find((dot) => dot.position === 3 && dot.finger === 1)

    // G major shifts with the third finger, so there is no first finger in
    // third position to line up with — the marker still stands where it would be.
    expect(firstFingerInThird).toBeUndefined()
    expect(third?.x).toBe(5 / 12)
  })
})

describe('labels', () => {
  it('prints finger numbers by default', () => {
    const layout = buildFingerboardLayout({ plan: cMajorPlan })
    const labels = new Set(played(layout).map((dot) => dot.label))

    expect([...labels].sort()).toEqual(['0', '1', '2', '3'])
  })

  it('prints note names without octaves in note mode', () => {
    const layout = buildFingerboardLayout({ plan: gMajorPlan, labelMode: 'note' })
    const fSharp = played(layout).find((dot) => dot.midi === 78)

    expect(fSharp?.label).toBe('F♯')
  })

  it('prints scale degrees in degree mode, with the tonic as one', () => {
    const layout = buildFingerboardLayout({ scale: gMajor, plan: gMajorPlan, labelMode: 'degree' })
    const tonic = played(layout).find((dot) => dot.isTonic)
    const seventh = played(layout).find((dot) => dot.midi === 78)

    expect(tonic?.label).toBe('1')
    expect(seventh?.label).toBe('7')
  })

  it('changes the label without moving anything', () => {
    const geometry = (mode: 'finger' | 'note' | 'degree') =>
      buildFingerboardLayout({ scale: cMajor, plan: cMajorPlan, labelMode: mode }).dots.map(
        (dot) => [dot.string, dot.x, dot.y, dot.midi, dot.finger] as const,
      )

    expect(geometry('note')).toEqual(geometry('finger'))
    expect(geometry('degree')).toEqual(geometry('finger'))
  })

  it('falls back to the note name where a scale note has no finger to print', () => {
    const layout = buildFingerboardLayout({ scale: cMajor, labelMode: 'finger' })
    const stopped = layout.dots.filter((dot) => !dot.isOpen)

    expect(stopped.length).toBeGreaterThan(0)
    expect(stopped.every((dot) => dot.label === formatPitch(dot.pitch, { octave: false }))).toBe(
      true,
    )
  })
})

describe('a scale without a plan', () => {
  it('shows every place a scale note can be played, with no finger chosen', () => {
    const layout = buildFingerboardLayout({ scale: cMajor })
    const stopped = layout.dots.filter((dot) => !dot.isOpen)

    expect(stopped.length).toBeGreaterThan(0)
    for (const dot of stopped) {
      expect(dot.finger).toBeNull()
      expect(dot.position).toBeNull()
      expect(dot.inPlan).toBe(false)
      expect(dot.noteIndex).toBeNull()
    }
  })

  it('shows only scale notes', () => {
    const layout = buildFingerboardLayout({ scale: gMajor })
    const pitchClasses = new Set(layout.dots.map((dot) => dot.midi % 12))

    // G major: G A B C D E F sharp.
    expect([...pitchClasses].sort((a, b) => a - b)).toEqual([0, 2, 4, 6, 7, 9, 11])
  })

  it('keeps the places the plan does not use as unplayed context', () => {
    const layout = buildFingerboardLayout({ scale: cMajor, plan: cMajorPlan })
    const ghosts = layout.dots.filter((dot) => !dot.inPlan)

    // C4 is played with the third finger on string III, but it also lives an
    // octave above the open C string, and the diagram still shows it there.
    const otherC4 = ghosts.find((dot) => dot.midi === 60 && dot.string === 'IV')
    expect(otherC4).toBeDefined()
    expect(otherC4?.finger).toBeNull()
    expect(ghosts.length).toBeGreaterThan(0)
  })
})

describe('finding the dot for a note of the plan', () => {
  it('finds the dot the plan plays at that index', () => {
    const layout = buildFingerboardLayout({ scale: cMajor, plan: cMajorPlan })
    const dot = dotForPlanNote(layout, cMajorPlan, 0)

    expect(dot?.string).toBe('IV')
    expect(dot?.isOpen).toBe(true)
    expect(formatPitch(dot!.pitch)).toBe('C3')
  })

  it('finds the second visit to a spot as surely as the first', () => {
    const upAndDown = fingerScale(cMajor, { startOctave: 3, octaves: 2, direction: 'up-down' })
    const layout = buildFingerboardLayout({ plan: upAndDown })
    const last = upAndDown.notes.length - 1

    expect(dotForPlanNote(layout, upAndDown, last)).toBe(dotForPlanNote(layout, upAndDown, 0))
  })

  it('returns null for an index outside the plan', () => {
    const layout = buildFingerboardLayout({ plan: cMajorPlan })

    expect(dotForPlanNote(layout, cMajorPlan, -1)).toBeNull()
    expect(dotForPlanNote(layout, cMajorPlan, 999)).toBeNull()
  })
})

describe('an empty diagram', () => {
  it('returns strings and markers but no dots, and does not throw', () => {
    const layout = buildFingerboardLayout({})

    expect(layout.dots).toEqual([])
    expect(layout.strings).toHaveLength(4)
    expect(layout.positionMarkers).toHaveLength(3)
    expect(layout.rows).toBe(12)
  })
})

describe('the summary a screen reader hears', () => {
  it('says two-octave C major stays in first position across all four strings', () => {
    expect(describeFingerboard({ scale: cMajor, plan: cMajorPlan })).toBe(
      'C major, two octaves from C3, entirely in first position, using all four strings.',
    )
  })

  it('says where two-octave G major shifts, and which strings it uses', () => {
    expect(describeFingerboard({ scale: gMajor, plan: gMajorPlan })).toBe(
      'G major, two octaves from G3, with one shift up to 3rd position on F sharp 5, ' +
        'using the G, D and A strings.',
    )
  })

  it('spells accidentals in words rather than symbols', () => {
    const summary = describeFingerboard({ scale: bFlatMajor, plan: bFlatPlan })

    expect(summary).toContain('B flat major')
    expect(summary).toContain('two octaves from B flat 3')
    expect(summary).not.toContain('♭')
  })

  it('describes a scale with no fingering chosen yet', () => {
    const summary = describeFingerboard({ scale: cMajor })

    expect(summary).toContain('C major')
    expect(summary).toContain('No fingering chosen yet.')
  })

  it('describes an empty fingerboard without pretending there is a scale', () => {
    expect(describeFingerboard({})).toBe(
      'An empty viola fingerboard, tuned in fifths: C, G, D and A. No scale chosen yet.',
    )
  })
})
