/**
 * The preset rhythm library, as data.
 *
 * These are the examples the app teaches from, so the `note` on each one is the
 * actual content — the events are only what you clap while reading it. They are
 * written for a player who can already execute anything here and is meeting the
 * THEORY for the first time, which is why the notes talk about where the beat
 * is and what the ear is supposed to group, and never about how to play.
 *
 * Compound meter is deliberately not an appendix. 12/8 gets more presets than
 * any other meter because "how does 12/8 work" is the question this library was
 * built to answer, and the only way to answer it is to show the same bar felt
 * several different ways.
 *
 * Nothing here computes anything. Every preset is verified against its own
 * meter by `validateBar` in the tests, so a bar that does not add up is a test
 * failure rather than a rendering bug discovered later.
 */

import { type Duration, TRIPLET, dur } from './duration'
import { type Meter, meter } from './meter'
import { type RhythmEvent, note, rest } from './bar'

export type PresetTag =
  | 'beginner'
  | 'compound'
  | 'syncopation'
  | 'tuplet'
  | 'asymmetric'
  | 'dotted'
  | 'ties'

export interface RhythmPreset {
  readonly id: string
  readonly name: string
  readonly meter: Meter
  readonly events: readonly RhythmEvent[]
  readonly tags: readonly PresetTag[]
  /** One or two sentences teaching what to listen for. This is the lesson. */
  readonly note: string
  /** Bars spanned. Absent means one. Set to 2 for examples that tie over a barline. */
  readonly bars?: number
}

// Shorthand so the tables below read as rhythm rather than as constructor calls.
const W = dur('whole')
const H = dur('half')
const DH = dur('half', 1)
const Q = dur('quarter')
const DQ = dur('quarter', 1)
const E = dur('eighth')
const DE = dur('eighth', 1)
const S = dur('sixteenth')
const TQ = dur('quarter', 0, TRIPLET)
const TE = dur('eighth', 0, TRIPLET)

const n = note
const r = rest
const rep = (count: number, d: Duration): RhythmEvent[] =>
  Array.from({ length: count }, () => note(d))

// Meters are built once and shared, so `presetsForMeter` can compare by value
// and the UI can compare by reference without either being wrong.
const FOUR_FOUR = meter(4, 4)
const THREE_FOUR = meter(3, 4)
const TWO_FOUR = meter(2, 4)
const CUT_TIME = meter(2, 2)
const SIX_EIGHT = meter(6, 8)
const NINE_EIGHT = meter(9, 8)
const TWELVE_EIGHT = meter(12, 8)
const FIVE_FOUR = meter(5, 4)
// 5/4 counted in five is simple; 5/4 grouped 3+2 is a different meter with the
// same time signature, and the accents move accordingly.
const FIVE_FOUR_32 = meter(5, 4, { grouping: [3, 2] })
const FIVE_EIGHT_32 = meter(5, 8)
const FIVE_EIGHT_23 = meter(5, 8, { grouping: [2, 3] })
const SEVEN_EIGHT_223 = meter(7, 8)
const SEVEN_EIGHT_322 = meter(7, 8, { grouping: [3, 2, 2] })

