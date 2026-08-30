/**
 * The scale catalogue, as data.
 *
 * Each scale type is a list of intervals measured from the tonic, written in
 * shorthand so a musician can review this file without reading any code. The
 * whole/half step pattern is deliberately NOT stored here — it is derived in
 * `scale.ts` from the intervals between consecutive degrees, so the pattern the
 * app displays cannot drift out of sync with the notes it plays.
 *
 * Note in particular that harmonic minor's augmented second appears nowhere in
 * this table. It falls out of the arithmetic between the flat sixth and the
 * natural seventh, which is exactly as it should be.
 */

import { type Interval, iv } from '../pitch/interval'

export type ScaleTypeId =
  | 'major'
  | 'natural-minor'
  | 'harmonic-minor'
  | 'melodic-minor'
  | 'ionian'
  | 'dorian'
  | 'phrygian'
  | 'lydian'
  | 'mixolydian'
  | 'aeolian'
  | 'locrian'
  | 'chromatic'
  | 'whole-tone'

export type ScaleCategory = 'major' | 'minor' | 'mode' | 'symmetric'

/** Which key's signature to borrow when notating this scale. */
export type SignatureBasis = 'major' | 'minor' | 'parent-major' | 'none'

export interface ScaleType {
  readonly id: ScaleTypeId
  readonly name: string
  readonly aka?: string
  readonly category: ScaleCategory
  /** Intervals from the tonic, ascending, one octave, octave itself excluded. */
  readonly ascending: readonly Interval[]
  /** Present only where descending differs — melodic minor and chromatic. */
  readonly descending?: readonly Interval[]
  /** For modes: rotation index into the major scale. Ionian is 0. */
  readonly modeRotation?: 0 | 1 | 2 | 3 | 4 | 5 | 6
  readonly signatureBasis: SignatureBasis
  /** One sentence for the UI. */
  readonly blurb: string
}

const ivs = (...names: string[]): readonly Interval[] => names.map(iv)

const TYPES: readonly ScaleType[] = [
  {
    id: 'major',
    name: 'Major',
    category: 'major',
    ascending: ivs('P1', 'M2', 'M3', 'P4', 'P5', 'M6', 'M7'),
    signatureBasis: 'major',
    blurb:
      'The reference scale. Every other scale here is described by how it differs from this one.',
  },
  {
    id: 'natural-minor',
    name: 'Natural minor',
    aka: 'Aeolian',
    category: 'minor',
    ascending: ivs('P1', 'M2', 'm3', 'P4', 'P5', 'm6', 'm7'),
    signatureBasis: 'minor',
    blurb:
      'The same notes as its relative major, started three steps lower — which is why they share a key signature.',
  },
  {
    id: 'harmonic-minor',
    name: 'Harmonic minor',
    category: 'minor',
    ascending: ivs('P1', 'M2', 'm3', 'P4', 'P5', 'm6', 'M7'),
    signatureBasis: 'minor',
    blurb:
      'Natural minor with the seventh raised, which opens an augmented second between the sixth and seventh.',
  },
  {
    id: 'melodic-minor',
    name: 'Melodic minor',
    category: 'minor',
    ascending: ivs('P1', 'M2', 'm3', 'P4', 'P5', 'M6', 'M7'),
    descending: ivs('P1', 'M2', 'm3', 'P4', 'P5', 'm6', 'm7'),
    signatureBasis: 'minor',
    blurb:
      'Raises the sixth and seventh going up, then reverts to natural minor coming down.',
  },

  // The modes, as rotations of the major scale.
  {
    id: 'ionian',
    name: 'Ionian',
    aka: 'major',
    category: 'mode',
    ascending: ivs('P1', 'M2', 'M3', 'P4', 'P5', 'M6', 'M7'),
    modeRotation: 0,
    signatureBasis: 'parent-major',
    blurb: 'The major scale under its modal name.',
  },
  {
    id: 'dorian',
    name: 'Dorian',
    category: 'mode',
    ascending: ivs('P1', 'M2', 'm3', 'P4', 'P5', 'M6', 'm7'),
    modeRotation: 1,
    signatureBasis: 'parent-major',
    blurb: 'Minor, but with a raised sixth that keeps it from sounding sad.',
  },
  {
    id: 'phrygian',
    name: 'Phrygian',
    category: 'mode',
    ascending: ivs('P1', 'm2', 'm3', 'P4', 'P5', 'm6', 'm7'),
    modeRotation: 2,
    signatureBasis: 'parent-major',
    blurb: 'Minor with a flat second — the half step right at the bottom is the whole character.',
  },
  {
    id: 'lydian',
    name: 'Lydian',
    category: 'mode',
    ascending: ivs('P1', 'M2', 'M3', 'A4', 'P5', 'M6', 'M7'),
    modeRotation: 3,
    signatureBasis: 'parent-major',
    blurb: 'Major with a raised fourth. Floating, unresolved.',
  },
  {
    id: 'mixolydian',
    name: 'Mixolydian',
    category: 'mode',
    ascending: ivs('P1', 'M2', 'M3', 'P4', 'P5', 'M6', 'm7'),
    modeRotation: 4,
    signatureBasis: 'parent-major',
    blurb: 'Major with a flat seventh. The scale behind most folk and blues melodies.',
  },
  {
    id: 'aeolian',
    name: 'Aeolian',
    aka: 'natural minor',
    category: 'mode',
    ascending: ivs('P1', 'M2', 'm3', 'P4', 'P5', 'm6', 'm7'),
    modeRotation: 5,
    signatureBasis: 'parent-major',
    blurb: 'Natural minor under its modal name.',
  },
  {
    id: 'locrian',
    name: 'Locrian',
    category: 'mode',
    ascending: ivs('P1', 'm2', 'm3', 'P4', 'd5', 'm6', 'm7'),
    modeRotation: 6,
    signatureBasis: 'parent-major',
    blurb: 'The only mode without a perfect fifth, which is why it never settles.',
  },

  // Symmetric scales: no key feeling at all, because every step is the same size.
  {
    id: 'chromatic',
    name: 'Chromatic',
    category: 'symmetric',
    ascending: ivs('P1', 'A1', 'M2', 'A2', 'M3', 'P4', 'A4', 'P5', 'A5', 'M6', 'A6', 'M7'),
    descending: ivs('P1', 'm2', 'M2', 'm3', 'M3', 'P4', 'd5', 'P5', 'm6', 'M6', 'm7', 'M7'),
    signatureBasis: 'none',
    blurb:
      'Every semitone. Conventionally written with sharps going up and flats coming down.',
  },
  {
    id: 'whole-tone',
    name: 'Whole tone',
    category: 'symmetric',
    ascending: ivs('P1', 'M2', 'M3', 'A4', 'A5', 'A6'),
    signatureBasis: 'none',
    blurb: 'Nothing but whole steps, so no note sounds like home.',
  },
]

export const SCALE_TYPE_LIST: readonly ScaleType[] = TYPES

export const SCALE_TYPES: Readonly<Record<ScaleTypeId, ScaleType>> = Object.freeze(
  Object.fromEntries(TYPES.map((t) => [t.id, t])) as Record<ScaleTypeId, ScaleType>,
)

export const scaleTypesByCategory = (category: ScaleCategory): readonly ScaleType[] =>
  TYPES.filter((t) => t.category === category)
