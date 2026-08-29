/**
 * Poke at the domain layer from the terminal.
 *
 * The core modules are pure and have no UI yet, so this is how a human checks
 * that what they compute is musically right rather than merely self-consistent.
 *
 *   bun run inspect scale Eb major
 *   bun run inspect scale A harmonic-minor
 *   bun run inspect meter 12/8
 *   bun run inspect keys
 */

import { formatPitch, pc, type Letter } from '../src/core/pitch/pitch'
import { CIRCLE_OF_FIFTHS, diatonicPitchClasses } from '../src/core/key/key'
import { SCALE_TYPES, SCALE_TYPE_LIST, type ScaleTypeId } from '../src/core/scale/scaleTypes'
import { buildScale } from '../src/core/scale/scale'
import { bestRange, fingerScale, rangeOptions } from '../src/core/viola/scaleFingering'
import { COMMON_METERS, meter, type Denominator } from '../src/core/rhythm/meter'
import { beamGroups, note, validateBar } from '../src/core/rhythm/bar'
import { dur } from '../src/core/rhythm/duration'

const BOLD = '\x1b[1m'
const DIM = '\x1b[2m'
const OFF = '\x1b[0m'

const head = (s: string) => console.log(`\n${BOLD}${s}${OFF}`)
const dim = (s: string) => `${DIM}${s}${OFF}`

function describeSignature(sig: { letters: readonly string[]; accidental: string }): string {
  if (sig.letters.length === 0) return 'no accidentals'
  const plural = sig.letters.length === 1 ? '' : 's'
  return `${sig.letters.length} ${sig.accidental}${plural}: ${sig.letters.join(' ')}`
}

function parseRoot(text: string): { letter: Letter; alter: -1 | 0 | 1 } {
  const letter = text.charAt(0).toUpperCase() as Letter
  const accidental = text.slice(1)
  const alter = accidental.startsWith('b') || accidental.startsWith('♭') ? -1
    : accidental.startsWith('#') || accidental.startsWith('♯') ? 1
    : 0
  return { letter, alter }
}

function showScale(rootText: string, typeText: string) {
  const { letter, alter } = parseRoot(rootText)
  const typeId = typeText as ScaleTypeId
  const type = SCALE_TYPES[typeId]
  if (!type) {
    console.error(`unknown scale type "${typeText}". Try one of:`)
    console.error('  ' + SCALE_TYPE_LIST.map((t) => t.id).join(', '))
    process.exit(1)
  }

  const scale = buildScale(pc(letter, alter), type)

  head(scale.name)
  console.log(dim(type.blurb))

  head('Key signature')
  console.log(`  ${scale.key.name} — ${describeSignature(scale.key.signature)}`)

  head('Degrees')
  console.log('  ' + scale.degrees.map((d) => formatPitch(d.pitchClass).padEnd(4)).join(''))
  console.log('  ' + scale.degrees.map((d) => d.label.padEnd(4)).join(''))

  head('Whole and half steps')
  const cells = scale.steps.map((s) => (s.isAugmented ? `${BOLD}${s.display}${OFF}` : s.display))
  console.log('  ' + scale.degrees.map((d) => formatPitch(d.pitchClass).padEnd(4)).join('') + formatPitch(scale.degrees[0]!.pitchClass))
  console.log('    ' + cells.map((c) => c.padEnd(c.includes('[') ? 12 : 4)).join(''))
  for (const step of scale.steps) {
    if (step.isAugmented) {
      console.log(dim(`  note: degree ${step.fromDegree} to ${step.toDegree} is an ${step.name} — three semitones, but only one letter`))
    }
  }

  if (scale.isAsymmetric) {
    head('Descending (differs)')
    console.log('  ' + scale.descendingDegrees.map((d) => formatPitch(d.pitchClass).padEnd(4)).join(''))
    console.log('    ' + scale.descendingSteps.map((s) => s.display.padEnd(4)).join(''))
  }

  head('On the viola')
  const range = bestRange(scale, 2)
  if (range === null) {
    console.log('  no playable two-octave range on this instrument')
  } else {
    const plan = fingerScale(scale, { startOctave: range.start.octave, octaves: 2 })
    console.log(
      `  two octaves from ${formatPitch(range.start)} to ${formatPitch(range.end)} — ` +
        (plan.staysInFirstPosition
          ? 'entirely in 1st position'
          : `${plan.shifts.length} shift${plan.shifts.length === 1 ? '' : 's'}, up to ${plan.highestPosition}${plan.highestPosition === 3 ? 'rd' : 'th'} position`),
    )
    console.log()
    console.log(
      '  ' +
        plan.notes
          .map((n) => {
            const cell = `${formatPitch(n.pitch)}`.padEnd(4) + `${n.placement.string}:${n.placement.finger}`
            return n.shiftIntoThisNote ? `${BOLD}|${cell}${OFF}` : ` ${cell}`
          })
          .join(' '),
    )
    console.log(dim('   (string:finger — 0 is an open string, | marks a shift)'))
    for (const s of plan.shifts) {
      console.log(dim(`   ${s.label} on the ${s.string} string`))
    }
  }

  head('Where it will not fit')
  for (const option of rangeOptions(scale, 2)) {
    if (!option.feasible) {
      console.log(dim(`  from ${formatPitch(option.start)}: ${option.reason}`))
    }
  }
}

