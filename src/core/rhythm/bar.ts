/**
 * Bars: validating that events fill a meter, and locating them within it.
 *
 * Rhythm events are deliberately pitch-free. A rhythm is a rhythm, and keeping
 * pitch out means this whole module has no dependency on pitch/, key/ or scale/.
 * Melody, when it arrives, pairs a rhythm with pitches rather than changing
 * anything here.
 *
 * Ties are resolved HERE, before playback ever sees the events, so a note tied
 * across a barline reaches the audio layer as a single sounding span with a
 * single onset.
 */

import { type Rational, ZERO, radd, rat, rcmp, req, rsub } from '../math/rational'
import { type Ticks, ticksFromWholeNotes } from '../ticks'
import { type AccentLevel, type Meter, beatAt } from './meter'
import { type Duration, decompose, durationValue, formatDuration } from './duration'

export type EventKind = 'note' | 'rest'

export interface RhythmEvent {
  readonly kind: EventKind
  readonly duration: Duration
  /** Notes only. A rest cannot be tied. */
  readonly tiedToNext?: boolean
  /** Stable key for rendering lists. */
  readonly id?: string
}

export interface Bar {
  readonly meter: Meter
  readonly events: readonly RhythmEvent[]
}

export const note = (duration: Duration, o: { tiedToNext?: boolean; id?: string } = {}): RhythmEvent => ({
  kind: 'note',
  duration,
  ...(o.tiedToNext === undefined ? {} : { tiedToNext: o.tiedToNext }),
  ...(o.id === undefined ? {} : { id: o.id }),
})

export const rest = (duration: Duration, o: { id?: string } = {}): RhythmEvent => ({
  kind: 'rest',
  duration,
  ...(o.id === undefined ? {} : { id: o.id }),
})

export type BarValidation =
  | { readonly ok: true; readonly total: Rational }
  | {
      readonly ok: false
      readonly total: Rational
      readonly expected: Rational
      readonly kind: 'short' | 'long'
      readonly difference: Rational
      /** 'short by a dotted quarter' */
      readonly message: string
      readonly missing: readonly Duration[]
    }

function describeDifference(missing: readonly Duration[]): string {
  if (missing.length === 0) return 'an unrepresentable amount'
  return missing.map(formatDuration).join(' plus a ')
}

/**
 * Does this list of events exactly fill one bar of this meter?
 *
 * Exact, because durations are rationals — there is no tolerance and no epsilon.
 */
export function validateBar(meter: Meter, events: readonly RhythmEvent[]): BarValidation {
  const total = events.reduce((sum, e) => radd(sum, durationValue(e.duration)), ZERO)
  const expected = meter.barValue
  const cmp = rcmp(total, expected)

  if (cmp === 0) return { ok: true, total }

  const short = cmp < 0
  const difference = short ? rsub(expected, total) : rsub(total, expected)
  const missing = decompose(difference)

  return {
    ok: false,
    total,
    expected,
    kind: short ? 'short' : 'long',
    difference,
    message: `${short ? 'short' : 'long'} by a ${describeDifference(missing)}`,
    missing,
  }
}

/** True when the events fill a whole number of bars of this meter. */
export function fillsWholeBars(meter: Meter, events: readonly RhythmEvent[]): boolean {
  const total = events.reduce((sum, e) => radd(sum, durationValue(e.duration)), ZERO)
  const bars = (total.n * meter.barValue.d) / (total.d * meter.barValue.n)
  return Number.isInteger(bars) && bars > 0
}

export interface PlacedEvent {
  readonly event: RhythmEvent
  readonly index: number
  /** Offset from the start of the passage, in whole notes. */
  readonly onset: Rational
  readonly end: Rational
  readonly onsetTicks: Ticks
  readonly durationTicks: Ticks
  /** 0-based bar number. */
  readonly bar: number
  /** 0-based felt beat within the bar. */
  readonly beat: number
  readonly offsetInBeatTicks: number
  readonly startsOnBeat: boolean
  /** True when the event runs past the end of the beat it starts in. */
  readonly crossesBeat: boolean
  /** Non-null only when the event starts exactly on a beat. */
  readonly accent: AccentLevel | null
}

/**
 * Lay events out in time, tagging each with where it falls in the bar.
 *
 * `crossesBeat` is the syncopation hook: an event that starts inside one beat
 * and runs into the next is exactly what makes a rhythm feel offbeat, and the
 * UI can point at it.
 */
