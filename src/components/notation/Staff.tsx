/**
 * One staff of music, drawn with VexFlow.
 *
 * Everything that can be decided without a DOM lives in `vexflowAdapter.ts`;
 * this file is only the part that has to touch a browser. In particular the
 * beam groups come from `beamGroupFractions(meter)` and are passed to
 * `Beam.generateBeams` explicitly, because VexFlow's own default grouping has no
 * entry for 6/8 or 12/8 and guesses — see the long note in the adapter.
 *
 * VexFlow 5 is imported from `vexflow/core`, the lightweight entry point (~91 KB
 * gzipped) that ships no fonts. That means the fonts must be fetched at runtime
 * before anything is drawn, which is what `loadNotationFonts` does — once per
 * page, not once per component, since the font tables are global to VexFlow.
 */

import { type JSX, createEffect, onCleanup } from 'solid-js'
import {
  Accidental,
  Articulation,
  Beam,
  Dot,
  Formatter,
  Fraction,
  FretHandFinger,
  ModifierPosition,
  Renderer,
  Stave,
  StaveNote,
  StaveTie,
  StringNumber,
  VexFlow,
  Voice,
} from 'vexflow/core'
import { type Key } from '@core/key/key'
import { type Clef } from '@core/notation/staff'
import { type Pitch } from '@core/pitch/pitch'
import { type RhythmEvent, barTotal, tieGroups } from '@core/rhythm/bar'
import { type Meter } from '@core/rhythm/meter'
import { type FingeredNote } from '@core/viola/fingering'
import {
  type StaveNoteSpec,
  beamGroupFractions,
  toStaveNoteSpecs,
  toVexKeySpec,
} from './vexflowAdapter'

/**
 * Bravura is the notation font; Academico is the text font VexFlow uses for
 * time signatures, fingerings and string numbers. Both are needed or those
 * glyphs come out as empty boxes.
 *
 * The promise is module-level and shared, because the font tables are global to
 * VexFlow: a page with eight staves on it should fetch the fonts once, not
 * eight times. `loadFonts` pulls the woff2 files over the network from
 * `Font.HOST_URL` (jsdelivr by default) using the FontFace API.
 *
 * It never rejects. If the fetch fails — offline, CDN blocked — we still point
 * VexFlow at the families and draw: a staff in a substitute font is worse than
 * Bravura but far better than a blank rectangle and a stalled promise that
 * every later staff would then reuse.
 */
let fontsReady: Promise<void> | null = null

function loadNotationFonts(): Promise<void> {
  fontsReady ??= VexFlow.loadFonts('Bravura', 'Academico')
    .then(() => {
      VexFlow.setFonts('Bravura', 'Academico')
    })
    .catch(() => {
      VexFlow.setFonts('Bravura', 'Academico')
    })
  return fontsReady
}

/** Warm enough to read against black noteheads in either theme. */
const HIGHLIGHT_COLOUR = '#d4491f'

const STAVE_X = 8
const STAVE_Y = 34
/** Room above for fingerings and string numbers, below for ledger lines. */
const STAFF_HEIGHT = 150
/** Clef, key signature and time signature all live before the first note. */
const HEADER_WIDTH = 96
const PER_NOTE_WIDTH = 46
const MIN_WIDTH = 240

export interface StaffProps {
  events: readonly RhythmEvent[]
  meter: Meter
  key: Key
  /** One per NOTE event, in order; rests consume no pitch. */
  pitches?: readonly Pitch[]
  fingering?: readonly FingeredNote[]
  /** One per note event; null where no bowing is marked. */
  bowings?: ReadonlyArray<'up' | 'down' | null>
  clef?: Clef
  showTimeSignature?: boolean
  /** Index into `events` of the note currently sounding, for playback follow. */
  highlightIndex?: number | null
  width?: number
}

/**
 * Every prop, read once. An async effect stops tracking the moment it awaits,
 * so the props have to be pulled out synchronously or a later redraw would never
 * be triggered by a change to, say, `highlightIndex`.
 *
 * The optional fields are `| undefined` rather than optional properties because
 * `exactOptionalPropertyTypes` forbids writing `undefined` into an optional one.
 */
interface StaffSnapshot {
  readonly events: readonly RhythmEvent[]
  readonly meter: Meter
  readonly key: Key
  readonly pitches: readonly Pitch[] | undefined
  readonly fingering: readonly FingeredNote[] | undefined
  readonly bowings: ReadonlyArray<'up' | 'down' | null> | undefined
  readonly clef: Clef
  readonly showTimeSignature: boolean
  readonly highlightIndex: number | null
  readonly width: number | undefined
}

function buildStaveNote(spec: StaveNoteSpec, clef: Clef): StaveNote {
  const note = new StaveNote({ keys: [...spec.keys], duration: spec.duration, clef })

  // Only the accidentals `notate()` chose to print. VexFlow can infer its own
  // from the key strings, and must not be asked to: in F sharp major that would
  // stamp a sharp on every single F.
  for (const accidental of spec.accidentals) {
    if (accidental !== null) note.addModifier(new Accidental(accidental.code), accidental.index)
  }

  // In VexFlow 5 a dot is a modifier, not a suffix on the duration string, so a
  // double-dotted note is two attachments rather than one 'hdd'.
  for (let i = 0; i < spec.dots; i += 1) Dot.buildAndAttach([note], { all: true })

  if (spec.fingering !== undefined) {
    note.addModifier(
      new FretHandFinger(spec.fingering.finger).setPosition(ModifierPosition.ABOVE),
      0,
    )
    if (spec.fingering.stringNumber !== undefined) {
      note.addModifier(
        new StringNumber(spec.fingering.stringNumber).setPosition(ModifierPosition.ABOVE),
        0,
      )
    }
  }

  if (spec.bowing !== undefined) {
    // 'a|' is the up-bow glyph, 'am' the down-bow, per VexFlow's articulation table.
    const code = spec.bowing === 'up' ? 'a|' : 'am'
    note.addModifier(new Articulation(code).setPosition(ModifierPosition.ABOVE))
  }

  return note
}

