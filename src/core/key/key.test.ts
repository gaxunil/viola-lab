import { describe, expect, it } from 'vitest'
import { formatPitch, pc, pitchClassNumber } from '../pitch/pitch'
import {
  CIRCLE_OF_FIFTHS,
  diatonicPitchClasses,
  dominantKey,
  fifthsOf,
  keyOf,
  keySignatureForFifths,
  majorKeyAtFifths,
  minorKeyAtFifths,
  parallelKey,
  relativeMajor,
  relativeMinor,
  signatureAlteration,
  spellPitchClassInKey,
  subdominantKey,
} from './key'

const major = (s: string) => {
  const r = keyOf(pc(s[0] as never, s.length > 1 ? (s[1] === '#' ? 1 : -1) : 0), 'major')
  if (!r.ok) throw new Error(`${s} major is theoretical`)
  return r.key
}

describe('key signatures', () => {
  it('writes sharps in the order F C G D A E B', () => {
    expect(keySignatureForFifths(1).letters).toEqual(['F'])
    expect(keySignatureForFifths(4).letters).toEqual(['F', 'C', 'G', 'D'])
    expect(keySignatureForFifths(7).letters).toEqual(['F', 'C', 'G', 'D', 'A', 'E', 'B'])
  })

  it('writes flats in the reverse order B E A D G C F', () => {
    expect(keySignatureForFifths(-1).letters).toEqual(['B'])
    expect(keySignatureForFifths(-3).letters).toEqual(['B', 'E', 'A'])
    expect(keySignatureForFifths(-7).letters).toEqual(['B', 'E', 'A', 'D', 'G', 'C', 'F'])
  })

  it('has no accidentals at the top of the circle', () => {
    expect(keySignatureForFifths(0)).toEqual({ fifths: 0, accidental: 'none', letters: [] })
  })

  it('refuses signatures beyond seven accidentals', () => {
    expect(() => keySignatureForFifths(8)).toThrow(RangeError)
    expect(() => keySignatureForFifths(-8)).toThrow(RangeError)
  })
})

describe('locating keys on the circle', () => {
  it('places the common major keys correctly', () => {
    expect(fifthsOf(pc('C'), 'major')).toBe(0)
    expect(fifthsOf(pc('G'), 'major')).toBe(1)
    expect(fifthsOf(pc('D'), 'major')).toBe(2)
    expect(fifthsOf(pc('F'), 'major')).toBe(-1)
    expect(fifthsOf(pc('B', -1), 'major')).toBe(-2)
    expect(fifthsOf(pc('E', -1), 'major')).toBe(-3) // three flats — the app's example
    expect(fifthsOf(pc('F', 1), 'major')).toBe(6)
  })

  it('places minor keys three fifths below their letter', () => {
    expect(fifthsOf(pc('A'), 'minor')).toBe(0)
    expect(fifthsOf(pc('E'), 'minor')).toBe(1)
    expect(fifthsOf(pc('C'), 'minor')).toBe(-3)
    expect(fifthsOf(pc('G'), 'minor')).toBe(-2)
  })

  it('names keys with their real spelling', () => {
    expect(majorKeyAtFifths(-3).name).toBe('E♭ major')
    expect(majorKeyAtFifths(-2).name).toBe('B♭ major')
    expect(majorKeyAtFifths(6).name).toBe('F♯ major')
    expect(minorKeyAtFifths(0).name).toBe('A minor')
    expect(minorKeyAtFifths(-3).name).toBe('C minor')
  })

  it('covers exactly fifteen key signatures', () => {
    expect(CIRCLE_OF_FIFTHS).toHaveLength(15)
    expect(CIRCLE_OF_FIFTHS[0]?.major.name).toBe('C♭ major')
    expect(CIRCLE_OF_FIFTHS[14]?.major.name).toBe('C♯ major')
  })
})