export function placeEvents(meter: Meter, events: readonly RhythmEvent[]): PlacedEvent[] {
  const out: PlacedEvent[] = []
  let onset: Rational = ZERO

  for (const [index, event] of events.entries()) {
    const value = durationValue(event.duration)
    const end = radd(onset, value)

    const onsetTicks = ticksFromWholeNotes(onset)
    const durationTicks = ticksFromWholeNotes(value)

    const bar = Math.floor(onsetTicks / meter.barTicks)
    const tickInBar = onsetTicks - bar * meter.barTicks
    const { beat, offsetTicks } = beatAt(meter, tickInBar)

    const startsOnBeat = offsetTicks === 0
    const beatLengthTicks = (meter.grouping[beat] ?? 1) * meter.pulseTicks
    const crossesBeat = offsetTicks + durationTicks > beatLengthTicks

    out.push({
      event,
      index,
      onset,
      end,
      onsetTicks,
      durationTicks,
      bar,
      beat,
      offsetInBeatTicks: offsetTicks,
      startsOnBeat,
      crossesBeat,
      accent: startsOnBeat ? (meter.accents[beat] ?? null) : null,
    })

    onset = end
  }

  return out
}

/** A sounding span: one or more tied events collapsed into a single note. */
export interface RhythmSpan {
  readonly kind: EventKind
  readonly onset: Rational
  readonly durationValue: Rational
  readonly onsetTicks: Ticks
  readonly durationTicks: Ticks
  /** Indices of the source events, so the UI can still highlight every notehead. */
  readonly sourceIndices: readonly number[]
}

/**
 * Collapse tied notes into single sounding spans.
 *
 * A half note tied across a barline to a quarter becomes ONE span lasting three
 * quarters, with no onset at the barline. Getting this wrong is audible
 * immediately: the note is rearticulated in the middle.
 */
export function resolveTies(meter: Meter, events: readonly RhythmEvent[]): RhythmSpan[] {
  const placed = placeEvents(meter, events)
  const spans: RhythmSpan[] = []

  let i = 0
  while (i < placed.length) {
    const head = placed[i]
    if (head === undefined) break

    const sourceIndices = [head.index]
    let value = durationValue(head.event.duration)
    let ticks = head.durationTicks

    // A rest is never tied; only notes continue.
    let j = i
    while (
      placed[j]?.event.kind === 'note' &&
      placed[j]?.event.tiedToNext === true &&
      placed[j + 1]?.event.kind === 'note'
    ) {
      const next = placed[j + 1]
      if (next === undefined) break
      value = radd(value, durationValue(next.event.duration))
      ticks = (ticks + next.durationTicks) as Ticks
      sourceIndices.push(next.index)
      j += 1
    }

    spans.push({
      kind: head.event.kind,
      onset: head.onset,
      durationValue: value,
      onsetTicks: head.onsetTicks,
      durationTicks: ticks,
      sourceIndices,
    })

    i = j + 1
  }

  return spans
}

/**
 * Group event indices by the beat they start in, for beaming.
 *
 * VexFlow's default beam grouping has no entry for 6/8 or 12/8 and falls back to
 * a heuristic its own source calls naive. Since correct compound beaming is the
 * pedagogy here, the renderer takes its groups from the meter instead — this is
 * where they come from.
 */
/** Notes at or above a quarter note carry no flag, so they are never beamed. */
const BEAM_THRESHOLD = rat(1, 4)

export function beamGroups(meter: Meter, events: readonly RhythmEvent[]): number[][] {
  const placed = placeEvents(meter, events)
  const groups = new Map<string, number[]>()

  for (const p of placed) {
    // Beaming is about flags, not beats: an eighth or shorter is beamed, in any
    // meter. Using the beat length would break in asymmetric meters, where the
    // beats are deliberately unequal. Rests break a beam.
    if (p.event.kind !== 'note') continue
    if (rcmp(durationValue(p.event.duration), BEAM_THRESHOLD) >= 0) continue

    const key = `${p.bar}:${p.beat}`
    const bucket = groups.get(key)
    if (bucket) bucket.push(p.index)
    else groups.set(key, [p.index])
  }

  return [...groups.values()].filter((g) => g.length > 1)
}

/** Groups of indices that are tied together, for drawing tie curves. */
export function tieGroups(events: readonly RhythmEvent[]): number[][] {
  const out: number[][] = []
  let current: number[] = []

  for (const [index, event] of events.entries()) {
    if (event.kind === 'note' && event.tiedToNext === true) {
      if (current.length === 0) current.push(index)
      current.push(index + 1)
      continue
    }
    if (current.length > 0) {
      out.push([...new Set(current)])
      current = []
    }
  }
  if (current.length > 0) out.push([...new Set(current)])
  return out
}

export const barTotal = (events: readonly RhythmEvent[]): Rational =>
  events.reduce((sum, e) => radd(sum, durationValue(e.duration)), ZERO)

export const barsAreEqual = (a: Bar, b: Bar): boolean =>
  a.meter.label === b.meter.label && req(barTotal(a.events), barTotal(b.events))
