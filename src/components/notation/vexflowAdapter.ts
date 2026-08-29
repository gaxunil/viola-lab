/**
 * Translation from our domain types into VexFlow's input format.
 *
 * Nothing here imports VexFlow and nothing here touches the DOM. That is
 * deliberate: the interesting decisions — which accidental gets printed, how a
 * bar is beamed — are decisions we have already made in `src/core`, and the
 * only way to keep them testable in node is to emit plain data and let the
 * component do the object construction.
 *
 * The single most important thing this module exists for is `beamGroupFractions`.
 * VexFlow's `Beam.getDefaultBeamGroups()` carries a lookup table of simple
 * meters; 6/8 and 12/8 are simply absent from it and fall through to a heuristic
 * whose own source comment calls it "fairly naive". For a compound meter that
 * heuristic can beam 12/8 as two groups of six, which teaches the player exactly
 * the wrong thing — 12/8 is four dotted-quarter beats and the beams have to say
 * so. So we never let VexFlow guess: the renderer always passes an explicit
 * `groups` array built from `Meter.grouping`, which our core already computes.
 *
 * Conventions this module fixes, so the renderer and the tests agree:
 *
 *   - `toVexDuration` returns the PLAIN code with no dots ('q', not 'qd').
 *     Dots come back separately as `StaveNoteSpec.dots`, because in VexFlow 5 a
 *     dot is a `Dot` modifier attached with `Dot.buildAndAttach(notes)`, not a
 *     suffix on the duration string. Encoding them twice would double-count.
 *   - Pitches are indexed by NOTE ORDINAL, not by event index: rests consume no
 *     pitch. That matches `notate()` and `fingerNotes()`, which are both handed
 *     a bare list of pitches and know nothing about rests. `FingeredNote.index`
 *     is an index into that same pitch list, so fingerings line up for free.
 *   - Accidentals are whatever `notate()` decided to print and nothing else.
 *     VexFlow will happily infer its own from the key strings if asked; it must
 *     not be asked, or a passage in F sharp major sprouts a sharp on every F.
 */

import { type Key } from '@core/key/key'
import { type AccidentalGlyph, type Clef, notate } from '@core/notation/staff'
import { type Alteration, type Pitch, formatPitch } from '@core/pitch/pitch'
import { type RhythmEvent, placeEvents } from '@core/rhythm/bar'
import { type Duration, type NoteValue } from '@core/rhythm/duration'
import { type Meter } from '@core/rhythm/meter'
import { type FingeredNote } from '@core/viola/fingering'

/**
 * VexFlow spells accidentals inside the key string in ASCII, and uppercases it
 * before lookup, so 'eb/4' and 'EB/4' are the same note. We emit lower case
 * because that is what every VexFlow example uses and it reads better in a diff.
 */
const VEX_ALTERATION: Readonly<Record<Alteration, string>> = {
  [-2]: 'bb',
  [-1]: 'b',
  0: '',
  1: '#',
  2: '##',
}

/** Our pitch -> VexFlow key string, e.g. E flat 4 -> 'eb/4'. */
export const toVexKey = (pitch: Pitch): string =>
  `${pitch.letter.toLowerCase()}${VEX_ALTERATION[pitch.alter]}/${pitch.octave}`

const VEX_NOTE_VALUE: Readonly<Record<NoteValue, string>> = {
  whole: 'w',
  half: 'h',
  quarter: 'q',
  eighth: '8',
  sixteenth: '16',
  thirtysecond: '32',
}

/**
 * Our duration -> VexFlow duration code. Rests append 'r'.
 *
 * Dots and tuplets are deliberately NOT encoded here. A triplet eighth is
 * written as an ordinary eighth with a bracket over the group, and a dot is a
 * separate `Dot` modifier — so both are carried alongside the code rather than
 * inside it. See `StaveNoteSpec.dots`.
 */
export const toVexDuration = (duration: Duration, isRest: boolean): string =>
  `${VEX_NOTE_VALUE[duration.base]}${isRest ? 'r' : ''}`

const VEX_ACCIDENTAL: Readonly<Record<AccidentalGlyph, string>> = {
  '♯': '#',
  '♭': 'b',
  '♮': 'n',
  '𝄪': '##',
  '𝄫': 'bb',
}

/** Our accidental glyph -> VexFlow accidental code. */
export const toVexAccidental = (glyph: AccidentalGlyph): string => VEX_ACCIDENTAL[glyph]

/**
 * Beam groups as fractions of a whole note, taken from OUR meter grouping.
 *
 * VexFlow reads each group as "this much music beams together" — `{2, 8}` means
 * two eighths — and cycles through the array across the bar. Our grouping is
 * already in denominator units and already sums to the numerator, so the
 * translation is one number per group and no arithmetic.
 *
 * 12/8 grouped 3+3+3+3 therefore yields FOUR groups of 3/8, which is the whole
 * point; VexFlow's own default for 12/8 does not.
 */
export function beamGroupFractions(meter: Meter): Array<{
  numerator: number
  denominator: number
}> {
  return meter.grouping.map((pulses) => ({
    numerator: pulses,
    denominator: meter.denominator,
  }))
}

/**
 * The key string that puts a notehead on the middle line of the staff.
 *
 * Used for two things: rests, which VexFlow positions from a key like any other
 * note, and pitchless rhythm drills, where a single line of noteheads is the
 * conventional way to write rhythm without implying a pitch.
 */
const MIDDLE_LINE_KEY: Readonly<Record<Clef, string>> = {
  treble: 'b/4',
  alto: 'c/4',
  bass: 'd/3',
}

export const middleLineKey = (clef: Clef): string => MIDDLE_LINE_KEY[clef]

