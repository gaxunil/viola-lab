import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js'
import { type Letter, type PitchClass, formatPitch, pc, toMidi } from '@core/pitch/pitch'
import { CIRCLE_OF_FIFTHS } from '@core/key/key'
import { SCALE_TYPES, SCALE_TYPE_LIST, type ScaleTypeId } from '@core/scale/scaleTypes'
import { tryBuildScale } from '@core/scale/scale'
import { bestRange, fingerScale, rangeOptions } from '@core/viola/scaleFingering'
import { compileScale } from '@core/compile/scale'
import { clampBpm, tempoFromBeat } from '@core/tempo'
import { dur } from '@core/rhythm/duration'
import { meter } from '@core/rhythm/meter'
import { createAudioSystem } from '@audio/index'
import { createTransportState } from '@state/useTransport'
import Fingerboard from '@components/fingerboard/Fingerboard'
import Staff from '@components/notation/Staff'
import { followStaff } from '@components/notation/useStaffFollow'
import { note } from '@core/rhythm/bar'
import { realize } from '@core/scale/scale'

type Octaves = 1 | 2 | 3

/**
 * Every key that can actually be written, in circle-of-fifths order.
 *
 * Both spellings of the enharmonic keys are offered rather than one of each
 * pair. F sharp major and G flat major are the same twelve sounds but genuinely
 * different keys on the page — six sharps against six flats — and which one a
 * piece is written in is exactly the kind of thing this app exists to explain.
 * Picking one and hiding the other would teach that the choice does not exist.
 */
interface RootChoice {
  readonly tonic: PitchClass
  readonly fifths: number
  readonly name: string
  /** '6 sharps', '3 flats', 'no sharps or flats' */
  readonly signature: string
  /** The other spelling of the same sounds, where one is writable. */
  readonly twin: string | null
}

function describeSignature(count: number, accidental: string): string {
  if (count === 0) return 'no sharps or flats'
  return `${count} ${accidental}${count === 1 ? '' : 's'}`
}

const ROOTS: readonly RootChoice[] = CIRCLE_OF_FIFTHS.map((entry) => {
  // Twelve fifths is an enharmonic round trip, so a key has a writable twin only
  // when stepping a full turn lands back inside the seven-accidental range.
  const twinFifths = entry.fifths > 0 ? entry.fifths - 12 : entry.fifths + 12
  const twin = CIRCLE_OF_FIFTHS.find((e) => e.fifths === twinFifths && e.fifths !== entry.fifths)

  return {
    tonic: entry.major.tonic,
    fifths: entry.fifths,
    name: formatPitch(entry.major.tonic),
    signature: describeSignature(
      entry.major.signature.letters.length,
      entry.major.signature.accidental,
    ),
    twin: twin ? formatPitch(twin.major.tonic) : null,
  }
})

/**
 * Pick a key, hear the scale, see where it lives.
 *
 * Three things share one screen deliberately, because the point is the
 * connection between them: the whole/half step pattern (why this scale sounds
 * the way it does), the key signature (how it is written), and the fingerboard
 * (where it actually is under her hand, and where it shifts).
 */
