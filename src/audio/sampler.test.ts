import { describe, expect, it } from 'vitest'
import { pickZone, modeFor } from './sampler'
import type { InstrumentManifest } from './loader'

const manifest = (zones: number[]): InstrumentManifest => ({
  name: 'test',
  formats: ['m4a'],
  zones: zones.map((midi) => ({ midi, pitch: `n${midi}`, file: `n${midi}.m4a` })),
  lowestMidi: Math.min(...zones),
  highestMidi: Math.max(...zones),
  maxShiftSemitones: 0,
  releaseSec: 0.15,
  attackSec: 0.008,
})

describe('pickZone with a fully chromatic set', () => {
  // The shipped manifest is chromatic C3-A6 with maxShift 0, which is why the
  // app never pitch-shifts a bowed sample at all.
  const chromatic = Array.from({ length: 46 }, (_, i) => 48 + i)

  it('finds an exact sample for every note in range', () => {
    for (const midi of chromatic) {
      expect(pickZone(chromatic, midi, 0)).toEqual({ midi, shiftSemitones: 0 })
    }
  })

  it('refuses anything outside the range rather than stretching', () => {
    expect(pickZone(chromatic, 47, 0)).toBeNull()
    expect(pickZone(chromatic, 94, 0)).toBeNull()
  })
})

describe('pickZone with a sparse set', () => {
  // The machinery still has to work if a smaller set is ever substituted.
  const everyMinorThird = [48, 51, 54, 57, 60, 63, 66]

  it('takes the nearest sample and reports the shift', () => {
    expect(pickZone(everyMinorThird, 60, 3)).toEqual({ midi: 60, shiftSemitones: 0 })
    expect(pickZone(everyMinorThird, 61, 3)).toEqual({ midi: 60, shiftSemitones: 1 })
    expect(pickZone(everyMinorThird, 62, 3)).toEqual({ midi: 63, shiftSemitones: -1 })
  })

  it('breaks a tie downward, because shifting up thins a bowed tone', () => {
    // 61.5 is not a note, but 49 and 50 sit either side of 48 and 51 equally.
    const pair = [48, 52]
    expect(pickZone(pair, 50, 2)).toEqual({ midi: 48, shiftSemitones: 2 })
  })

  it('returns null when the nearest sample is further than allowed', () => {
    expect(pickZone(everyMinorThird, 80, 3)).toBeNull()
  })

  it('never exceeds the shift limit for any note across the range', () => {
    for (let midi = 48; midi <= 66; midi++) {
      const choice = pickZone(everyMinorThird, midi, 2)
      if (choice) expect(Math.abs(choice.shiftSemitones)).toBeLessThanOrEqual(2)
    }
  })
})

describe('modeFor', () => {
  it('reports synth when nothing loaded, so the UI can say so', () => {
    expect(modeFor(manifest([48, 49, 50]), 0)).toBe('synth')
  })

  it('reports partial while the set is still arriving', () => {
    expect(modeFor(manifest([48, 49, 50]), 2)).toBe('partial')
  })

  it('reports sampled once every zone is in memory', () => {
    expect(modeFor(manifest([48, 49, 50]), 3)).toBe('sampled')
  })
})