export const RHYTHM_PRESETS: readonly RhythmPreset[] = [
  // ---- 4/4, where every other meter gets explained from ----
  {
    id: '4-4-whole-note',
    name: 'One whole note',
    meter: FOUR_FOUR,
    events: [n(W)],
    tags: ['beginner'],
    note: 'The whole note is not "a long note" — it is exactly the length of the bar in 4/4, so it is worth four quarters here and only here. In 3/4 the same symbol would overflow the bar.',
  },
  {
    id: '4-4-half-notes',
    name: 'Two half notes',
    meter: FOUR_FOUR,
    events: rep(2, H),
    tags: ['beginner'],
    note: 'Two halves split the bar down the middle. The second one lands on beat 3, which is the bar\'s secondary accent — that is why 4/4 feels like ONE two THREE four rather than four equal beats.',
  },
  {
    id: '4-4-quarter-notes',
    name: 'Four quarter notes',
    meter: FOUR_FOUR,
    events: rep(4, Q),
    tags: ['beginner'],
    note: 'The reference rhythm: one note per beat, so the notated rhythm and the pulse are the same thing. Every other preset in 4/4 is a departure from this one.',
  },
  {
    id: '4-4-eighth-notes',
    name: 'Eight eighth notes',
    meter: FOUR_FOUR,
    events: rep(8, E),
    tags: ['beginner'],
    note: 'Count 1-and-2-and-3-and-4-and. The beat has not changed and there are still four of them; you are hearing the beat divided in two, which is what makes 4/4 a SIMPLE meter.',
  },
  {
    id: '4-4-sixteenth-notes',
    name: 'Sixteen sixteenth notes',
    meter: FOUR_FOUR,
    events: rep(16, S),
    tags: ['beginner'],
    note: 'Count 1-e-and-a 2-e-and-a. Four notes per beat is the beat halved and halved again — the beams group them four to a beat precisely so your eye can find the numbered beats without counting noteheads.',
  },
  {
    id: '4-4-dotted-quarter-eighth',
    name: 'Dotted quarter and eighth',
    meter: FOUR_FOUR,
    events: [n(DQ), n(E), n(Q), n(Q)],
    tags: ['dotted', 'beginner'],
    note: 'A dot adds half the note\'s value again, so the dotted quarter is worth a quarter plus an eighth and runs from beat 1 to the "and" of beat 2. The eighth that follows is the only note in the bar that does not start on a beat.',
  },
  {
    id: '4-4-long-short',
    name: 'Dotted eighth and sixteenth',
    meter: FOUR_FOUR,
    events: [n(DE), n(S), n(DE), n(S), n(DE), n(S), n(DE), n(S)],
    tags: ['dotted'],
    note: 'Each beat is split three-to-one instead of evenly: the long note takes three sixteenths and the short one takes the last. Written that way it is a crisp dotted figure, and it is worth hearing next to eighth triplets, which sound similar but divide the beat in three.',
  },
  {
    id: '4-4-syncopation',
    name: 'Syncopated quarters',
    meter: FOUR_FOUR,
    events: [n(E), n(Q), n(Q), n(Q), n(E)],
    tags: ['syncopation'],
    note: 'After the opening eighth, the three quarters all land between the beats — on the "and" of 1, of 2 and of 3 — and never on a numbered beat. Syncopation is not playing faster; it is putting the weight where the beat is not.',
  },
  {
    id: '4-4-quarter-triplets',
    name: 'Quarter-note triplets',
    meter: FOUR_FOUR,
    events: [n(TQ), n(TQ), n(TQ), n(H)],
    tags: ['tuplet'],
    note: 'Three even notes in the time of two beats — that is what the 3 over the bracket means, three in the space of the two quarters they replace. They fit beats 1 and 2, so only the first of the three lands with the pulse.',
  },
  {
    id: '4-4-eighth-triplets',
    name: 'Eighth-note triplets',
    meter: FOUR_FOUR,
    events: rep(12, TE),
    tags: ['tuplet'],
    note: 'Each beat is divided into three instead of two: count 1-la-li 2-la-li. Borrowing a three-way division into a simple meter is exactly the sound that compound meters like 6/8 and 12/8 have built in permanently.',
  },
  {
    id: '4-4-tie-across-beats',
    name: 'Tie across the beat',
    meter: FOUR_FOUR,
    events: [n(Q), n(E), n(E, { tiedToNext: true }), n(Q), n(Q)],
    tags: ['ties', 'syncopation'],
    note: 'The tie joins the "and" of beat 2 to beat 3, so beat 3 is heard but never re-struck — a tie means hold, not play again. This is how a syncopation gets notated when the note has to keep the beat count honest on both sides.',
  },
  {
    id: '4-4-tie-across-the-barline',
    name: 'Tie across the barline',
    meter: FOUR_FOUR,
    events: [n(H), n(Q), n(Q, { tiedToNext: true }), n(H), n(H)],
    tags: ['ties'],
    note: 'A barline cannot cut a note in half, so a note that needs to last through it is written twice and tied. The downbeat of bar 2 arrives with no new attack, which is the strongest syncopation available in 4/4.',
    bars: 2,
  },
  {
    id: '4-4-rest-on-the-downbeat',
    name: 'Rest on the downbeat',
    meter: FOUR_FOUR,
    events: [r(Q), n(Q), n(Q), n(Q)],
    tags: ['syncopation', 'beginner'],
    note: 'Beat 1 is silent but it is still beat 1 — the rest is counted, not skipped. Coming in on beat 2 only sounds like beat 2 if you have already felt the downbeat go past.',
  },

  // ---- 3/4 ----
  {
    id: '3-4-basic',
    name: 'Three quarter notes',
    meter: THREE_FOUR,
    events: rep(3, Q),
    tags: ['beginner'],
    note: 'Three beats to the bar, with the accent only on beat 1. Three is an odd number, so unlike 4/4 there is no secondary accent in the middle — nothing pulls against the downbeat.',
  },
  {
    id: '3-4-waltz-accompaniment',
    name: 'Waltz oom-pah-pah',
    meter: THREE_FOUR,
    events: [n(Q), r(E), n(E), r(E), n(E)],
    tags: ['beginner'],
    note: 'The bass on beat 1 and lighter chords on beats 2 and 3 is what makes 3/4 sound like a waltz rather than just three beats. The offbeat eighths are late on purpose — the "pah" arrives after the beat, not on it.',
  },
  {
    id: '3-4-eighth-notes',
    name: 'Six eighths in three',
    meter: THREE_FOUR,
    events: rep(6, E),
    tags: ['beginner'],
    note: 'Six eighths, beamed in three pairs, because 3/4 is three beats each split in two. Compare it with the six eighths in 6/8: identical durations, and a completely different rhythm, because the beaming tells you where the beats are.',
  },
  {
    id: '3-4-hemiola',
    name: 'Hemiola over two bars',
    meter: THREE_FOUR,
    events: rep(3, H),
    tags: ['syncopation'],
    note: 'Two bars of 3/4 hold six quarters, and three half notes regroup them as 2+2+2 instead of 3+3. The written meter never changes; only the accents move, which is what a hemiola is.',
    bars: 2,
  },

  // ---- 2/4 and cut time ----
  {
    id: '2-4-basic',
    name: 'Two quarter notes',
    meter: TWO_FOUR,
    events: rep(2, Q),
    tags: ['beginner'],
    note: 'Two beats to the bar, strong-weak. 2/4 is not half of 4/4: it puts a downbeat every two beats, so a march in 2/4 leans twice as often as the same tune barred in 4/4.',
  },
  {
    id: '2-2-cut-time-halves',
    name: 'Cut time, two half notes',
    meter: CUT_TIME,
    events: rep(2, H),
    tags: ['beginner'],
    note: 'In 2/2 the beat is the HALF note, so these two notes are beats 1 and 2 — not a long note each. The bar holds the same amount of time as a 4/4 bar; you simply count two slow beats instead of four.',
  },
  {
    id: '2-2-quarters-in-two',
    name: 'Cut time, four quarters',
    meter: CUT_TIME,
    events: rep(4, Q),
    tags: ['beginner'],
    note: 'The same four quarters as a bar of 4/4, but here they are divisions rather than beats: two per beat, counted 1-and-2-and. Cut time is a relabelling of the pulse, and it changes how the music leans without changing a single note length.',
  },

  // ---- 6/8: the first compound meter ----
  {
    id: '6-8-basic-pulse',
    name: 'Two dotted quarters',
    meter: SIX_EIGHT,
    events: rep(2, DQ),
    tags: ['compound', 'beginner'],
    note: 'The 6 counts eighths, but you feel TWO beats, and each one is a dotted quarter worth three of those eighths. That is the whole idea of compound time: the beat divides into three, so the beat itself has to be a dotted note.',
  },
  {
    id: '6-8-eighth-notes',
    name: 'Six eighths in two',
    meter: SIX_EIGHT,
    events: rep(6, E),
    tags: ['compound', 'beginner'],
    note: 'Count 1-2-3 4-5-6 with weight on 1 and 4 only. The beams group them three and three, which is the notation telling you these are two beats of three, not three beats of two.',
  },
  {
    id: '6-8-gallop',
    name: 'The 6/8 gallop',
    meter: SIX_EIGHT,
    events: [n(Q), n(E), n(Q), n(E)],
    tags: ['compound'],
    note: 'A quarter then an eighth fills one dotted-quarter beat as long-short, two eighths against one. This uneven-inside-the-beat feel is the sound of a jig, and it exists in 6/8 without any tuplet bracket because the beat already divides in three.',
  },
  {
    id: '6-8-three-quarter-notes',
    name: 'Three quarters against 6/8',
    meter: SIX_EIGHT,
    events: rep(3, Q),
    tags: ['compound', 'syncopation'],
    note: 'A 6/8 bar and a 3/4 bar are exactly the same length, so three plain quarters fit — but only the first agrees with the 6/8 beat. Alternating this with the two-dotted-quarter pulse is the "I like to be in America" effect: same bar, two different meters.',
  },

  // ---- 9/8 ----
  {
    id: '9-8-basic-pulse',
    name: 'Three dotted quarters',
    meter: NINE_EIGHT,
    events: rep(3, DQ),
    tags: ['compound', 'beginner'],
    note: 'Nine eighths grouped 3+3+3, so three beats with a three-way division — 9/8 is to 3/4 what 6/8 is to 2/4. Look for the top number divisible by three: that is how you spot a compound meter on sight.',
  },

  // ---- 12/8: the meter she asked about ----
  {
    id: '12-8-basic-pulse',
    name: 'Four dotted quarters',
    meter: TWELVE_EIGHT,
    events: rep(4, DQ),
    tags: ['compound', 'beginner'],
    note: 'Count 1-2-3 4-5-6 7-8-9 10-11-12, but feel only 1, 4, 7 and 10. That is what makes 12/8 different from twelve separate eighth notes: four dotted-quarter beats, each of which happens to contain three eighths.',
  },
  {
    id: '12-8-twelve-eighths',
    name: 'Twelve eighths',
    meter: TWELVE_EIGHT,
    events: rep(12, E),
    tags: ['compound'],
    note: 'All twelve eighths sounded, beamed three to a beat. The beams are doing the teaching here — the same twelve notes beamed in sixes or fours would be a different meter, and you would hear it immediately.',
  },
  {
    id: '12-8-shuffle',
    name: 'Shuffle feel',
    meter: TWELVE_EIGHT,
    events: [n(Q), n(E), n(Q), n(E), n(Q), n(E), n(Q), n(E)],
    tags: ['compound'],
    note: 'Each beat is a quarter plus an eighth: the first two of the three eighths tied into one long note, then the short one. This is the blues and swing shuffle, and writing it in 12/8 is how you notate a swung 4/4 exactly instead of leaving it to a "swing eighths" instruction.',
  },
  {
    id: '12-8-dotted-half-and-dotted-quarter',
    name: 'Dotted half and dotted quarters',
    meter: TWELVE_EIGHT,
    events: [n(DH), n(DQ), n(DQ)],
    tags: ['compound', 'dotted'],
    note: 'A dotted half covers beats 1 and 2 — six eighths — and the two dotted quarters take beats 3 and 4. In compound time almost every note you write is dotted, because the units of the meter are themselves dotted.',
  },
  {
    id: '12-8-tie-into-beat-three',
    name: 'Tie into beat 3',
    meter: TWELVE_EIGHT,
    events: [n(DQ), n(E), n(E), n(E, { tiedToNext: true }), n(DQ), n(DQ)],
    tags: ['compound', 'ties', 'syncopation'],
    note: 'The last eighth of beat 2 is tied over to beat 3, so beat 3 — the bar\'s secondary accent — arrives with no new attack. Anticipating the strong beat by one eighth like this is the most common syncopation in compound time.',
  },
  {
    id: '12-8-tie-across-the-barline',
    name: '12/8 tie across the barline',
    meter: TWELVE_EIGHT,
    events: [n(DQ), n(DQ), n(DQ), n(DQ, { tiedToNext: true }), n(Q), n(E), n(DQ), n(DQ), n(DQ)],
    tags: ['compound', 'ties'],
    note: 'The fourth beat of bar 1 is tied into bar 2, so the new bar starts sounding before its downbeat is struck. Notice the tied-into note is written as a quarter plus an eighth rather than a dotted quarter — that keeps the eighth visible on the third pulse of the beat.',
    bars: 2,
  },
  {
    id: '12-8-offbeat-accents',
    name: 'Offbeat eighths in 12/8',
    meter: TWELVE_EIGHT,
    events: [r(E), n(E), n(E), r(E), n(E), n(E), r(E), n(E), n(E), r(E), n(E), n(E)],
    tags: ['compound', 'syncopation'],
    note: 'Each beat rests on its first eighth and plays the second and third, so all four beats are heard but never struck. Count 1-2-3 aloud per beat and play only on 2 and 3 — if the count drifts, the rhythm will start sounding like plain eighth pairs.',
  },
  {
    id: '12-8-three-against-four',
    name: 'Three half notes across the bar',
    meter: TWELVE_EIGHT,
    events: rep(3, H),
    tags: ['compound', 'syncopation'],
    note: 'A 12/8 bar holds twelve eighths, and three half notes divide it as 4+4+4 instead of 3+3+3+3. Three notes against the four-beat pulse, sharing only the downbeat — the same cross-rhythm as a hemiola, arriving from the other direction.',
  },

  // ---- 5/4 ----
  {
    id: '5-4-basic',
    name: 'Five quarter notes',
    meter: FIVE_FOUR,
    events: rep(5, Q),
    tags: ['beginner'],
    note: 'Five equal beats with a single accent on beat 1. Counted straight through like this, 5/4 is a simple meter that just happens to have an odd number of beats — nothing is uneven inside the bar.',
  },
  {
    id: '5-4-three-plus-two',
    name: '5/4 grouped 3+2',
    meter: FIVE_FOUR_32,
    events: [n(DH), n(H)],
    tags: ['asymmetric'],
    note: 'The same five quarters, but now heard as a group of three and a group of two, so there is a second accent on beat 4. This is the Take Five grouping; the time signature is identical to the preset above and the bar has a completely different shape.',
  },

  // ---- 5/8 and 7/8: where the grouping IS the meter ----
  {
    id: '5-8-three-plus-two',
    name: '5/8 as 3+2',
    meter: FIVE_EIGHT_32,
    events: [n(DQ), n(Q)],
    tags: ['asymmetric'],
    note: 'Five eighths split into a long beat of three and a short beat of two: LONG-short. The two beats are genuinely unequal lengths, which is what makes a meter asymmetric rather than merely odd-numbered.',
  },
  {
    id: '5-8-two-plus-three',
    name: '5/8 as 2+3',
    meter: FIVE_EIGHT_23,
    events: [n(Q), n(DQ)],
    tags: ['asymmetric'],
    note: 'The same five eighths regrouped short-LONG, so the second accent moves from pulse 4 to pulse 3. Compare it directly with the 3+2 version: identical time signature, identical bar length, and the two are not interchangeable.',
  },
  {
    id: '7-8-two-two-three',
    name: '7/8 as 2+2+3',
    meter: SEVEN_EIGHT_223,
    events: [n(Q), n(Q), n(DQ)],
    tags: ['asymmetric'],
    note: 'Two short beats and then a long one: short-short-LONG, with accents on pulses 1, 3 and 5. Seven eighths cannot be split evenly, so a 7/8 bar always has to declare which of its beats is the long one.',
  },
  {
    id: '7-8-two-two-three-eighths',
    name: '7/8 eighths, 2+2+3',
    meter: SEVEN_EIGHT_223,
    events: rep(7, E),
    tags: ['asymmetric'],
    note: 'Count 1-2 3-4 5-6-7. Seven identical eighths, and the only thing that makes them 2+2+3 rather than 3+2+2 is where you put the weight — which is why the grouping is written above the staff and not left to the performer.',
  },
  {
    id: '7-8-three-two-two',
    name: '7/8 as 3+2+2',
    meter: SEVEN_EIGHT_322,
    events: [n(DQ), n(Q), n(Q)],
    tags: ['asymmetric'],
    note: 'The long beat moves to the front: LONG-short-short, with accents on pulses 1, 4 and 6. Play this straight after the 2+2+3 preset — the notes are the same lengths in a different order, and the bar sounds like a different meter.',
  },
]

