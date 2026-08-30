import { describe, expect, it } from 'vitest'
import { meter } from './meter'
import { dur } from './duration'
import { note, rest } from './bar'
import { countBar, countLine, countRhythm, countRhythmLine, countingAdvice } from './counting'

const rep = (n: number, d: ReturnType<typeof dur>) => Array.from({ length: n }, () => note(d))

describe('counting a meter', () => {
  // The mistake this exists to prevent: "one-ee-and-a" is a FOUR-way split, and
  // using it for a compound meter teaches the wrong number of subdivisions.
  it('gives a compound beat three syllables, not four', () => {
    expect(countLine(meter(12, 8))).toBe('1 & a 2 & a 3 & a 4 & a')
    expect(countLine(meter(6, 8))).toBe('1 & a 2 & a')
    expect(countLine(meter(9, 8))).toBe('1 & a 2 & a 3 & a')
  })

  it('gives a simple beat two', () => {
    expect(countLine(meter(4, 4))).toBe('1 & 2 & 3 & 4 &')
    expect(countLine(meter(3, 4))).toBe('1 & 2 & 3 &')
  })

  it('counts an asymmetric meter by its real groups', () => {
    expect(countLine(meter(7, 8))).toBe('1 & 2 & 3 & a')
    expect(countLine(meter(5, 8))).toBe('1 & a 2 &')
  })

  it('offers the slow-practice count of every pulse', () => {
    expect(countLine(meter(12, 8), 'numbers')).toBe('1 2 3 4 5 6 7 8 9 10 11 12')
  })

  it('marks which syllables are beats', () => {
    const counted = countBar(meter(12, 8))
    expect(counted.filter((p) => p.isBeat).map((p) => p.say)).toEqual(['1', '2', '3', '4'])
    expect(counted).toHaveLength(12)
  })

  it('warns about the count that never starts to feel like beats', () => {
    expect(countingAdvice(meter(12, 8))).toMatch(/three sounds to a beat, not four/)
    expect(countingAdvice(meter(12, 8))).toMatch(/never starts to feel like 4 beats/)
  })
})

describe('counting an actual rhythm', () => {
  const twelveEight = meter(12, 8)

  // The moment the dot stops being mysterious: you say three, you play one.
  it('shows a dotted quarter held through its own subdivisions', () => {
    expect(countRhythmLine(twelveEight, rep(4, dur('quarter', 1)))).toBe(
      '1 (& a) 2 (& a) 3 (& a) 4 (& a)',
    )
  })

  it('shows one dotted note against straight eighths', () => {
    const events = [note(dur('quarter', 1)), ...rep(9, dur('eighth'))]
    expect(countRhythmLine(twelveEight, events)).toBe('1 (& a) 2 & a 3 & a 4 & a')
  })

  it('shows the shuffle playing on the third of each beat', () => {
    const shuffle = [0, 1, 2, 3].flatMap(() => [note(dur('quarter')), note(dur('eighth'))])
    expect(countRhythmLine(twelveEight, shuffle)).toBe('1 (&) a 2 (&) a 3 (&) a 4 (&) a')
  })

  it('shows the classic dotted quarter plus eighth in 4/4', () => {
    // Play on 1, hold through the "&" and through 2, play on the "&" of 2.
    const events = [
      note(dur('quarter', 1)),
      note(dur('eighth')),
      note(dur('quarter')),
      note(dur('quarter')),
    ]
    expect(countRhythmLine(meter(4, 4), events)).toBe('1 (& 2) & 3 (&) 4 (&)')
  })

  it('distinguishes a rest from a held note', () => {
    const events = [note(dur('quarter')), rest(dur('quarter')), note(dur('half'))]
    const counted = countRhythm(meter(4, 4), events)
    expect(counted[0]?.role).toBe('strike')
    expect(counted[1]?.role).toBe('hold') // the quarter is still ringing
    expect(counted[2]?.role).toBe('rest') // beat 2 is silent
    expect(counted[4]?.role).toBe('strike') // the half note starts on 3
  })

  it('flags a note that falls between two counts rather than inventing a syllable', () => {
    // A sixteenth inside a compound beat lands off the "& a" grid.
    const events = [note(dur('sixteenth')), note(dur('sixteenth')), ...rep(11, dur('eighth'))]
    const counted = countRhythm(twelveEight, events)
    expect(counted.some((p) => p.offBeatNote)).toBe(true)
  })

  it('produces one entry per counted syllable, whatever the rhythm', () => {
    for (const m of [meter(4, 4), meter(12, 8), meter(7, 8), meter(3, 4)]) {
      const events = rep(m.numerator, dur(m.denominator === 8 ? 'eighth' : 'quarter'))
      expect(countRhythm(m, events).length).toBe(countBar(m).length)
    }
  })
})
