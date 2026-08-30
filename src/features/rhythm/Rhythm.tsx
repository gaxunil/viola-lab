import { For, Show, createMemo, createSignal, onCleanup } from 'solid-js'
import { COMMON_METERS, type Meter } from '@core/rhythm/meter'
import { type RhythmPreset, presetsForMeter } from '@core/rhythm/presets'
import { formatDuration } from '@core/rhythm/duration'
import { countBar, countRhythm, countingAdvice, pulseIndexAt } from '@core/rhythm/counting'
import { compileRhythm } from '@core/compile/rhythm'
import { clampBpm, tempoFromBeat } from '@core/tempo'
import { majorKeyAtFifths } from '@core/key/key'
import { createAudioSystem } from '@audio/index'
import { createTransportState } from '@state/useTransport'
import Staff from '@components/notation/Staff'
import { followStaff } from '@components/notation/useStaffFollow'

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
  // Looping is how you actually learn a rhythm — you play it round and round
  // until it stops needing counting.
  const [loop, setLoop] = createSignal(true)
  const [staffHost, setStaffHost] = createSignal<HTMLDivElement | undefined>()

  const meter = (): Meter => COMMON_METERS[meterIndex()] ?? COMMON_METERS[0]!

  const presets = createMemo(() => presetsForMeter(meter()))

  const counted = createMemo(() => countBar(meter()))
  /** The syllables belonging to one felt beat. */
  const countForBeat = (beat: number) => counted().filter((pulse) => pulse.beat === beat)

  const preset = createMemo<RhythmPreset | null>(() => {
    const list = presets()
    const chosen = list.find((p) => p.id === presetId())
    return chosen ?? list[0] ?? null
  })

  // The notation key is immaterial for an unpitched rhythm drill, but the staff
  // still needs one; C major keeps the stave clean of accidentals.
  const notationKey = majorKeyAtFifths(0)

  /**
   * Which syllable is being said right now.
   *
   * Derived from the transport's tick rather than from the note index, because
   * the count runs on every subdivision while the notes do not: a dotted quarter
   * covers three syllables, and the highlight has to walk all three.
   */
  const activePulse = createMemo(() => {
    const current = preset()
    const position = signals.position()
    if (!current || !position || !signals.isPlaying()) return null

    const m = current.meter
    // The exercise starts after the count-in bar.
    const bodyTick = position.tick - m.barTicks
    if (bodyTick < 0) return null

    const inBar = ((bodyTick % m.barTicks) + m.barTicks) % m.barTicks
    return pulseIndexAt(m, inBar)
  })

  followStaff({
    host: staffHost,
    index: () => signals.uiIndex(),
    total: () => preset()?.events.length ?? 0,
    active: () => signals.isPlaying(),
  })

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
      loop: loop(),
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
          {/* Just the time signature. A dropdown is for choosing, not explaining
              — the explanation gets its own line below, where there is room. */}
          <For each={COMMON_METERS}>{(m, i) => <option value={i()}>{m.label}</option>}</For>
        </select>
      </label>

      <p class="meter-explain">{meter().description}</p>

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
            <div class="staff-wrap" ref={setStaffHost}>
              <Staff
                events={current.events}
                meter={current.meter}
                key={notationKey}
                showTimeSignature={true}
                highlightIndex={signals.isPlaying() ? signals.uiIndex() : null}
              />
            </div>
            {/* How to say it out loud. The syllables you only think are
                dimmed, which is what the brackets mean on paper. */}
            <div class="count-line" aria-label={`count: ${countRhythm(current.meter, current.events).map((p) => p.say).join(' ')}`}>
              <For each={countRhythm(current.meter, current.events)}>
                {(pulse, i) => (
                  <span
                    class="count"
                    classList={{
                      now: activePulse() === i(),
                      strike: pulse.role === 'strike',
                      hold: pulse.role === 'hold',
                      silent: pulse.role === 'rest',
                      beat: pulse.isBeat,
                    }}
                    title={
                      pulse.role === 'strike'
                        ? 'play here'
                        : pulse.role === 'hold'
                          ? 'still ringing — say it, do not play it'
                          : 'silent'
                    }
                  >
                    {pulse.say}
                  </span>
                )}
              </For>
            </div>

            <p class="teaching">{current.note}</p>
            <p class="teaching muted-block">{countingAdvice(current.meter)}</p>

            <details class="explainer">
              <summary>What does the dot do?</summary>
              <p>
                A dot adds half of the note back onto itself. A quarter note lasts one beat,
                so a <strong>dotted</strong> quarter lasts one and a half — a quarter plus an
                eighth. A dotted half is three beats rather than two.
              </p>
              <p>
                It exists because some lengths have no note of their own. There is no single
                symbol for three eighths, so you write an eighth-plus-a-quarter tied together,
                or you write one dotted quarter and save the ink. They mean exactly the same
                thing.
              </p>
              <Show when={current.meter.class === 'compound'}>
                <p>
                  This is why {current.meter.label} counts in dotted beats. A bar holds{' '}
                  {current.meter.numerator} eighths, and they group into{' '}
                  {current.meter.beats} beats of three — and three eighths is precisely what a
                  dotted quarter is. The dot is not decoration here; it is the only way to
                  write the beat.
                </p>
              </Show>
            </details>

            <Show when={current.meter.class === 'compound'}>
              <details class="explainer">
                <summary>Is this just triplets?</summary>
                <p>
                  It sounds identical, and that is a fair thing to notice. The difference is
                  which division counts as normal.
                </p>
                <p>
                  A <strong>triplet</strong> is borrowed: three notes squeezed into the space
                  of two. That is why it is drawn with a bracket and a little 3 — it is being
                  marked as an exception to the beat around it.
                </p>
                <p>
                  In {current.meter.label} nothing is borrowed. Three eighths to a beat IS the
                  beat, so there is no bracket and no 3, and the staff above has none. The
                  exception here would run the other way: two in the space of three, which is
                  called a duplet and gets the bracket instead.
                </p>
                <p class="aside">
                  So the choice is a statement about what the piece is mostly doing. Mostly in
                  threes, write {current.meter.label} and stop drawing brackets. Mostly in twos
                  with the occasional three, write{' '}
                  {current.meter.numerator === 12 ? '4/4' : current.meter.numerator === 6 ? '2/4' : '3/4'}{' '}
                  and bracket the triplets.
                </p>
              </details>
            </Show>
          </>
        )}
      </Show>

      {/* The same beat display as the metronome: one capsule per beat, a pip
          per subdivision, so where the beat lands is visible and not just
          audible. */}
      <div class="beat-groups" role="group" aria-label="beats in the bar">
        <For each={meter().grouping}>
          {(_group, beat) => (
            <span
              class="beat-group"
              classList={{
                active: signals.isPlaying() && signals.beat() === beat(),
                strong: meter().accents[beat()] === 'strong',
                medium: meter().accents[beat()] === 'medium',
              }}
            >
              <For each={countForBeat(beat())}>
                {(pulse, i) => (
                  <span class="pulse">
                    <span class="pip" classList={{ head: i() === 0 }} aria-hidden="true" />
                    <span class="say" classList={{ head: i() === 0 }}>
                      {pulse.say}
                    </span>
                  </span>
                )}
              </For>
            </span>
          )}
        </For>
      </div>

      <label class="field">
        <span>
          Tempo — {bpm()} {formatDuration(meter().beatUnit).replace(' note', '')}
          {bpm() === 1 ? '' : 's'} per minute
        </span>
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
        <span>Loop it</span>
      </label>

      <button class="primary" onClick={toggle}>
        {signals.isPlaying() ? 'Stop' : 'Play'}
      </button>

      <p class="meta">
        <Show when={signals.isCountIn()}>counting in · </Show>
        {meter().formalName}
      </p>
    </section>
  )
}
