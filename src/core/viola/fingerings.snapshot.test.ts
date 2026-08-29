import { describe, expect, it } from 'vitest'
import { formatPitch, pc, type Letter } from '../pitch/pitch'
import { SCALE_TYPES, type ScaleTypeId } from '../scale/scaleTypes'
import { buildScale } from '../scale/scale'
import { bestRange, fingerScale } from './scaleFingering'

/**
 * A frozen record of the fingering chosen for every scale the app ships.
 *
 * The seven weights in fingering.ts are a judgement call, and tuning one to fix
 * a single scale can quietly change five others. This snapshot turns that into a
 * reviewable diff: if a weight changes, the exact notes affected show up in the
 * failure, and a human decides whether the new fingering is better.
 *
 * The fingerings recorded here were checked against how a violist actually plays
 * these scales — C and D major entirely in first position, G major shifting to
 * third for the top two notes, B flat shifting to fifth.
 */

const SHIPPED: Array<[Letter, -1 | 0 | 1, ScaleTypeId]> = [
  ['C', 0, 'major'],
  ['G', 0, 'major'],
  ['D', 0, 'major'],
  ['A', 0, 'major'],
  ['F', 0, 'major'],
  ['B', -1, 'major'],
  ['E', -1, 'major'],
  ['A', 0, 'natural-minor'],
  ['D', 0, 'natural-minor'],
  ['G', 0, 'natural-minor'],
  ['A', 0, 'harmonic-minor'],
  ['D', 0, 'harmonic-minor'],
  ['E', 0, 'harmonic-minor'],
  ['A', 0, 'melodic-minor'],
  ['D', 0, 'melodic-minor'],
]

function render(letter: Letter, alter: -1 | 0 | 1, typeId: ScaleTypeId): string {
  const scale = buildScale(pc(letter, alter), SCALE_TYPES[typeId])
  const range = bestRange(scale, 2)
  if (range === null) return `${scale.name}: no playable two-octave range`

  const plan = fingerScale(scale, { startOctave: range.start.octave, octaves: 2 })
  const notes = plan.notes
    .map((n) => {
      const shift = n.shiftIntoThisNote ? '|' : ' '
      return `${shift}${formatPitch(n.pitch).padEnd(4)}${n.placement.string}:${n.placement.finger}`
    })
    .join(' ')

  return [
    `${scale.name} (from ${formatPitch(range.start)})`,
    `  shifts=${plan.shifts.length} highestPosition=${plan.highestPosition}`,
    `  ${notes}`,
  ].join('\n')
}

describe('shipped scale fingerings', () => {
  it('are stable across weight changes', () => {
    const report = SHIPPED.map(([letter, alter, typeId]) => render(letter, alter, typeId)).join(
      '\n\n',
    )
    expect(report).toMatchSnapshot()
  })

  it('never leaves a shipped scale unplayable', () => {
    for (const [letter, alter, typeId] of SHIPPED) {
      const scale = buildScale(pc(letter, alter), SCALE_TYPES[typeId])
      const range = bestRange(scale, 2)
      expect(range, `${scale.name} has no two-octave range`).not.toBeNull()

      const plan = fingerScale(scale, { startOctave: range!.start.octave, octaves: 2 })
      expect(plan.complete, `${scale.name} has no complete fingering`).toBe(true)
      expect(plan.warnings).toEqual([])
    }
  })
})