function render(host: HTMLDivElement, s: StaffSnapshot): void {
  const specs = toStaveNoteSpecs({
    events: s.events,
    meter: s.meter,
    key: s.key,
    clef: s.clef,
    ...(s.pitches === undefined ? {} : { pitches: s.pitches }),
    ...(s.fingering === undefined ? {} : { fingering: s.fingering }),
    ...(s.bowings === undefined ? {} : { bowings: s.bowings }),
  })

  const width = s.width ?? Math.max(MIN_WIDTH, HEADER_WIDTH + specs.length * PER_NOTE_WIDTH)

  const renderer = new Renderer(host, Renderer.Backends.SVG)
  renderer.resize(width, STAFF_HEIGHT)
  const context = renderer.getContext()

  const stave = new Stave(STAVE_X, STAVE_Y, width - STAVE_X * 2)
  stave.addClef(s.clef)
  const keySpec = toVexKeySpec(s.key)
  if (keySpec !== null) stave.addKeySignature(keySpec)
  if (s.showTimeSignature) stave.addTimeSignature(s.meter.label)
  stave.setContext(context).draw()

  // An empty passage is a legitimate state — a drill before the first note is
  // chosen — and should show a bare staff rather than throw.
  if (specs.length === 0) return

  const staveNotes = specs.map((spec) => buildStaveNote(spec, s.clef))

  const highlight = s.highlightIndex
  if (highlight !== null && highlight >= 0 && highlight < staveNotes.length) {
    staveNotes[highlight]?.setStyle({
      fillStyle: HIGHLIGHT_COLOUR,
      strokeStyle: HIGHLIGHT_COLOUR,
    })
  }

  // Beams are generated before formatting because generating them fixes stem
  // directions, which formatting then needs.
  const groups = beamGroupFractions(s.meter).map((g) => new Fraction(g.numerator, g.denominator))
  const beams = Beam.generateBeams(staveNotes, { groups })

  // How many bars of music this actually is, so the formatter distributes width
  // over the real content. SOFT mode keeps an incomplete or overfull bar from
  // throwing — the player is allowed to be mid-edit.
  const total = barTotal(s.events)
  const bars = Math.max(
    1,
    Math.ceil((total.n * s.meter.barValue.d) / (total.d * s.meter.barValue.n)),
  )
  const voice = new Voice({ numBeats: s.meter.numerator * bars, beatValue: s.meter.denominator })
  voice.setMode(Voice.Mode.SOFT)
  voice.addTickables(staveNotes)

  new Formatter().joinVoices([voice]).formatToStave([voice], stave)
  voice.draw(context, stave)
  for (const beam of beams) beam.setContext(context).draw()

  // Ties come last: they need the x positions that formatting produced.
  for (const group of tieGroups(s.events)) {
    for (let i = 0; i + 1 < group.length; i += 1) {
      const from = group[i]
      const to = group[i + 1]
      if (from === undefined || to === undefined) continue
      const firstNote = staveNotes[from]
      const lastNote = staveNotes[to]
      if (firstNote === undefined || lastNote === undefined) continue
      new StaveTie({ firstNote, lastNote, firstIndexes: [0], lastIndexes: [0] })
        .setContext(context)
        .draw()
    }
  }
}

export default function Staff(props: StaffProps): JSX.Element {
  let host: HTMLDivElement | undefined
  let disposed = false
  onCleanup(() => {
    disposed = true
  })

  createEffect(() => {
    const snapshot: StaffSnapshot = {
      events: props.events,
      meter: props.meter,
      key: props.key,
      pitches: props.pitches,
      fingering: props.fingering,
      bowings: props.bowings,
      clef: props.clef ?? 'alto',
      showTimeSignature: props.showTimeSignature ?? true,
      highlightIndex: props.highlightIndex ?? null,
      width: props.width,
    }

    void loadNotationFonts().then(() => {
      const element = host
      if (disposed || element === undefined) return
      // Clear first, or every redraw stacks another SVG inside the host.
      element.replaceChildren()
      try {
        render(element, snapshot)
        delete element.dataset.staffError
      } catch {
        // A malformed passage must not take the page down with it. The staff
        // goes blank and says so in the DOM, which is enough for a test or a
        // dev tools poke without shipping a console message.
        element.replaceChildren()
        element.dataset.staffError = 'true'
      }
    })
  })

  // Mobile first: a bar of sixteenths is wider than a phone, so the staff gets
  // its own horizontal scroller instead of widening the whole page.
  return (
    <div class="staff" style={{ 'overflow-x': 'auto', 'max-width': '100%' }}>
      <div
        ref={(element) => {
          host = element
        }}
        class="staff-canvas"
      />
    </div>
  )
}
