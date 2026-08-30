/**
 * Where every dot goes on the fingerboard diagram, in normalised coordinates.
 *
 * Pure arithmetic on purpose: no DOM, no solid-js, nothing that needs a browser.
 * The component that draws this is untestable in node, so everything worth
 * asserting — which note lands where, which spot is the tonic, where the hand
 * shifts — is decided here instead.
 *
 * TWO DECISIONS WORTH READING BEFORE EDITING.
 *
 * 1. STRING I IS AT THE TOP. A violist looks down at the instrument and sees the
 *    A string nearest her, on the far side from her chin — the highest string is
 *    the one drawn topmost in every method book. So `y` increases downward and
 *    string I (A) gets the smallest `y`, string IV (C) the largest. This is the
 *    opposite of a piano roll and of guitar tab, both of which put the lowest
 *    voice at the bottom, so it is stated rather than left to be inferred.
 *
 * 2. SEMITONE SPACING IS EVEN, WHICH A REAL FINGERBOARD IS NOT. On the real
 *    instrument the distance to a note shrinks geometrically as you go up — the
 *    vibrating length is proportional to 2^(-semitones/12), so the gap between
 *    the third and fourth fingers in first position is visibly wider than the
 *    same gap in fifth. Drawing that honestly would squash the top of the
 *    diagram into a few pixels on a phone, exactly where the interesting notes
 *    of a shifted scale live. So `x` is simply semitones / rows. The diagram is
 *    a map of WHICH note is WHERE, not a template to measure against the wood,
 *    and the position markers carry the real spacing information instead.
 */

import {
  type Pitch,
  type PitchClass,
  formatPitch,
  pitchClassNumber,
  toMidi,
  withOctave,
} from '@core/pitch/pitch'
import { type Scale } from '@core/scale/scale'
import { type FingeringPlan } from '@core/viola/fingering'
import {
  type Finger,
  type Position,
  DIAGRAM_ROWS,
  pitchAt,
  positionName,
} from '@core/viola/fingerboard'
import {
  type StringId,
  type ViolaString,
  STRINGS,
  STRINGS_HIGH_TO_LOW,
} from '@core/viola/strings'

export interface FingerboardDot {
  readonly string: StringId
  /** 0 = highest string (I, the A string), which is drawn at the top. */
  readonly stringIndex: number
  readonly semitonesAboveOpen: number
  readonly midi: number
  readonly pitch: Pitch
  /** null when the note is in the scale but not in the plan. */
  readonly finger: Finger | null
  readonly position: Position | null
  readonly isOpen: boolean
  readonly isTonic: boolean
  /** true when the fingering plan actually plays it here. */
  readonly inPlan: boolean
  /** index within the plan, for highlighting playback. */
  readonly noteIndex: number | null
  /** finger number, or note name — caller decides via LabelMode. */
  readonly label: string
  /** 0..1 along the string (nut -> high). */
  readonly x: number
  /** 0..1 across the strings. */
  readonly y: number
}

export type LabelMode = 'finger' | 'note' | 'degree'

export interface FingerboardStringLine {
  readonly id: StringId
  readonly index: number
  /** 'I (A)' */
  readonly label: string
  /** The open pitch, with octave: 'A4'. */
  readonly openLabel: string
  readonly y: number
}

export interface FingerboardPositionMarker {
  readonly position: Position
  readonly x: number
  /** Short enough for a phone: '1st', '3rd', '5th'. */
  readonly label: string
}

export interface FingerboardLayout {
  readonly dots: readonly FingerboardDot[]
  readonly strings: readonly FingerboardStringLine[]
  readonly positionMarkers: readonly FingerboardPositionMarker[]
  readonly rows: number
}

export interface FingerboardOptions {
  readonly scale?: Scale
  readonly plan?: FingeringPlan
  /** Semitone rows to draw per string. Grows if the plan reaches past it. */
  readonly rows?: number
  readonly labelMode?: LabelMode
}

/**
 * The positions worth drawing a reference line for. First is where the hand
 * starts, third is the first shift a student meets, fifth is where the
 * two-octave flat keys end up.
 */
