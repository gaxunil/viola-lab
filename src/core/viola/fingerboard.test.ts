import { describe, expect, it } from 'vitest'
import { formatPitch, p, toMidi } from '../pitch/pitch'
import { STRINGS, isInRange } from './strings'
import {
  diatonicOffsetFor,
  isPlayable,
  pitchAt,
  placementsFor,
  positionName,
  positionOf,
} from './fingerboard'

describe('the strings', () => {
  it('is tuned C G D A, low to high, numbered from the top', () => {
    expect(formatPitch(STRINGS.IV.open)).toBe('C3')
    expect(formatPitch(STRINGS.III.open)).toBe('G3')
    expect(formatPitch(STRINGS.II.open)).toBe('D4')
    expect(formatPitch(STRINGS.I.open)).toBe('A4')
    expect([STRINGS.I, STRINGS.II, STRINGS.III, STRINGS.IV].map((s) => s.index)).toEqual([0, 1, 2, 3])
  })

  it('is tuned in fifths', () => {
    expect(STRINGS.III.openMidi - STRINGS.IV.openMidi).toBe(7)
    expect(STRINGS.II.openMidi - STRINGS.III.openMidi).toBe(7)
    expect(STRINGS.I.openMidi - STRINGS.II.openMidi).toBe(7)
  })

  it('knows nothing exists below the open C', () => {
    expect(isInRange(p('C3'))).toBe(true)
    expect(isInRange(p('Bb2'))).toBe(false)
  })
})

/**
 * The formula this whole module rests on, pinned against the literal first
 * position map. Getting it off by one silently poisons every fingering in the
 * app, so it is checked note by note rather than in the abstract.
 */
describe('first position, note by note', () => {
  const MAP: Array<[keyof typeof STRINGS, Array<[number, string]>]> = [
    ['IV', [[0, 'C3'], [1, 'D3'], [2, 'E3'], [3, 'F3'], [4, 'G3']]],
    ['III', [[0, 'G3'], [1, 'A3'], [2, 'B3'], [3, 'C4'], [4, 'D4']]],
    ['II', [[0, 'D4'], [1, 'E4'], [2, 'F#4'], [3, 'G4'], [4, 'A4']]],
    ['I', [[0, 'A4'], [1, 'B4'], [2, 'C#5'], [3, 'D5'], [4, 'E5']]],
  ]

  it('places every neutral finger where a player would put it', () => {
    for (const [stringId, fingers] of MAP) {
      for (const [finger, expected] of fingers) {
        const got = pitchAt(STRINGS[stringId], 1, finger as 0 | 1 | 2 | 3 | 4)
        expect(formatPitch(got, { style: 'ascii' })).toBe(expected)
      }
    }
  })

  it('reaches the low second finger a semitone below neutral', () => {
    // E flat on the C string, F natural on the D string — the "low 2".
    expect(formatPitch(pitchAt(STRINGS.IV, 1, 2, -1))).toBe('E♭3')
    expect(formatPitch(pitchAt(STRINGS.II, 1, 2, -1))).toBe('F4')
    expect(formatPitch(pitchAt(STRINGS.I, 1, 2, -1))).toBe('C5')
  })

  it('uses the diatonic formula position + finger - 1', () => {
    expect(diatonicOffsetFor(1, 1)).toBe(1) // 1st finger in 1st position is ONE letter up
    expect(diatonicOffsetFor(1, 4)).toBe(4)
    expect(diatonicOffsetFor(3, 1)).toBe(3) // 1st finger in 3rd position is THREE letters up
    expect(diatonicOffsetFor(1, 0)).toBe(0) // an open string is the open string
    expect(diatonicOffsetFor(5, 0)).toBe(0)
  })

  it('puts the first finger of 3rd position on G, on the D string', () => {
    expect(formatPitch(pitchAt(STRINGS.II, 3, 1))).toBe('G4')
    expect(positionOf(STRINGS.II, p('G4'), 1)).toBe(3)
  })
})

describe('placementsFor', () => {
  it('offers the open string and a stopped alternative for the same note', () => {
    const places = placementsFor(p('D4'))
    expect(places.some((x) => x.isOpen && x.string === 'II')).toBe(true)
    expect(places.some((x) => x.string === 'III' && x.finger === 4)).toBe(true)
  })

  it('gives a note on every string that can reach it', () => {
    // A4 is the open I string, and also reachable on II, III and IV.
    const strings = new Set(placementsFor(p('A4'), { maxPosition: 7 }).map((x) => x.string))
    expect(strings.has('I')).toBe(true)
    expect(strings.has('II')).toBe(true)
  })

  it('never offers a string the note is below', () => {
    expect(placementsFor(p('C3')).every((x) => x.string === 'IV')).toBe(true)
    expect(placementsFor(p('E3')).every((x) => x.string === 'IV')).toBe(true)
  })

  it('returns nothing for a note the instrument does not have', () => {
    expect(placementsFor(p('Bb2'))).toEqual([])
    expect(isPlayable(p('Bb2'))).toBe(false)
    expect(isPlayable(p('C3'))).toBe(true)
  })

  it('marks how far each finger sits from neutral', () => {
    // E flat 3 on the C string is a low second finger.
    const low = placementsFor(p('Eb3')).find((x) => x.finger === 2)
    expect(low?.stretch).toBe(-1)

    const neutral = placementsFor(p('E3')).find((x) => x.finger === 2)
    expect(neutral?.stretch).toBe(0)
  })

  it('respects a position ceiling', () => {
    const low = placementsFor(p('G5'), { maxPosition: 1 })
    expect(low).toEqual([])
    const higher = placementsFor(p('G5'), { maxPosition: 5 })
    expect(higher.length).toBeGreaterThan(0)
    expect(Math.min(...higher.map((x) => x.position))).toBe(3)
  })

  it('can be restricted to particular strings', () => {
    const onA = placementsFor(p('D5'), { allowedStrings: ['I'] })
    expect(onA.every((x) => x.string === 'I')).toBe(true)
  })

  it('always reports a placement whose pitch actually sounds right', () => {
    // Sweep the whole practical range: every placement offered for a note must
    // sound that note, on the string and at the position it claims.
    for (const name of ['C3', 'Eb3', 'G3', 'B3', 'D4', 'F#4', 'A4', 'C5', 'E5', 'G5', 'A5']) {
      const target = p(name)
      const places = placementsFor(target, { maxPosition: 7 })
      expect(places.length).toBeGreaterThan(0)
      for (const place of places) {
        expect(toMidi(place.pitch)).toBe(toMidi(target))
        const string = STRINGS[place.string]
        expect(place.semitonesAboveOpen).toBe(toMidi(target) - string.openMidi)
        // The claimed position and finger must reproduce the note.
        if (!place.isOpen) {
          expect(toMidi(pitchAt(string, place.position, place.finger, place.stretch))).toBe(
            toMidi(target),
          )
        }
      }
    }
  })
})

describe('position names', () => {
  it('reads the way a teacher says it', () => {
    expect(positionName(1)).toBe('1st position')
    expect(positionName(3)).toBe('3rd position')
    expect(positionName(0.5)).toBe('half position')
  })
})