export interface StaveNoteSpec {
  readonly keys: readonly string[]
  /** Plain VexFlow code with no dots — see `toVexDuration`. */
  readonly duration: string
  /** Applied by the renderer with `Dot.buildAndAttach`. */
  readonly dots: number
  /** Parallel to `keys`; null where `notate()` decided not to print one. */
  readonly accidentals: ReadonlyArray<{ index: number; code: string } | null>
  readonly isRest: boolean
  readonly fingering?: { finger: string; stringNumber?: string }
  readonly bowing?: 'up' | 'down'
}

export interface StaveNoteSpecOptions {
  readonly events: readonly RhythmEvent[]
  readonly meter: Meter
  readonly key: Key
  /** One per NOTE event, in order. Rests consume no pitch. */
  readonly pitches?: readonly Pitch[]
  /** `FingeredNote.index` indexes the pitch list, not the event list. */
  readonly fingering?: readonly FingeredNote[]
  /** One per note event, in order; null for "no bowing marked". */
  readonly bowings?: ReadonlyArray<'up' | 'down' | null>
  /** Only affects where rests and pitchless noteheads sit. Defaults to alto. */
  readonly clef?: Clef
}

/**
 * Where `notate()` should forget the accidentals it has printed.
 *
 * An accidental holds for the rest of its bar and no further, so `notate()` has
 * to be told which pitch indices open a new bar. It cannot work that out itself
 * — it is handed a flat run of pitches with no meter. We can, because
 * `placeEvents` already locates every event in a bar; the only translation
 * needed is from event index to note ordinal, since rests are not in the pitch
 * list at all.
 */
function noteBarBoundaries(meter: Meter, events: readonly RhythmEvent[]): number[] {
  const boundaries: number[] = []
  let ordinal = 0
  let currentBar = -1

  for (const placed of placeEvents(meter, events)) {
    if (placed.event.kind !== 'note') continue
    if (placed.bar !== currentBar) {
      currentBar = placed.bar
      // Index 0 needs no boundary: notate() starts with an empty memory anyway.
      if (ordinal > 0) boundaries.push(ordinal)
    }
    ordinal += 1
  }
  return boundaries
}

/** Build the full spec list for a run of rhythm, with pitches optional. */
export function toStaveNoteSpecs(o: StaveNoteSpecOptions): StaveNoteSpec[] {
  const clef = o.clef ?? 'alto'
  const restKey = middleLineKey(clef)
  const pitches = o.pitches ?? []

  // notate() is the only thing allowed to decide which accidentals are printed.
  // Its answer depends on the key signature and on what has already appeared in
  // the bar, never on the clef, so passing the clef through is harmless.
  const notated = notate(pitches, o.key, clef, {
    barBoundaries: noteBarBoundaries(o.meter, o.events),
  })

  const fingerByOrdinal = new Map<number, FingeredNote>()
  for (const f of o.fingering ?? []) fingerByOrdinal.set(f.index, f)

  const specs: StaveNoteSpec[] = []
  let ordinal = 0

  for (const event of o.events) {
    const isRest = event.kind === 'rest'
    const duration = toVexDuration(event.duration, isRest)

    if (isRest) {
      // A rest has no pitch, so it can carry neither an accidental nor a
      // fingering — there is nothing to finger.
      specs.push({
        keys: [restKey],
        duration,
        dots: event.duration.dots,
        accidentals: [null],
        isRest: true,
      })
      continue
    }

    const note = notated[ordinal]
    const accidental = note?.accidental ?? null
    const finger = fingerByOrdinal.get(ordinal)
    const bowing = o.bowings?.[ordinal] ?? null

    specs.push({
      // Without a pitch this is a rhythm drill: one notehead per event, parked
      // on the middle line so nothing implies a pitch that was never given.
      keys: [note ? toVexKey(note.pitch) : restKey],
      duration,
      dots: event.duration.dots,
      accidentals: [accidental === null ? null : { index: 0, code: toVexAccidental(accidental) }],
      isRest: false,
      ...(finger === undefined
        ? {}
        : {
            fingering: {
              finger: String(finger.placement.finger),
              // Roman numerals, not 1-4: that is how a viola part marks a
              // string, and StringId already carries them in that form.
              stringNumber: finger.placement.string,
            },
          }),
      ...(bowing === null ? {} : { bowing }),
    })
    ordinal += 1
  }

  return specs
}

/**
 * The thirty key signatures VexFlow's own table knows, mirrored here so this
 * module stays free of a VexFlow import. `VexFlow.keySignature()` THROWS on a
 * spec it does not recognise, so the renderer has to ask before it tells.
 */
const VEX_KEY_SPECS: ReadonlySet<string> = new Set([
  'Cb', 'Gb', 'Db', 'Ab', 'Eb', 'Bb', 'F', 'C', 'G', 'D', 'A', 'E', 'B', 'F#', 'C#',
  'Abm', 'Ebm', 'Bbm', 'Fm', 'Cm', 'Gm', 'Dm', 'Am', 'Em', 'Bm', 'F#m', 'C#m', 'G#m',
  'D#m', 'A#m',
])

/**
 * Our key -> VexFlow's key-signature spec string, e.g. 'Bb', 'F#m', 'C'.
 *
 * Returns null for a key VexFlow has no signature for. That is a real limit
 * rather than an error to swallow: VexFlow's table stops at seven accidentals,
 * so a theoretical key genuinely has no signature to draw and the caller should
 * draw none rather than crash.
 */
export function toVexKeySpec(key: Key): string | null {
  const tonic = formatPitch(key.tonic, { style: 'ascii' })
  const spec = key.mode === 'minor' ? `${tonic}m` : tonic
  return VEX_KEY_SPECS.has(spec) ? spec : null
}