/**
 * Two meters are the same for lookup purposes when their numbers AND their
 * grouping match. 7/8 as 2+2+3 and 7/8 as 3+2+2 share a time signature and are
 * not the same meter, so comparing labels alone would mix their presets.
 */
function sameMeter(a: Meter, b: Meter): boolean {
  return (
    a.numerator === b.numerator &&
    a.denominator === b.denominator &&
    a.grouping.length === b.grouping.length &&
    a.grouping.every((g, i) => g === b.grouping[i])
  )
}

const meterKey = (m: Meter): string => `${m.numerator}/${m.denominator}:${m.grouping.join('+')}`

/**
 * The distinct meters the library covers, in the order they first appear above.
 * Derived rather than written out, so a new preset in a new meter cannot leave
 * the picker's list stale.
 */
function distinctMeters(presets: readonly RhythmPreset[]): Meter[] {
  const seen = new Set<string>()
  const out: Meter[] = []
  for (const p of presets) {
    const key = meterKey(p.meter)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p.meter)
  }
  return out
}

export const PRESET_METERS: readonly Meter[] = distinctMeters(RHYTHM_PRESETS)

const BY_ID = new Map(RHYTHM_PRESETS.map((p) => [p.id, p]))

export function presetsForMeter(m: Meter): RhythmPreset[] {
  return RHYTHM_PRESETS.filter((p) => sameMeter(p.meter, m))
}

export function presetsByTag(tag: PresetTag): RhythmPreset[] {
  return RHYTHM_PRESETS.filter((p) => p.tags.includes(tag))
}

export function presetById(id: string): RhythmPreset | null {
  return BY_ID.get(id) ?? null
}

/** Bars a preset spans. Most are one; the tie examples are two. */
export const presetBars = (p: RhythmPreset): number => p.bars ?? 1
