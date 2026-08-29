import { describe, expect, it } from 'vitest'
import { formatPitch, pc, toMidi } from '../pitch/pitch'
import { SCALE_TYPES, SCALE_TYPE_LIST } from './scaleTypes'
import { CIRCLE_OF_FIFTHS } from '../key/key'
import {
  buildScale,
  degreeOf,
  isScaleSpellable,
  realize,
  scaleContains,
  scaleRange,
  tryBuildScale,
} from './scale'

const names = (ps: ReturnType<typeof realize>) => ps.map((x) => formatPitch(x, { style: 'ascii' }))
const spell = (s: ReturnType<typeof buildScale>) => s.degrees.map((d) => formatPitch(d.pitchClass))
const pattern = (s: ReturnType<typeof buildScale>) => s.steps.map((x) => x.display)

describe('the whole/half step pattern', () => {
  it('gives the major scale W-W-H-W-W-W-H', () => {
    expect(pattern(buildScale(pc('C'), SCALE_TYPES.major))).toEqual([
      'W', 'W', 'H', 'W', 'W', 'W', 'H',
    ])
  })

  it('gives natural minor W-H-W-W-H-W-W', () => {
    expect(pattern(buildScale(pc('A'), SCALE_TYPES['natural-minor']))).toEqual([
      'W', 'H', 'W', 'W', 'H', 'W', 'W',
    ])
  })

  // The case that must not be flattened into a W/H binary.
  it('shows harmonic minor with an honest augmented 2nd', () => {
    const scale = buildScale(pc('A'), SCALE_TYPES['harmonic-minor'])
    expect(pattern(scale)).toEqual(['W', 'H', 'W', 'W', 'H', '1½', 'H'])

    const augmented = scale.steps[5]
    expect(augmented).toMatchObject({
      fromDegree: 6,
      toDegree: 7,
      semitones: 3,
      symbol: 'A2',
      display: '1½',
      name: 'augmented 2nd',
      isAugmented: true,
    })
    // Three semitones, but only ONE letter step — that is what makes it an
    // augmented second rather than a minor third.
    expect(augmented?.interval).toEqual({ diatonic: 1, chromatic: 3 })
  })

  it('marks only the augmented step as augmented', () => {
    const scale = buildScale(pc('A'), SCALE_TYPES['harmonic-minor'])
    expect(scale.steps.filter((s) => s.isAugmented)).toHaveLength(1)
  })

  it('differs ascending and descending for melodic minor', () => {
    const scale = buildScale(pc('A'), SCALE_TYPES['melodic-minor'])
    expect(pattern(scale)).toEqual(['W', 'H', 'W', 'W', 'W', 'W', 'H'])
    expect(scale.descendingSteps.map((s) => s.display)).toEqual([
      'W', 'H', 'W', 'W', 'H', 'W', 'W',
    ])
    expect(scale.isAsymmetric).toBe(true)
  })

  it('gives whole tone nothing but whole steps', () => {
    expect(pattern(buildScale(pc('C'), SCALE_TYPES['whole-tone']))).toEqual([
      'W', 'W', 'W', 'W', 'W', 'W',
    ])
  })

  it('gives chromatic nothing but half steps', () => {
    const scale = buildScale(pc('C'), SCALE_TYPES.chromatic)
    expect(pattern(scale)).toEqual(Array.from({ length: 12 }, () => 'H'))
  })

  it('derives every mode as a rotation of the major pattern', () => {
    const major = [2, 2, 1, 2, 2, 2, 1]
    for (const type of SCALE_TYPE_LIST) {
      if (type.modeRotation === undefined) continue
      const rotated = [...major.slice(type.modeRotation), ...major.slice(0, type.modeRotation)]
      expect(buildScale(pc('C'), type).steps.map((s) => s.semitones)).toEqual(rotated)
    }
  })

  it('always has one step per degree, closing the octave', () => {
    for (const type of SCALE_TYPE_LIST) {
      const scale = buildScale(pc('D'), type)
      expect(scale.steps).toHaveLength(scale.degrees.length)
      const total = scale.steps.reduce((sum, s) => sum + s.semitones, 0)
      expect(total).toBe(12)
    }
  })
})

describe('spelling', () => {
  it('spells E flat major with flats', () => {
    expect(spell(buildScale(pc('E', -1), SCALE_TYPES.major))).toEqual([
      'E♭', 'F', 'G', 'A♭', 'B♭', 'C', 'D',
    ])
  })

  it('spells F sharp major with an E sharp', () => {
    expect(spell(buildScale(pc('F', 1), SCALE_TYPES.major))[6]).toBe('E♯')
  })

  it('spells G sharp harmonic minor with an F double sharp', () => {
    const scale = buildScale(pc('G', 1), SCALE_TYPES['harmonic-minor'])
    const seventh = scale.degrees[6]
    expect(formatPitch(seventh!.pitchClass, { style: 'ascii' })).toBe('F##')
  })

  it('labels altered degrees against the parallel major', () => {
    const harmonic = buildScale(pc('A'), SCALE_TYPES['harmonic-minor'])
    expect(harmonic.degrees.map((d) => d.label)).toEqual(['1', '2', '♭3', '4', '5', '♭6', '7'])

    const lydian = buildScale(pc('C'), SCALE_TYPES.lydian)
    expect(lydian.degrees.map((d) => d.label)).toEqual(['1', '2', '3', '♯4', '5', '6', '7'])
  })

  it('names scales readably', () => {
    expect(buildScale(pc('E', -1), SCALE_TYPES.major).name).toBe('E♭ major')
    expect(buildScale(pc('A'), SCALE_TYPES['harmonic-minor']).name).toBe('A harmonic minor')
  })

  it('notates a mode with its parent major signature', () => {
    // D dorian is the white notes, so it reads in C major — no accidentals.
    expect(buildScale(pc('D'), SCALE_TYPES.dorian).key.signature.fifths).toBe(0)
    // G mixolydian also comes from C major.
    expect(buildScale(pc('G'), SCALE_TYPES.mixolydian).key.signature.fifths).toBe(0)
  })
})