const MARKED_POSITIONS: readonly Position[] = [1, 3, 5]

/**
 * Strings are inset rather than pinned to the edges, so the top and bottom rows
 * of dots have room to draw their outlines without being clipped.
 */
const stringY = (index: number): number => (index + 0.5) / STRINGS_HIGH_TO_LOW.length

const noteName = (pitch: Pitch): string => formatPitch(pitch, { octave: false })

/** Which degree of the scale this pitch is, by sound rather than by spelling. */
function degreeLabelFor(scale: Scale | undefined, pitch: Pitch): string | null {
  if (scale === undefined) return null
  const target = pitchClassNumber(pitch)
  const degree = scale.degrees.find((d) => pitchClassNumber(d.pitchClass) === target)
  return degree ? degree.label : null
}

/**
 * A dot always says something.
 *
 * In `finger` mode a dot the plan does not play has no finger to print, and a
 * blank circle teaches nothing — so it falls back to the note name. Same for a
 * degree label when there is no scale to take degrees from.
 */
function labelFor(mode: LabelMode, pitch: Pitch, finger: Finger | null, degree: string | null): string {
  if (mode === 'finger') return finger === null ? noteName(pitch) : String(finger)
  if (mode === 'degree') return degree ?? noteName(pitch)
  return noteName(pitch)
}

/** Every octave of a pitch class that falls on this string within `rows`. */
function occurrencesOnString(
  string: ViolaString,
  pitchClass: PitchClass,
  rows: number,
): Array<{ pitch: Pitch; semitonesAboveOpen: number }> {
  const out: Array<{ pitch: Pitch; semitonesAboveOpen: number }> = []
  for (let octave = 0; octave <= 9; octave += 1) {
    const pitch = withOctave(pitchClass, octave)
    const semitonesAboveOpen = toMidi(pitch) - string.openMidi
    if (semitonesAboveOpen >= 0 && semitonesAboveOpen <= rows) {
      out.push({ pitch, semitonesAboveOpen })
    }
  }
  return out
}

const dotKey = (string: StringId, semitones: number): string => `${string}:${semitones}`