describe('theoretical keys are refused, not rendered', () => {
  it('offers B flat major instead of A sharp major', () => {
    const result = keyOf(pc('A', 1), 'major')
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.reason).toBe('theoretical')
    expect(result.wouldNeedFifths).toBe(10)
    expect(result.suggestion.name).toBe('B♭ major')
  })

  it('offers D flat major instead of C sharp... which is real, so accepts it', () => {
    // C sharp major is seven sharps — unusual but entirely writable.
    const result = keyOf(pc('C', 1), 'major')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.key.signature.fifths).toBe(7)
  })

  it('accepts every key on the real circle', () => {
    for (const entry of CIRCLE_OF_FIFTHS) {
      expect(keyOf(entry.major.tonic, 'major').ok).toBe(true)
      expect(keyOf(entry.minor.tonic, 'minor').ok).toBe(true)
    }
  })
})

describe('relationships', () => {
  it('pairs relative major and minor on the same signature', () => {
    expect(relativeMinor(major('Eb')).name).toBe('C minor')
    expect(relativeMinor(major('C')).name).toBe('A minor')
    expect(relativeMajor(minorKeyAtFifths(-3)).name).toBe('E♭ major')

    // The defining property: same signature, different tonic.
    const eFlat = major('Eb')
    expect(relativeMinor(eFlat).signature.fifths).toBe(eFlat.signature.fifths)
  })

  it('moves between parallel keys by three fifths', () => {
    expect(parallelKey(major('C')).name).toBe('C minor')
    expect(parallelKey(parallelKey(major('C'))).name).toBe('C major')
    expect(parallelKey(major('C')).signature.fifths).toBe(-3)
  })

  it('walks the circle by fifths', () => {
    expect(dominantKey(major('C')).name).toBe('G major')
    expect(subdominantKey(major('C')).name).toBe('F major')
  })
})

describe('spelling in context — replacing the flats boolean', () => {
  it('spells E flat major with flats, never sharps', () => {
    const key = major('Eb')
    expect(diatonicPitchClasses(key).map((k) => formatPitch(k))).toEqual([
      'E♭',
      'F',
      'G',
      'A♭',
      'B♭',
      'C',
      'D',
    ])
  })

  it('spells F sharp major with E sharp, not F natural', () => {
    const key = major('F#')
    expect(diatonicPitchClasses(key).map((k) => formatPitch(k))).toEqual([
      'F♯',
      'G♯',
      'A♯',
      'B',
      'C♯',
      'D♯',
      'E♯',
    ])
  })

  it('spells minor keys from their own tonic', () => {
    expect(diatonicPitchClasses(minorKeyAtFifths(-3)).map((k) => formatPitch(k))).toEqual([
      'C',
      'D',
      'E♭',
      'F',
      'G',
      'A♭',
      'B♭',
    ])
  })

  it('spells the same sounding pitch differently in different keys', () => {
    // Pitch class 6 is F sharp in G major and G flat in D flat major.
    expect(formatPitch(spellPitchClassInKey(6, major('G')))).toBe('F♯')
    expect(formatPitch(spellPitchClassInKey(6, major('Db')))).toBe('G♭')

    // Pitch class 3 is E flat in flat keys, D sharp in sharp keys.
    expect(formatPitch(spellPitchClassInKey(3, major('Bb')))).toBe('E♭')
    expect(formatPitch(spellPitchClassInKey(3, major('E')))).toBe('D♯')
  })

  it('always returns a spelling that actually sounds right', () => {
    for (const entry of CIRCLE_OF_FIFTHS) {
      for (let n = 0; n < 12; n++) {
        expect(pitchClassNumber(spellPitchClassInKey(n, entry.major))).toBe(n)
        expect(pitchClassNumber(spellPitchClassInKey(n, entry.minor))).toBe(n)
      }
    }
  })
})

describe('signatureAlteration', () => {
  it('reports what the signature does to each letter', () => {
    const eFlat = major('Eb').signature // B E A flattened
    expect(signatureAlteration('B', eFlat)).toBe(-1)
    expect(signatureAlteration('E', eFlat)).toBe(-1)
    expect(signatureAlteration('A', eFlat)).toBe(-1)
    expect(signatureAlteration('D', eFlat)).toBe(0)

    const g = major('G').signature // F sharpened
    expect(signatureAlteration('F', g)).toBe(1)
    expect(signatureAlteration('C', g)).toBe(0)
  })
})