function showMeter(text: string) {
  const [n, d] = text.split('/')
  const m = meter(Number(n), Number(d) as Denominator)

  head(`${m.label} — ${m.description}`)
  console.log(`  class:     ${m.class}`)
  console.log(`  beats:     ${m.beats} (grouped ${m.grouping.join('+')})`)
  console.log(`  beat unit: ${m.beatUnit.dots ? 'dotted ' : ''}${m.beatUnit.base} note`)
  console.log(`  bar:       ${m.barValue.n}/${m.barValue.d} of a whole note, ${m.barTicks} ticks`)

  head('Pulse grid')
  const cells: string[] = []
  let pulse = 0
  for (const [beatIndex, group] of m.grouping.entries()) {
    for (let i = 0; i < group; i++) {
      const isBeatStart = i === 0
      const accent = isBeatStart ? m.accents[beatIndex] : 'weak'
      const mark =
        accent === 'strong' ? 'ONE' : accent === 'medium' ? 'ACC' : isBeatStart ? 'beat' : '  . '
      const cell = `${String(pulse + 1).padStart(2)} ${mark}`
      cells.push(isBeatStart ? BOLD + cell + OFF : dim(cell))
      pulse += 1
    }
    cells.push('|')
  }
  console.log('  ' + cells.join(' '))
  console.log(dim('   ONE = downbeat, ACC = secondary accent, | = group boundary'))

  head('A bar of eighths')
  const events = Array.from({ length: m.numerator }, () => note(dur('eighth')))
  const check = validateBar(m, events)
  console.log(`  fills the bar: ${check.ok ? 'yes' : `no — ${check.message}`}`)
  console.log(`  beamed as:     ${beamGroups(m, events).map((g) => g.length).join(' + ')}`)
}

function showKeys() {
  head('The circle of fifths')
  for (const entry of CIRCLE_OF_FIFTHS) {
    const sig = entry.major.signature
    const label = describeSignature(sig)
    console.log(
      `  ${String(entry.fifths).padStart(3)}  ${entry.major.name.padEnd(12)} ${entry.minor.name.padEnd(12)} ${dim(label)}`,
    )
    if (Math.abs(entry.fifths) <= 4) {
      console.log(dim(`       ${diatonicPitchClasses(entry.major).map((k) => formatPitch(k)).join(' ')}`))
    }
  }
}

function showMeters() {
  head('Common meters')
  for (const m of COMMON_METERS) {
    console.log(
      `  ${m.label.padEnd(5)} ${m.class.padEnd(11)} ${String(m.beats).padStart(2)} beats  ` +
        `${m.grouping.join('+').padEnd(9)} ${dim(m.accents.join(' '))}`,
    )
  }
}

const [command, ...rest] = process.argv.slice(2)

switch (command) {
  case 'scale':
    showScale(rest[0] ?? 'C', rest[1] ?? 'major')
    break
  case 'meter':
    showMeter(rest[0] ?? '12/8')
    break
  case 'meters':
    showMeters()
    break
  case 'keys':
    showKeys()
    break
  default:
    console.log('usage:')
    console.log('  bun run inspect scale <root> <type>   e.g. scale Eb major, scale A harmonic-minor')
    console.log('  bun run inspect meter <n/d>           e.g. meter 12/8')
    console.log('  bun run inspect meters')
    console.log('  bun run inspect keys')
    console.log()
    console.log('scale types: ' + SCALE_TYPE_LIST.map((t) => t.id).join(', '))
}
console.log()
