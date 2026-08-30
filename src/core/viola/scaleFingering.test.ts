import { describe, expect, it } from 'vitest'
import { formatPitch, p, pc } from '../pitch/pitch'
import { SCALE_TYPES } from '../scale/scaleTypes'
import { buildScale } from '../scale/scale'
import { fingerNotes } from './fingering'
import { bestRange, fingerScale, maxOctaves, rangeOptions } from './scaleFingering'

const major = (letter: Parameters<typeof pc>[0], alter: -1 | 0 | 1 = 0) =>
  buildScale(pc(letter, alter), SCALE_TYPES.major)

describe('the scales that sit in first position', () => {
  it('plays two-octave C major across all four strings without shifting', () => {
    const plan = fingerScale(major('C'), { startOctave: 3, octaves: 2 })
    expect(plan.complete).toBe(true)
    expect(plan.staysInFirstPosition).toBe(true)
    expect(plan.shifts).toHaveLength(0)
    expect(plan.highestPosition).toBe(1)
    expect(plan.stringsUsed).toEqual(['IV', 'III', 'II', 'I'])
  })

  it('plays two-octave D major without shifting either', () => {
    const plan = fingerScale(major('D'), { startOctave: 3, octaves: 2 })
    expect(plan.complete).toBe(true)
    expect(plan.staysInFirstPosition).toBe(true)
    expect(plan.shifts).toHaveLength(0)
  })
})

describe('the scales that need a shift', () => {
  it('makes two-octave G major shift up to third position', () => {
    const plan = fingerScale(major('G'), { startOctave: 3, octaves: 2 })
    expect(plan.complete).toBe(true)
    expect(plan.staysInFirstPosition).toBe(false)
    expect(plan.shifts.length).toBeGreaterThanOrEqual(1)
    expect(plan.highestPosition).toBe(3)

    const shift = plan.shifts[0]
    expect(shift?.direction).toBe('up')
    expect(shift?.toPosition).toBe(3)
    expect(shift?.label).toBe('shift to 3rd position')
    // The top of the run is on the A string.
    expect(shift?.string).toBe('I')
  })

  it('names the note the shift happens on', () => {
    const plan = fingerScale(major('G'), { startOctave: 3, octaves: 2 })
    const shift = plan.shifts[0]
    expect(shift).toBeDefined()
    const arrivedAt = plan.notes[shift!.atIndex]
    expect(arrivedAt).toBeDefined()
    expect(arrivedAt!.shiftIntoThisNote).not.toBeNull()
  })
})

describe('the range problem the app exists to surface', () => {
  it('refuses two-octave B flat major from B flat 2, and says why', () => {
    const options = rangeOptions(major('B', -1), 2)
    const fromBFlat2 = options.find((r) => formatPitch(r.start) === 'B♭2')

    expect(fromBFlat2).toBeDefined()
    expect(fromBFlat2!.feasible).toBe(false)
    expect(fromBFlat2!.reason).toMatch(/below the open C string/)
  })

  it('suggests starting B flat major an octave higher instead', () => {
    const best = bestRange(major('B', -1), 2)
    expect(best).not.toBeNull()
    expect(formatPitch(best!.start)).toBe('B♭3')
    expect(best!.feasible).toBe(true)
  })

  it('prefers a shift-free option when one exists', () => {
    const best = bestRange(major('C'), 2)
    expect(formatPitch(best!.start)).toBe('C3')
    expect(best!.staysInFirstPosition).toBe(true)
    expect(best!.shifts).toBe(0)
  })

  it('reports how many octaves actually fit', () => {
    expect(maxOctaves(major('C'))).toBeGreaterThanOrEqual(2)
    expect(maxOctaves(major('B', -1))).toBeGreaterThanOrEqual(2)
  })

  it('never claims a run is feasible when it leaves the instrument', () => {
    for (const option of rangeOptions(major('C'), 3)) {
      if (!option.feasible) {
        expect(option.reason).toBeTruthy()
      }
    }
  })
})

