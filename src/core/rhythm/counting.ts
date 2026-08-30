/**
 * How to count a bar out loud.
 *
 * The thing this gets right, and that trips people up, is that compound meters
 * divide in THREE. "One-ee-and-a" is a four-way split — it is how you count
 * sixteenths in 4/4 — and using it for 6/8 or 12/8 quietly teaches the wrong
 * number of subdivisions. Compound beats want three syllables: "one and a".
 *
 * The other common failure is counting all twelve eighths of a 12/8 bar. It is
 * not wrong, and it is useful when learning a rhythm slowly, but a bar counted
 * one-to-twelve never starts to FEEL like four beats, which is the whole point
 * of writing it in 12/8 rather than in eighths.
 */

import type { Meter } from './meter'
import { type RhythmEvent, placeEvents } from './bar'

export type CountingStyle = 'syllables' | 'numbers'

export interface CountedPulse {
  /** What to say: '1', '&', 'a', or a plain pulse number. */
  readonly say: string
  /** True on the first pulse of a felt beat. */
  readonly isBeat: boolean
  readonly beat: number
}

/**
 * Syllables for the pulses within one beat.
 *
 * Two pulses is a simple beat and takes "&". Three is a compound beat and takes
 * "& a" — three sounds, not four. Anything longer falls back to counting the
 * pulses, which is honest rather than inventing vocabulary.
 */
function subdivisionSyllables(pulses: number): string[] {
  switch (pulses) {
    case 1:
      return []
    case 2:
      return ['&']
    case 3:
      return ['&', 'a']
    case 4:
      return ['e', '&', 'a']
    default:
      return Array.from({ length: pulses - 1 }, (_, i) => String(i + 2))
  }
}

/**
 * The spoken count for a whole bar.
 *
 * In 'syllables' style each beat is numbered and its subdivisions get "& a", so
 * 12/8 reads 1 & a 2 & a 3 & a 4 & a. In 'numbers' style every notated pulse is
 * numbered — 1 to 12 — which is the slow-practice count.
 */
export function countBar(meter: Meter, style: CountingStyle = 'syllables'): CountedPulse[] {
  const out: CountedPulse[] = []

  if (style === 'numbers') {
    let pulse = 0
    for (const [beat, group] of meter.grouping.entries()) {
      for (let i = 0; i < group; i++) {
        out.push({ say: String(pulse + 1), isBeat: i === 0, beat })
        pulse += 1
      }
    }
    return out
  }

  for (const [beat, group] of meter.grouping.entries()) {
    // A simple meter's grouping counts beats, not subdivisions, so its beat
    // still divides in two even though the grouping says one.
    const pulses = group === 1 ? 2 : group
    out.push({ say: String(beat + 1), isBeat: true, beat })
    for (const syllable of subdivisionSyllables(pulses)) {
      out.push({ say: syllable, isBeat: false, beat })
    }
  }
  return out
}

/** One line, for showing the count as a sentence: '1 & a 2 & a 3 & a 4 & a'. */
export const countLine = (meter: Meter, style: CountingStyle = 'syllables'): string =>
  countBar(meter, style)
    .map((pulse) => pulse.say)
    .join(' ')

/**
 * A sentence naming how this meter is usually counted, and the trap if there is
 * one.
 */
export function countingAdvice(meter: Meter): string {
  if (meter.class === 'compound') {
    return `Count "${countLine(meter)}" — three sounds to a beat, not four. Counting all ${meter.numerator} eighths works when you are learning it slowly, but it never starts to feel like ${meter.beats} beats.`
  }
  if (meter.class === 'asymmetric') {
    return `Count "${countLine(meter)}". The beats are deliberately uneven — ${meter.grouping.join(' + ')} — so one of them is longer than the others.`
  }
  return `Count "${countLine(meter)}", with the "&" exactly halfway between the numbers.`
}

export type PulseRole = 'strike' | 'hold' | 'rest'

export interface CountedRhythmPulse extends CountedPulse {
  /**
   * 'strike' — say it and play it. 'hold' — say it (or think it) while the
   * previous note is still ringing. 'rest' — say it, play nothing.
   */
  readonly role: PulseRole
  /** True when a note begins between this pulse and the next. */
  readonly offBeatNote: boolean
}

/**
 * The spoken count for a specific rhythm, marking which syllables you actually
 * play on.
 *
 * This is what makes a dotted note make sense. In 12/8 a dotted quarter on beat
 * one is "ONE (& a)" — you say all three, you play only the first, and the note
 * is still sounding through the other two. Seeing that written out is usually
 * the moment the dot stops being mysterious.
 *
 * Notes that fall BETWEEN pulses (a sixteenth in a compound bar, say) cannot be
 * given a syllable of their own without inventing vocabulary, so they are
 * flagged rather than faked — the caller can say "there is something between
 * these two counts" honestly.
 */
export function countRhythm(
  meter: Meter,
  events: readonly RhythmEvent[],
  style: CountingStyle = 'syllables',
): CountedRhythmPulse[] {
  const grid = countBar(meter, style)
  const placed = placeEvents(meter, events)

  // Where each pulse sits, in ticks from the bar line.
  const pulseTicks: number[] = []
  {
    let tick = 0
    for (const group of meter.grouping) {
      const pulses = group === 1 ? 2 : group
      const step = (group * meter.pulseTicks) / pulses
      for (let i = 0; i < pulses; i++) {
        pulseTicks.push(Math.round(tick + i * step))
      }
      tick += group * meter.pulseTicks
    }
  }

  return grid.map((pulse, i) => {
    const at = pulseTicks[i] ?? 0
    const next = pulseTicks[i + 1] ?? meter.barTicks

    const starting = placed.find((p) => p.onsetTicks === at)
    const between = placed.some((p) => p.onsetTicks > at && p.onsetTicks < next)
    const covering = placed.find(
      (p) => p.onsetTicks <= at && at < p.onsetTicks + p.durationTicks,
    )

    let role: PulseRole = 'rest'
    if (starting) role = starting.event.kind === 'rest' ? 'rest' : 'strike'
    else if (covering && covering.event.kind === 'note') role = 'hold'

    return { ...pulse, role, offBeatNote: between }
  })
}

/**
 * The count as a line, bracketing the syllables you say but do not play.
 *
 * Parentheses rather than capitals, because "1" and "&" have no upper case and
 * a convention that silently fails on two thirds of the syllables is no
 * convention at all. A dotted quarter in 12/8 comes out as "1 (& a)", which is
 * how a teacher writes it on the page anyway.
 */
export function countRhythmLine(meter: Meter, events: readonly RhythmEvent[]): string {
  const parts: string[] = []
  let held: string[] = []

  const flush = () => {
    if (held.length === 0) return
    // One bracket around the whole run, not around each syllable: "1 (& a)"
    // rather than "1 (&) (a)".
    parts.push(`(${held.join(' ')})`)
    held = []
  }

  for (const pulse of countRhythm(meter, events)) {
    if (pulse.role === 'strike') {
      flush()
      parts.push(pulse.say)
    } else {
      held.push(pulse.say)
    }
  }
  flush()
  return parts.join(' ')
}
