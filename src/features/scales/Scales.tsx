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
      maxPosition: maxPosition(),
    })
  })

  /**
   * Why the run does not fit where it does not fit.
   *
   * Deduplicated by reason: starting on B flat 4 and B flat 5 both fail for the
   * same reason, and saying so three times is noise rather than teaching.
   */
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
      direction: 'up-down',
      noteValue: dur('eighth'),
      meter: meter(4, 4),
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

            {/* The step pattern, which is what she asked to see. */}
            <div class="steps" aria-label="whole and half step pattern">
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
          </>
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
              highlightIndex={signals.isPlaying() ? signals.noteIndex() : null}
            />
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