describe('open strings do not establish a position', () => {
  // The non-Markovian subtlety. Playing an open string between two stopped notes
  // must not reset the hand, or the plan reports a shift that never happened.
  it('does not invent a shift around an open string', () => {
    // D4 (open II) sits between two notes comfortably in third position.
    const plan = fingerNotes([p('G4'), p('D4'), p('A4')], { maxPosition: 5 })
    expect(plan.complete).toBe(true)

    const openNotes = plan.notes.filter((n) => n.placement.isOpen)
    for (const openNote of openNotes) {
      expect(openNote.shiftIntoThisNote).toBeNull()
    }
  })

  it('finds a fingering for a run that mixes open and stopped notes', () => {
    const plan = fingerNotes([p('C3'), p('G3'), p('D4'), p('A4')], {})
    expect(plan.complete).toBe(true)
    expect(plan.notes.every((n) => n.placement.isOpen)).toBe(true)
    expect(plan.shifts).toHaveLength(0)
  })
})

describe('plans are internally consistent', () => {
  it('assigns exactly one placement per note, sounding the right pitch', () => {
    const plan = fingerScale(major('E', -1), { startOctave: 3, octaves: 2 })
    const pitches = plan.notes.map((n) => n.pitch)
    expect(plan.notes).toHaveLength(pitches.length)
    for (const n of plan.notes) {
      expect(n.placement.pitch).toEqual(n.pitch)
    }
  })

  it('fingers every major key that fits, without throwing', () => {
    const roots: Array<[Parameters<typeof pc>[0], -1 | 0 | 1]> = [
      ['C', 0], ['G', 0], ['D', 0], ['A', 0], ['E', 0],
      ['F', 0], ['B', -1], ['E', -1], ['A', -1],
    ]
    for (const [letter, alter] of roots) {
      const scale = buildScale(pc(letter, alter), SCALE_TYPES.major)
      const best = bestRange(scale, 2)
      expect(best, `${scale.name} has no playable two-octave range`).not.toBeNull()
      expect(best!.feasible).toBe(true)
    }
  })

  it('reports higher positions for higher scales rather than failing', () => {
    const plan = fingerScale(major('A'), { startOctave: 3, octaves: 2, maxPosition: 7 })
    expect(plan.complete).toBe(true)
    expect(plan.highestPosition).toBeGreaterThan(1)
  })
})

describe('three octaves', () => {
  // Standard audition material for a player at this level, and the reason the
  // practical ceiling is A6 rather than something tidier.
  it('fits three octaves of C major, but only well above first position', () => {
    const best = bestRange(major('C'), 3, { maxPosition: 12 })
    expect(best).not.toBeNull()
    expect(formatPitch(best!.start)).toBe('C3')
    expect(formatPitch(best!.end)).toBe('C6')
    expect(best!.requiresPosition).toBeGreaterThan(4)
  })

  it('needs more of the fingerboard the higher the key starts', () => {
    const c = bestRange(major('C'), 3, { maxPosition: 12 })
    const a = bestRange(major('A'), 3, { maxPosition: 12 })
    expect(c).not.toBeNull()
    expect(a).not.toBeNull()
    expect(a!.requiresPosition).toBeGreaterThan(c!.requiresPosition)
  })

  it('refuses three octaves that run off the top of the instrument', () => {
    // B flat major over three octaves would need B flat 6, past where a viola
    // reaches and past where the sample set ends.
    expect(bestRange(major('B', -1), 3, { maxPosition: 12 })).toBeNull()
  })

  it('will not pretend three octaves fit inside first position', () => {
    // The default position ceiling is deliberately low; three octaves must fail
    // against it rather than inventing an unplayable fingering.
    expect(bestRange(major('A'), 3, { maxPosition: 5 })).toBeNull()
  })

  it('still fits two octaves of B flat, which three cannot', () => {
    expect(bestRange(major('B', -1), 2)).not.toBeNull()
  })
})