export default function Scales() {
  const system = createAudioSystem()
  const signals = createTransportState(system.transport)

  const [rootIndex, setRootIndex] = createSignal(ROOTS.findIndex((r) => r.fifths === 0))
  const [typeId, setTypeId] = createSignal<ScaleTypeId>('major')
  const [octaves, setOctaves] = createSignal<Octaves>(2)
  const [bpm, setBpm] = createSignal(72)
  const [droneOn, setDroneOn] = createSignal(false)
  const [loop, setLoop] = createSignal(false)

  const rootChoice = () => ROOTS[rootIndex()]
  const root = () => rootChoice()?.tonic ?? pc('C' as Letter)

  /**
   * How high up the fingerboard to allow the search to go.
   *
   * Two octaves live comfortably below 5th position. Three octaves simply do not
   * — a three-octave A major tops out around 11th position on the A string, and
   * capping the search lower would report a scale she is expected to play as
   * impossible.
   */
  const maxPosition = () => (octaves() === 3 ? 12 : 5)

  /**
   * One direction, used by both the fingering and the playback.
   *
   * These must not be decided in two places. The plan supplies the dots the
   * fingerboard highlights, and playback supplies the index into them; if the
   * plan is built ascending while the scale plays up AND down, every index past
   * the top note has no dot to light and the descent goes dark.
   */
  const DIRECTION = 'up-down' as const

  const scale = createMemo(() => tryBuildScale(root(), SCALE_TYPES[typeId()]))

  const range = createMemo(() => {
    const s = scale()
    return s ? bestRange(s, octaves(), { maxPosition: maxPosition() }) : null
  })

  const plan = createMemo(() => {
    const s = scale()
    const r = range()
    if (!s || !r) return undefined
    return fingerScale(s, {
      startOctave: r.start.octave,
      octaves: octaves(),
      direction: DIRECTION,
      maxPosition: maxPosition(),
    })
  })

  /**
   * Why the run does not fit where it does not fit.
   *
   * Deduplicated by reason: starting on B flat 4 and B flat 5 both fail for the
   * same reason, and saying so three times is noise rather than teaching.
   */
  /**
   * The scale as she would read it: alto clef, with the key signature.
   *
   * This is the point of contact between the theory and the page. Seeing that
   * E flat major carries three flats ON THE CLEF, rather than an accidental
   * beside every altered note, is most of what a key signature IS.
   */
  const notated = createMemo(() => {
    const s = scale()
    const r = range()
    if (!s || !r) return null
    const pitches = realize(s, {
      startOctave: r.start.octave,
      octaves: octaves(),
      direction: DIRECTION,
    })
    return {
      key: s.key,
      pitches,
      // One notehead per pitch; the rhythm is irrelevant here, so plain quarters.
      events: pitches.map(() => note(dur('quarter'))),
    }
  })

  /**
   * The note sounding right now, and which way the scale is going.
   *
   * Watching a dot light up tells her WHERE; it does not tell her WHAT. Naming
   * the note as it sounds is what connects the diagram to the thing she is
   * trying to learn, and the direction matters because melodic minor genuinely
   * changes on the way down.
   */
  const nowPlaying = createMemo(() => {
    const current = plan()
    const index = signals.uiIndex()
    if (!current || index === null || !signals.isPlaying()) return null

    const fingered = current.notes[index]
    if (!fingered) return null

    // The turning point is the highest note of the run.
    let peak = 0
    for (const [i, n] of current.notes.entries()) {
      const best = current.notes[peak]
      if (best && toMidi(n.pitch) > toMidi(best.pitch)) peak = i
    }

    return {
      name: formatPitch(fingered.pitch),
      finger: fingered.placement.finger,
      string: fingered.placement.string,
      isOpen: fingered.placement.isOpen,
      direction: index < peak ? 'ascending' : index > peak ? 'descending' : 'the top',
      degree: null as number | null,
    }
  })

  /**
   * Keep the sounding note in view as the scale runs past the edge of the panel.
   *
   * Position is estimated from the note's index rather than by measuring the
   * rendered notehead: VexFlow lays notes out evenly here, the container is the
   * thing that scrolls, and reaching into the SVG to find a glyph would couple
   * this to VexFlow's internals for a smoother result nobody would notice.
   */
  const [staffHost, setStaffHost] = createSignal<HTMLDivElement | undefined>()

  followStaff({
    host: staffHost,
    index: () => signals.uiIndex(),
    total: () => notated()?.pitches.length ?? 0,
    active: () => signals.isPlaying(),
  })

  const blocked = createMemo(() => {
    const s = scale()
    if (!s) return []

    const seen = new Set<string>()
    const out: Array<{ start: string; reason: string }> = []

    for (const option of rangeOptions(s, octaves(), { maxPosition: maxPosition() })) {
      if (option.feasible || !option.reason) continue
      if (seen.has(option.reason)) continue
      seen.add(option.reason)
      out.push({ start: formatPitch(option.start), reason: option.reason })
    }
    return out
  })

  onCleanup(() => {
    signals.dispose()
    system.dispose()
  })

  async function play() {
    const s = scale()
    const r = range()
    if (!s || !r) return
    const { score } = compileScale({
      scale: s,
      startOctave: r.start.octave,
      octaves: octaves(),
      direction: DIRECTION,
      noteValue: dur('eighth'),
      meter: meter(4, 4),
      loop: loop(),
    })
    await system.play(score, tempoFromBeat(bpm(), dur('quarter')))
  }

  function toggle() {
    if (signals.isPlaying()) system.stop()
    else void play()
  }

  async function toggleDrone() {
    const r = range()
    if (!r) return
    if (droneOn()) {
      setDroneOn(false)
      await system.setDrone(null)
      return
    }
    setDroneOn(true)
    await system.setDrone({ rootMidi: toMidi(r.start), withFifth: true, fifthTuning: 'just' })
  }

  return (
    <section class="panel">
      <h2>Keys &amp; scales</h2>

      <div class="row">
        <label class="field">
          <span>Key</span>
          <select value={rootIndex()} onChange={(e) => setRootIndex(Number(e.currentTarget.value))}>
            <For each={ROOTS}>
              {(r, i) => (
                <option value={i()}>
                  {r.name}
                  {r.twin ? ` / ${r.twin}` : ''} — {r.signature}
                </option>
              )}
            </For>
          </select>
        </label>

        <label class="field">
          <span>Scale</span>
          <select
            value={typeId()}
            onChange={(e) => setTypeId(e.currentTarget.value as ScaleTypeId)}
          >
            <For each={SCALE_TYPE_LIST}>
              {(t) => <option value={t.id}>{t.name}</option>}
            </For>
          </select>
        </label>
      </div>

      <Show
        when={scale()}
        fallback={<p class="teaching">That root cannot be written for this scale — try another.</p>}
        keyed
      >
        {(current) => (
          <>
            <p class="scale-name">
              {current.name}
              <Show when={rootChoice()?.twin}>
                {(twin) => (
                  <span class="muted"> · same sounds as {twin()}{' '}{current.type.name.toLowerCase()}</span>
                )}
              </Show>
              <span class="muted">
                {' '}· {current.key.signature.letters.length === 0
                  ? 'no sharps or flats'
                  : `${current.key.signature.letters.length} ${current.key.signature.accidental}${
                      current.key.signature.letters.length === 1 ? '' : 's'
                    }`}
              </span>
            </p>

            {/* The pattern on its own line, big enough to read at a glance and
                colour-coded, because the difference between a whole step and a
                half step IS the shape of the scale. Never wraps: a broken
                pattern is much harder to read as one shape. */}
            <div
              class="pattern"
              aria-label={`step pattern: ${current.steps.map((x) => x.name).join(', ')}`}
            >
              <For each={current.steps}>
                {(step, i) => (
                  <>
                    <span
                      class="chip"
                      classList={{
                        w: step.symbol === 'W',
                        h: step.symbol === 'H',
                        a2: step.isAugmented,
                      }}
                      title={step.name}
                    >
                      {step.display}
                    </span>
                    <Show when={i() < current.steps.length - 1}>
                      <span class="chip-sep" aria-hidden="true">
                        –
                      </span>
                    </Show>
                  </>
                )}
              </For>
            </div>

            <div class="steps" aria-label="the notes, with the step between each">
              <For each={current.degrees}>
                {(degree, i) => (
                  <>
                    <span class="degree">
                      <span class="degree-note">{formatPitch(degree.pitchClass)}</span>
                      <span class="degree-label">{degree.label}</span>
                    </span>
                    <span
                      class="step"
                      classList={{ augmented: current.steps[i()]?.isAugmented === true }}
                      title={current.steps[i()]?.name}
                    >
                      {current.steps[i()]?.display}
                    </span>
                  </>
                )}
              </For>
              <span class="degree">
                <span class="degree-note">{formatPitch(current.tonic)}</span>
                <span class="degree-label">8</span>
              </span>
            </div>

            <Show when={current.steps.some((s) => s.isAugmented)}>
              <p class="teaching">
                That <strong>1½</strong> is an augmented second — three semitones, but only one
                letter name. It is what gives harmonic minor its particular sound, and it is the
                reason this scale is not just natural minor with a raised note.
              </p>
            </Show>

            <p class="teaching">{current.type.blurb}</p>

            {/*
              Collapsed by default so it does not shout at someone who already
              knows, but present on the screen where the question actually comes
              up rather than filed away in a help page.
            */}
            <details class="explainer">
              <summary>What is a key, exactly?</summary>
              <p>
                A key is two things at once: a note that feels like <em>home</em>, and the
                seven notes that belong with it. Play {formatPitch(current.tonic)} major and
                stop on the last note — that settled feeling is the key asserting itself.
                Stop one note early and you can hear it wanting to keep going.
              </p>
              <p>
                Which seven notes belong is decided by the step pattern above. Starting on{' '}
                {formatPitch(current.tonic)} and following it is what forces{' '}
                {current.key.signature.letters.length === 0 ? (
                  <>no sharps or flats at all — which is what makes C major the odd one out</>
                ) : (
                  <>
                    the {current.key.signature.accidental}s on{' '}
                    {current.key.signature.letters.join(', ')}
                  </>
                )}
                . They are not a decision anyone made; they are what the pattern requires.
              </p>
              <p>
                The <strong>key signature</strong> is just shorthand.{' '}
                {current.key.signature.letters.length === 0 ? (
                  <>
                    C major needs none, so the clef stands alone.
                  </>
                ) : (
                  <>
                    Rather than write a {current.key.signature.accidental} beside every{' '}
                    {current.key.signature.letters.join(', ')} in the whole piece, it is
                    written once after the clef and applies all the way through. That is why
                    the staff above shows{' '}
                    {current.key.signature.letters.length}{' '}
                    {current.key.signature.accidental}
                    {current.key.signature.letters.length === 1 ? '' : 's'} and then no
                    accidentals at all.
                  </>
                )}
              </p>
              <p class="aside">
                Careful with one thing: a key is not the same as a scale. The scale is the
                notes in order, which is a practice exercise. The key is the gravity — it is
                still there in a piece that never plays the scale straight through.
              </p>
            </details>
          </>
        )}
      </Show>

      {/* Reserve the row so the panel does not jump when playback starts. */}
      <p class="now-playing" aria-live="polite">
        <Show when={nowPlaying()} fallback={<span class="muted">press play to hear it</span>} keyed>
          {(now) => (
            <>
              <span class="now-note">{now.name}</span>
              <span class="now-detail">
                {now.isOpen ? `open ${now.string}` : `${now.string} string, finger ${now.finger}`}
                {' · '}
                {now.direction}
              </span>
            </>
          )}
        </Show>
      </p>

      <Show when={notated()} keyed>
        {(current) => (
          <div class="staff-wrap" ref={setStaffHost}>
            <Staff
              events={current.events}
              meter={meter(4, 4)}
              key={current.key}
              pitches={current.pitches}
              showTimeSignature={false}
              highlightIndex={signals.isPlaying() ? signals.uiIndex() : null}
            />
          </div>
        )}
      </Show>

      <Show when={plan()} keyed>
        {(current) => (
          <>
            {/* Conditional spread rather than passing undefined: the prop is
                optional, and exactOptionalPropertyTypes distinguishes "absent"
                from "present but undefined". */}
            <Fingerboard
              {...(scale() ? { scale: scale()! } : {})}
              plan={current}
              highlightIndex={signals.isPlaying() ? signals.uiIndex() : null}
            />
            <p class="legend">
              <span class="legend-item">
                <span class="key-dot filled" /> played here
              </span>
              <span class="legend-item">
                <span class="key-dot ghost" /> the same note elsewhere
              </span>
              <span class="legend-item">
                <span class="key-dot tonic" /> the tonic
              </span>
              <span class="legend-item">
                <span class="legend-arc" aria-hidden="true">
                  ⌒
                </span>
                an arc is a shift, labelled with the position it moves into
              </span>
            </p>

            <p class="meta">
              <Show
                when={current.staysInFirstPosition}
                fallback={
                  <>
                    {current.shifts.length} shift{current.shifts.length === 1 ? '' : 's'} · up to{' '}
                    {current.highestPosition}
                    {current.highestPosition === 3 ? 'rd' : 'th'} position
                  </>
                }
              >
                entirely in 1st position
              </Show>
              {' · '}
              {current.stringsUsed.length === 4
                ? 'all four strings'
                : `${current.stringsUsed.join(', ')} strings`}
            </p>
          </>
        )}
      </Show>

      <Show when={blocked().length > 0}>
        <p class="teaching muted-block">
          <For each={blocked()}>
            {(option) => (
              <>
                Starting on {option.start}, {option.reason}.{' '}
              </>
            )}
          </For>
        </p>
      </Show>

      <div class="row">
        <label class="field">
          <span>Octaves</span>
          <select
            value={octaves()}
            onChange={(e) => setOctaves(Number(e.currentTarget.value) as Octaves)}
          >
            <option value={1}>One</option>
            <option value={2}>Two</option>
            <option value={3}>Three</option>
          </select>
        </label>
        <label class="field">
          <span>Tempo — {bpm()}</span>
          <input
            type="range"
            min="40"
            max="160"
            value={bpm()}
            onInput={(e) => setBpm(clampBpm(Number(e.currentTarget.value)))}
          />
        </label>
      </div>

      <Show when={!range()}>
        <p class="teaching muted-block">
          {octaves()} octaves will not fit on the instrument in this key — the top of the run goes
          past where a viola reaches. Try two octaves, or a lower key.
        </p>
      </Show>

      <label class="checkbox">
        <input
          type="checkbox"
          checked={loop()}
          onChange={(e) => {
            setLoop(e.currentTarget.checked)
            // Take effect now rather than on the next press.
            if (signals.isPlaying()) {
              system.stop()
              void play()
            }
          }}
        />
        <span>Loop it — good for playing along, or against the drone</span>
      </label>

      <button class="primary" onClick={toggle} disabled={!range()}>
        {signals.isPlaying() ? 'Stop' : 'Play the scale'}
      </button>

      <button class="secondary" onClick={() => void toggleDrone()} disabled={!range()}>
        {droneOn() ? 'Stop the drone' : 'Hold a drone on the tonic'}
      </button>

      <Show when={droneOn()}>
        <p class="meta">
          Tuned as a pure fifth, so it locks and stops beating when you are in tune — play the
          scale against it and listen for the beats disappearing.
        </p>
      </Show>
    </section>
  )
}