describe('realize', () => {
  it('plays two octaves root to root', () => {
    const run = realize(buildScale(pc('C'), SCALE_TYPES.major), { startOctave: 3, octaves: 2 })
    expect(run).toHaveLength(15)
    expect(names(run)).toEqual([
      'C3', 'D3', 'E3', 'F3', 'G3', 'A3', 'B3',
      'C4', 'D4', 'E4', 'F4', 'G4', 'A4', 'B4', 'C5',
    ])
  })

  // The single highest-value scale test in the suite.
  it('reverts the sixth and seventh coming down in melodic minor', () => {
    const run = realize(buildScale(pc('A'), SCALE_TYPES['melodic-minor']), {
      startOctave: 3,
      octaves: 1,
      direction: 'up-down',
    })
    expect(names(run)).toEqual([
      'A3', 'B3', 'C4', 'D4', 'E4', 'F#4', 'G#4', 'A4',
      'G4', 'F4', 'E4', 'D4', 'C4', 'B3', 'A3',
    ])
  })

  it('does not repeat the top note at the turnaround by default', () => {
    const scale = buildScale(pc('C'), SCALE_TYPES.major)
    const plain = realize(scale, { startOctave: 4, octaves: 1, direction: 'up-down' })
    const repeated = realize(scale, {
      startOctave: 4,
      octaves: 1,
      direction: 'up-down',
      repeatTop: true,
    })
    expect(plain).toHaveLength(15)
    expect(repeated).toHaveLength(16)
    expect(names(repeated).slice(7, 9)).toEqual(['C5', 'C5'])
  })

  it('descends from the top tonic', () => {
    const run = realize(buildScale(pc('C'), SCALE_TYPES.major), {
      startOctave: 4,
      octaves: 1,
      direction: 'down',
    })
    expect(names(run)).toEqual(['C5', 'B4', 'A4', 'G4', 'F4', 'E4', 'D4', 'C4'])
  })

  it('spans exactly two octaves of sound', () => {
    const run = realize(buildScale(pc('D'), SCALE_TYPES.major), { startOctave: 3, octaves: 2 })
    const { low, high } = scaleRange(run)
    expect(toMidi(high) - toMidi(low)).toBe(24)
    expect(formatPitch(low)).toBe('D3')
    expect(formatPitch(high)).toBe('D5')
  })

  it('realizes every catalogue entry on every real key root', () => {
    for (const type of SCALE_TYPE_LIST) {
      for (const entry of CIRCLE_OF_FIFTHS) {
        for (const tonic of [entry.major.tonic, entry.minor.tonic]) {
          const scale = tryBuildScale(tonic, type)
          if (scale === null) continue // unwritable root, filtered by the UI
          const run = realize(scale, { startOctave: 3, octaves: 2, direction: 'up-down' })
          expect(run.length).toBeGreaterThan(0)
        }
      }
    }
  })

  it('reports the handful of roots that cannot be spelled, rather than throwing at the UI', () => {
    // A chromatic run from B sharp would need triple sharps. These are not real
    // choices, so the picker filters them out.
    expect(tryBuildScale(pc('B', 1), SCALE_TYPES.chromatic)).toBeNull()
    expect(tryBuildScale(pc('E', 1), SCALE_TYPES['whole-tone'])).toBeNull()
    expect(isScaleSpellable(pc('B', 1), SCALE_TYPES.chromatic)).toBe(false)

    // Everything a player would actually be handed is spellable.
    expect(isScaleSpellable(pc('E', -1), SCALE_TYPES.major)).toBe(true)
    expect(isScaleSpellable(pc('G', 1), SCALE_TYPES['harmonic-minor'])).toBe(true)
  })

})

describe('membership', () => {
  it('knows which notes belong', () => {
    const scale = buildScale(pc('C'), SCALE_TYPES.major)
    expect(scaleContains(scale, { letter: 'E', alter: 0, octave: 4 })).toBe(true)
    expect(scaleContains(scale, { letter: 'F', alter: 1, octave: 4 })).toBe(false)
    expect(degreeOf(scale, { letter: 'G', alter: 0, octave: 4 })).toBe(5)
    expect(degreeOf(scale, { letter: 'F', alter: 1, octave: 4 })).toBeNull()
  })
})