export function buildFingerboardLayout(o: FingerboardOptions): FingerboardLayout {
  const scale = o.scale
  const plan = o.plan
  const labelMode = o.labelMode ?? 'finger'

  // The requested row count is a floor, not a ceiling. Two-octave B flat major
  // reaches a thirteenth semitone above the open A, and clipping it would drop
  // the top note of the scale off the diagram — the one note a student most
  // wants to see, because it is the reason the scale shifts at all.
  const requestedRows = o.rows ?? DIAGRAM_ROWS
  const planReach =
    plan === undefined
      ? 0
      : plan.notes.reduce((high, note) => Math.max(high, note.placement.semitonesAboveOpen), 0)
  const rows = Math.max(requestedRows, planReach)

  // With no scale, the plan's own first note is the thing to mark as home.
  const tonicPitchClass =
    scale !== undefined
      ? pitchClassNumber(scale.tonic)
      : plan !== undefined && plan.notes[0] !== undefined
        ? pitchClassNumber(plan.notes[0].pitch)
        : null

  const byKey = new Map<string, FingerboardDot>()

  const push = (dot: FingerboardDot): void => {
    const key = dotKey(dot.string, dot.semitonesAboveOpen)
    // One dot per spot on the board. A scale played up and down touches the same
    // spot twice, and occasionally with a different finger either side of a
    // shift; the first visit wins, because that is the fingering she reads on
    // the way up and the diagram cannot show two numbers in one circle.
    if (!byKey.has(key)) byKey.set(key, dot)
  }

  if (plan !== undefined) {
    for (const note of plan.notes) {
      const placement = note.placement
      const string = STRINGS[placement.string]
      push({
        string: placement.string,
        stringIndex: string.index,
        semitonesAboveOpen: placement.semitonesAboveOpen,
        midi: toMidi(note.pitch),
        pitch: note.pitch,
        finger: placement.finger,
        position: placement.position,
        isOpen: placement.isOpen,
        isTonic: tonicPitchClass !== null && pitchClassNumber(note.pitch) === tonicPitchClass,
        inPlan: true,
        noteIndex: note.index,
        label: labelFor(labelMode, note.pitch, placement.finger, degreeLabelFor(scale, note.pitch)),
        x: rows === 0 ? 0 : placement.semitonesAboveOpen / rows,
        y: stringY(string.index),
      })
    }
  }

  if (scale !== undefined) {
    for (const string of STRINGS_HIGH_TO_LOW) {
      for (const degree of scale.degrees) {
        for (const found of occurrencesOnString(string, degree.pitchClass, rows)) {
          const isOpen = found.semitonesAboveOpen === 0
          push({
            string: string.id,
            stringIndex: string.index,
            semitonesAboveOpen: found.semitonesAboveOpen,
            midi: toMidi(found.pitch),
            pitch: found.pitch,
            // An open string is the one place there is nothing to choose: no
            // finger goes down, so 0 is a fact rather than a suggestion. Every
            // stopped note is left unfingered until a plan decides.
            finger: isOpen ? 0 : null,
            position: null,
            isOpen,
            isTonic:
              tonicPitchClass !== null && pitchClassNumber(found.pitch) === tonicPitchClass,
            inPlan: false,
            noteIndex: null,
            label: labelFor(
              labelMode,
              found.pitch,
              isOpen ? 0 : null,
              degreeLabelFor(scale, found.pitch),
            ),
            x: rows === 0 ? 0 : found.semitonesAboveOpen / rows,
            y: stringY(string.index),
          })
        }
      }
    }
  }

  const dots = [...byKey.values()].sort(
    (a, b) =>
      a.stringIndex - b.stringIndex || a.semitonesAboveOpen - b.semitonesAboveOpen,
  )

  const strings: FingerboardStringLine[] = STRINGS_HIGH_TO_LOW.map((string) => ({
    id: string.id,
    index: string.index,
    label: string.label,
    openLabel: formatPitch(string.open),
    y: stringY(string.index),
  }))

  return { dots, strings, positionMarkers: positionMarkers(rows), rows }
}

/**
 * Where the first finger sits in each marked position, as a fraction of the
 * board.
 *
 * The same fraction serves all four strings, which is not a coincidence: a
 * position is a diatonic offset from the open string, and every open string is
 * measured with the same neutral major-scale spacing. So the position lines are
 * vertical, and one measurement off any string is enough.
 */
function positionMarkers(rows: number): FingerboardPositionMarker[] {
  const reference = STRINGS.I
  const out: FingerboardPositionMarker[] = []
  for (const position of MARKED_POSITIONS) {
    const semitones = toMidi(pitchAt(reference, position, 1)) - reference.openMidi
    if (semitones > rows) continue
    out.push({
      position,
      x: rows === 0 ? 0 : semitones / rows,
      label: positionName(position).split(' ')[0] ?? String(position),
    })
  }
  return out
}

/**
 * The dot a given note of the plan is played on.
 *
 * Playback highlighting goes through here rather than through `dot.noteIndex`,
 * because a spot visited twice only carries the first visit's index — and the
 * highlight has to follow the second visit just as faithfully as the first.
 */
export function dotForPlanNote(
  layout: FingerboardLayout,
  plan: FingeringPlan,
  noteIndex: number,
): FingerboardDot | null {
  const note = plan.notes[noteIndex]
  if (note === undefined) return null
  const placement = note.placement
  return (
    layout.dots.find(
      (dot) =>
        dot.string === placement.string &&
        dot.semitonesAboveOpen === placement.semitonesAboveOpen,
    ) ?? null
  )
}

const COUNT_WORD: readonly string[] = ['no', 'one', 'two', 'three', 'four', 'five', 'six']
const OCTAVE_WORD: readonly string[] = ['', 'one octave', 'two octaves', 'three octaves']

const countWord = (n: number): string => COUNT_WORD[n] ?? String(n)

