import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js'
import { COMMON_METERS, type Meter } from '@core/rhythm/meter'
import { compileMetronome } from '@core/compile/metronome'
import { bpmInBeat, clampBpm, tempoFromBeat } from '@core/tempo'
import { formatDuration } from '@core/rhythm/duration'
import { createAudioSystem } from '@audio/index'
import { createTransportState } from '@state/useTransport'

/**
 * The first thing in this app that makes a sound.
 *
 * Deliberately the metronome rather than a scale: it exercises the whole chain
 * end to end — compile a score, schedule it, sound it, and light the beat in
 * sync — while depending on no audio assets at all. That makes it the right
 * thing to put on a phone first, because the riskiest question in the project is
 * whether iOS will play anything with the ring/silent switch on.
 */
export default function Metronome() {
  const system = createAudioSystem()
  const signals = createTransportState(system.transport)

  const [meterIndex, setMeterIndex] = createSignal(6) // 12/8, the one she asked about
  const [bpm, setBpm] = createSignal(90)
  const [unlocked, setUnlocked] = createSignal(false)

  const meter = (): Meter => COMMON_METERS[meterIndex()] ?? COMMON_METERS[0]!

  const tempoLabel = createMemo(() => {
    const beatName = formatDuration(meter().beatUnit).replace(' note', '')
    return `${bpm()} ${beatName} per minute`
  })

  onCleanup(() => {
    signals.dispose()
    system.dispose()
  })

  async function toggle() {
    if (signals.isPlaying()) {
      system.stop()
      return
    }
    const m = meter()
    const score = compileMetronome({ meter: m, bars: 4, loop: true })
    await system.play(score, tempoFromBeat(bpm(), m.beatUnit))
    setUnlocked(system.engine.state === 'ready')
  }

  function changeTempo(next: number) {
    const value = clampBpm(next)
    setBpm(value)
    if (signals.isPlaying()) {
      system.transport.setTempo(tempoFromBeat(value, meter().beatUnit).quarterBpm)
    }
  }

  return (
    <section class="panel">
      <h2>Metronome</h2>

      <div class="beats" role="group" aria-label="beats in the bar">
        <For each={meter().accents}>
          {(accent, index) => (
            <span
              class="dot"
              classList={{
                active: signals.beat() === index(),
                strong: accent === 'strong',
                medium: accent === 'medium',
              }}
              aria-hidden="true"
            />
          )}
        </For>
      </div>

      <p class="readout" aria-live="polite">
        <Show when={signals.isPlaying()} fallback={<span class="muted">stopped</span>}>
          <Show when={signals.isCountIn()} fallback={<>beat {signals.beat() + 1}</>}>
            counting in
          </Show>
        </Show>
      </p>

      <label class="field">
        <span>Time signature</span>
        <select
          value={meterIndex()}
          onChange={(e) => setMeterIndex(Number(e.currentTarget.value))}
        >
          <For each={COMMON_METERS}>{(m, i) => <option value={i()}>{m.label}</option>}</For>
        </select>
      </label>

      <label class="field">
        <span>Tempo — {tempoLabel()}</span>
        <input
          type="range"
          min="20"
          max="300"
          value={bpm()}
          onInput={(e) => changeTempo(Number(e.currentTarget.value))}
        />
      </label>

      <button class="primary" onClick={() => void toggle()}>
        {signals.isPlaying() ? 'Stop' : 'Start'}
      </button>

      <Show when={unlocked() && system.engine.silentSwitchRisk}>
        <p class="hint">
          Hearing nothing? On an iPhone, check the ring/silent switch on the left edge —
          it mutes this kind of sound even when the volume is up.
        </p>
      </Show>

      <p class="meter-explain">{meter().description}</p>

      <p class="meta">
        {meter().formalName} · grouped {meter().grouping.join('+')}
        <Show when={bpmInBeat(tempoFromBeat(bpm(), meter().beatUnit), meter().beatUnit) !== bpm()}>
          {' '}· internally {Math.round(tempoFromBeat(bpm(), meter().beatUnit).quarterBpm)} qpm
        </Show>
      </p>
    </section>
  )
}
