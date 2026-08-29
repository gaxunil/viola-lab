import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js'
import { COMMON_METERS, type Meter } from '@core/rhythm/meter'
import { type RhythmPreset, presetsForMeter } from '@core/rhythm/presets'
import { compileRhythm } from '@core/compile/rhythm'
import { clampBpm, tempoFromBeat } from '@core/tempo'
import { majorKeyAtFifths } from '@core/key/key'
import { createAudioSystem } from '@audio/index'
import { createTransportState } from '@state/useTransport'
import Staff from '@components/notation/Staff'

/**
 * Hear a rhythm, then read it.
 *
 * The presets lead rather than an editor, because a blank canvas is a bad
 * starting point when the thing you are learning is what a meter even feels
 * like. Every preset carries a sentence about what to listen for, which is the
 * actual teaching content — the notation is there to connect the sound to the
 * page she reads from.
 */
export default function Rhythm() {
  const system = createAudioSystem()
  const signals = createTransportState(system.transport)

  // 12/8 first: it is the meter she asked about, and it is the one that most
  // repays hearing rather than being told.
  const [meterIndex, setMeterIndex] = createSignal(
    Math.max(0, COMMON_METERS.findIndex((m) => m.label === '12/8')),
  )
  const [presetId, setPresetId] = createSignal<string | null>(null)
  const [bpm, setBpm] = createSignal(80)
  const [withClick, setWithClick] = createSignal(true)

  const meter = (): Meter => COMMON_METERS[meterIndex()] ?? COMMON_METERS[0]!

  const presets = createMemo(() => presetsForMeter(meter()))

  const preset = createMemo<RhythmPreset | null>(() => {
    const list = presets()
    const chosen = list.find((p) => p.id === presetId())
    return chosen ?? list[0] ?? null
  })

  // The notation key is immaterial for an unpitched rhythm drill, but the staff
  // still needs one; C major keeps the stave clean of accidentals.
  const notationKey = majorKeyAtFifths(0)

  onCleanup(() => {
    signals.dispose()
    system.dispose()
  })

  async function play() {
    const current = preset()
    if (!current) return
    const score = compileRhythm({
      meter: current.meter,
      events: current.events,
      withClick: withClick(),
      countInBars: 1,
    })
    await system.play(score, tempoFromBeat(bpm(), current.meter.beatUnit))
  }

  function toggle() {
    if (signals.isPlaying()) system.stop()
    else void play()
  }

  function choose(id: string) {
    setPresetId(id)
    if (signals.isPlaying()) system.stop()
  }

  return (
    <section class="panel">
      <h2>Rhythm</h2>

      <label class="field">
        <span>Time signature</span>
        <select
          value={meterIndex()}
          onChange={(e) => {
            setMeterIndex(Number(e.currentTarget.value))
            setPresetId(null)
            system.stop()
          }}
        >
          <For each={COMMON_METERS}>
            {(m, i) => (
              <option value={i()}>
                {m.label} — {m.description}
              </option>
            )}
          </For>
        </select>
      </label>

      <div class="preset-list" role="listbox" aria-label="rhythm examples">
        <For each={presets()}>
          {(item) => (
            <button
              type="button"
              role="option"
              aria-selected={item.id === preset()?.id}
              class="preset"
              classList={{ chosen: item.id === preset()?.id }}
              onClick={() => choose(item.id)}
            >
              {item.name}
            </button>
          )}
        </For>
      </div>

      <Show when={preset()} keyed>
        {(current) => (
          <>
            <div class="staff-wrap">
              <Staff
                events={current.events}
                meter={current.meter}
                key={notationKey}
                showTimeSignature={true}
                highlightIndex={signals.isPlaying() ? signals.noteIndex() : null}
              />
            </div>
            <p class="teaching">{current.note}</p>
          </>
        )}
      </Show>

      <div class="beats" role="group" aria-label="beats in the bar">
        <For each={meter().accents}>
          {(accent, index) => (
            <span
              class="dot"
              classList={{
                active: signals.isPlaying() && signals.beat() === index(),
                strong: accent === 'strong',
                medium: accent === 'medium',
              }}
              aria-hidden="true"
            />
          )}
        </For>
      </div>

      <label class="field">
        <span>Tempo — {bpm()} beats per minute</span>
        <input
          type="range"
          min="30"
          max="200"
          value={bpm()}
          onInput={(e) => setBpm(clampBpm(Number(e.currentTarget.value)))}
        />
      </label>

      <label class="checkbox">
        <input
          type="checkbox"
          checked={withClick()}
          onChange={(e) => setWithClick(e.currentTarget.checked)}
        />
        <span>Play a click underneath</span>
      </label>

      <button class="primary" onClick={toggle}>
        {signals.isPlaying() ? 'Stop' : 'Play'}
      </button>

      <p class="meta">
        <Show when={signals.isCountIn()}>counting in · </Show>
        {meter().label} · {meter().description} · grouped {meter().grouping.join('+')}
      </p>
    </section>
  )
}