function joinWords(xs: readonly string[]): string {
  if (xs.length <= 1) return xs[0] ?? ''
  return `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1] ?? ''}`
}

/**
 * Screen readers pronounce '♯' unreliably — some say "sharp", some say nothing
 * at all, which turns F♯ into F. The summary is the one place the note names
 * have to survive being spoken, so the symbols are spelled out in words.
 */
function speakable(text: string): string {
  return text
    .replace(/\u{1D12A}/gu, ' double sharp')
    .replace(/\u{1D12B}/gu, ' double flat')
    .replace(/♯/gu, ' sharp')
    .replace(/♭/gu, ' flat')
    // 'F sharp5' is read as one token by some readers; keep the octave apart.
    .replace(/(sharp|flat)(-?\d)/gu, '$1 $2')
    .replace(/ {2,}/gu, ' ')
}

function stringPhrase(ids: readonly StringId[]): string {
  if (ids.length === 0) return 'using no strings'
  if (ids.length === STRINGS_HIGH_TO_LOW.length) return 'using all four strings'
  const letters = ids.map((id) => STRINGS[id].letterName)
  return `using the ${joinWords(letters)} string${letters.length > 1 ? 's' : ''}`
}

/**
 * Where the hand goes, in the words a teacher would use. "Entirely in first
 * position" and "one shift up to 3rd position on F sharp 5" are the two facts a
 * student acts on; everything else about the fingering is detail.
 */
function positionPhrase(plan: FingeringPlan): string {
  if (plan.staysInFirstPosition) return 'entirely in first position'
  const shifts = plan.shifts
  if (shifts.length === 0) return `entirely in ${positionName(plan.highestPosition)}`
  const first = shifts[0]
  if (shifts.length === 1 && first !== undefined) {
    const arrival = plan.notes[first.atIndex]
    const where = arrival === undefined ? '' : ` on ${formatPitch(arrival.pitch)}`
    return `with one shift ${first.direction} to ${positionName(first.toPosition)}${where}`
  }
  return `with ${countWord(shifts.length)} shifts, reaching ${positionName(plan.highestPosition)}`
}

function spanPhrase(plan: FingeringPlan): string | null {
  const midis = plan.notes.map((note) => toMidi(note.pitch))
  if (midis.length === 0) return null
  const low = Math.min(...midis)
  const high = Math.max(...midis)
  const lowest = plan.notes.find((note) => toMidi(note.pitch) === low)
  const highest = plan.notes.find((note) => toMidi(note.pitch) === high)
  if (lowest === undefined || highest === undefined) return null

  const span = high - low
  const octaves = span / 12
  if (Number.isInteger(octaves) && octaves >= 1) {
    const word = OCTAVE_WORD[octaves] ?? `${octaves} octaves`
    return `${word} from ${formatPitch(lowest.pitch)}`
  }
  return `from ${formatPitch(lowest.pitch)} to ${formatPitch(highest.pitch)}`
}

/**
 * One sentence with the useful fact in it, for a screen reader or a tooltip.
 *
 * A diagram is worth nothing to someone who cannot see it, and "fingerboard
 * diagram" is worth nothing to anybody. What she actually needs to know is how
 * far the scale reaches, whether the hand moves, and which strings it crosses.
 */
export function describeFingerboard(o: FingerboardOptions): string {
  const scale = o.scale
  const plan = o.plan
  const rows = o.rows ?? DIAGRAM_ROWS

  if (plan !== undefined && plan.notes.length > 0) {
    const head = scale !== undefined ? scale.name : 'This fingering'
    const span = spanPhrase(plan)
    const parts = [head, ...(span === null ? [] : [span]), positionPhrase(plan), stringPhrase(plan.stringsUsed)]
    return speakable(`${parts.join(', ')}.`)
  }

  if (scale !== undefined) {
    return speakable(
      `${scale.name}, shown on all four strings: every place the notes of the scale fall ` +
        `within ${rows} semitones of each open string. No fingering chosen yet.`,
    )
  }

  return 'An empty viola fingerboard, tuned in fifths: C, G, D and A. No scale chosen yet.'
}
