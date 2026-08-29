/**
 * Choosing a fingering for a run of notes.
 *
 * This is a shortest-path problem, and it is solved exactly rather than
 * heuristically. The graph is tiny — around thirty notes, at most eight
 * placements each, across a handful of carried positions — so an exact dynamic
 * program runs in well under a millisecond and removes any question of the
 * search being the reason a fingering looks wrong.
 *
 * THE SUBTLETY WORTH READING BEFORE EDITING THIS FILE: an open string does not
 * establish a hand position. If you play D on the open II string, your hand is
 * still wherever it was, and the next note shifts from THERE. That makes the
 * naive formulation non-Markovian — the cost of a transition depends on
 * something the previous note does not record. The fix is to carry the position
 * in the search state, so a state is (placement, carriedPosition) rather than
 * just (placement). Getting this wrong produces fingerings that look almost
 * right and shift in the wrong places.
 */

import { type Pitch, formatPitch, toMidi } from '../pitch/pitch'
import { type Placement, type Position, type Finger, placementsFor, positionName } from './fingerboard'
import { type StringId, HIGHEST_PRACTICAL, LOWEST_PITCH, STRINGS } from './strings'

export interface FingeringWeights {
  /** Any change of position at all. */
  readonly shiftBase: number
  /** Multiplied by how far the hand moves. */
  readonly shiftPerStep: number
  /** Multiplied by how many strings are crossed. */
  readonly stringCross: number
  /** Negative: open strings are cheap and ring nicely. */
  readonly openStringBonus: number
  /** The fourth finger is weaker; prefer alternatives when they are close. */
  readonly fourthFinger: number
  /** Higher positions are harder to play in tune. */
  readonly positionHeight: number
  /** Stretching a finger off its neutral spot. */
  readonly stretch: number
  /** Shifting and crossing a string at the same moment is awkward. */
  readonly awkwardCrossWhileShifting: number
}

export const DEFAULT_WEIGHTS: FingeringWeights = {
  shiftBase: 8,
  shiftPerStep: 3,
  stringCross: 1,
  openStringBonus: -2,
  fourthFinger: 1.5,
  positionHeight: 1,
  stretch: 4,
  awkwardCrossWhileShifting: 2,
}

/**
 * For players who have been told to avoid open strings in expressive playing —
 * an open string cannot be given vibrato.
 */
export const OPEN_STRING_AVERSE_WEIGHTS: FingeringWeights = {
  ...DEFAULT_WEIGHTS,
  openStringBonus: 3,
}

export interface FingeringOptions {
  readonly maxPosition: number
  readonly allowedStrings?: readonly StringId[]
  readonly weights: FingeringWeights
  /** Pin the opening string, for scales that conventionally start somewhere. */
  readonly startString?: StringId
  readonly maxStretch: number
}

const DEFAULT_OPTIONS: FingeringOptions = {
  maxPosition: 5,
  weights: DEFAULT_WEIGHTS,
  maxStretch: 1,
}

export interface ShiftMarker {
  /** Index of the note arrived at. */
  readonly atIndex: number
  readonly fromPosition: Position
  readonly toPosition: Position
  readonly direction: 'up' | 'down'
  readonly string: StringId
  readonly withStringCross: boolean
  /** Same finger either side of the shift — the classic guided shift. */
  readonly guideFinger: Finger | null
  readonly label: string
}

export interface FingeredNote {
  readonly index: number
  readonly pitch: Pitch
  readonly placement: Placement
  readonly shiftIntoThisNote: ShiftMarker | null
}

export type FingeringWarning =
  | { readonly kind: 'below-range'; readonly pitch: Pitch; readonly message: string }
  | {
      readonly kind: 'above-max-position'
      readonly pitch: Pitch
      readonly message: string
    }
  | { readonly kind: 'no-placement'; readonly pitch: Pitch; readonly message: string }

export interface FingeringPlan {
  readonly notes: readonly FingeredNote[]
  readonly shifts: readonly ShiftMarker[]
  readonly positionsUsed: readonly Position[]
  readonly stringsUsed: readonly StringId[]
  readonly staysInFirstPosition: boolean
  readonly highestPosition: Position
  readonly cost: number
  readonly warnings: readonly FingeringWarning[]
  /** False when some note had no playable placement at all. */
  readonly complete: boolean
}

function placementCost(pl: Placement, w: FingeringWeights): number {
  let cost = w.positionHeight * (pl.position - 1)
  cost += w.stretch * Math.abs(pl.stretch)
  if (pl.finger === 4) cost += w.fourthFinger
  if (pl.isOpen) cost += w.openStringBonus
  return cost
}

function transitionCost(
  fromCarried: Position,
  from: Placement,
  to: Placement,
  w: FingeringWeights,
): number {
  let cost = 0

  // An open string leaves the hand where it was, so compare against the carried
  // position rather than the open placement's nominal one.
  const toPosition = to.isOpen ? fromCarried : to.position
  const positionDelta = Math.abs(toPosition - fromCarried)

  if (positionDelta > 0) {
    cost += w.shiftBase + w.shiftPerStep * positionDelta
  }

  const stringDelta = Math.abs(STRINGS[to.string].index - STRINGS[from.string].index)
  if (stringDelta > 0) {
    cost += w.stringCross * stringDelta
    if (positionDelta > 0) cost += w.awkwardCrossWhileShifting
  }

  return cost
}

interface SearchState {
  readonly placement: Placement
  /** Where the hand actually is, which an open string does not change. */
  readonly carried: Position
  readonly cost: number
  readonly previous: number | null
}

/**
 * Exact shortest path over placements.
 *
 * Each layer holds one state per (placement, carried position) pair. Because an
 * open string preserves the carried position, the same placement can appear in
 * several states with different hands behind it — which is precisely the case a
 * simpler formulation gets wrong.
 */
function search(
  candidates: readonly Placement[][],
  w: FingeringWeights,
): { path: Placement[]; cost: number } | null {
  if (candidates.length === 0) return null

  const layers: SearchState[][] = []

  const first = candidates[0]
  if (first === undefined || first.length === 0) return null

  layers.push(
    first.map((placement) => ({
      placement,
      carried: placement.isOpen ? 1 : placement.position,
      cost: placementCost(placement, w),
      previous: null,
    })),
  )

  for (let i = 1; i < candidates.length; i++) {
    const options = candidates[i]
    if (options === undefined || options.length === 0) return null

    const previousLayer = layers[i - 1]
    if (previousLayer === undefined) return null

    const nextLayer: SearchState[] = []
    // Keep only the cheapest route into each (placement, carried) pair.
    const bestByKey = new Map<string, number>()

    for (const placement of options) {
      for (const [prevIndex, prev] of previousLayer.entries()) {
        const carried = placement.isOpen ? prev.carried : placement.position
        const cost =
          prev.cost +
          placementCost(placement, w) +
          transitionCost(prev.carried, prev.placement, placement, w)

        const key = `${placement.string}:${placement.finger}:${placement.position}:${carried}`
        const existing = bestByKey.get(key)
        if (existing !== undefined && existing <= cost) continue

        bestByKey.set(key, cost)
        nextLayer.push({ placement, carried, cost, previous: prevIndex })
      }
    }

    if (nextLayer.length === 0) return null
    layers.push(nextLayer)
  }

  const lastLayer = layers[layers.length - 1]
  if (lastLayer === undefined || lastLayer.length === 0) return null

  let bestIndex = 0
  for (const [i, state] of lastLayer.entries()) {
    const best = lastLayer[bestIndex]
    if (best === undefined || state.cost < best.cost) bestIndex = i
  }

  const path: Placement[] = []
  let layerIndex = layers.length - 1
  let stateIndex: number | null = bestIndex
  const total = lastLayer[bestIndex]?.cost ?? 0

  while (layerIndex >= 0 && stateIndex !== null) {
    const state: SearchState | undefined = layers[layerIndex]?.[stateIndex]
    if (state === undefined) break
    path.unshift(state.placement)
    stateIndex = state.previous
    layerIndex -= 1
  }

  return { path, cost: total }
}

function buildShifts(path: readonly Placement[]): ShiftMarker[] {
  const shifts: ShiftMarker[] = []
  let carried: Position = path[0]?.isOpen ? 1 : (path[0]?.position ?? 1)

  for (let i = 1; i < path.length; i++) {
    const current = path[i]
    const previous = path[i - 1]
    if (current === undefined || previous === undefined) continue

    if (current.isOpen) continue // the hand did not move

    if (current.position !== carried) {
      const guideFinger =
        !previous.isOpen && previous.finger === current.finger ? current.finger : null
      shifts.push({
        atIndex: i,
        fromPosition: carried,
        toPosition: current.position,
        direction: current.position > carried ? 'up' : 'down',
        string: current.string,
        withStringCross: current.string !== previous.string,
        guideFinger,
        label: `shift to ${positionName(current.position)}`,
      })
      carried = current.position
    }
  }

  return shifts
}

/** Assign a fingering to an explicit run of pitches. */
export function fingerNotes(
  pitches: readonly Pitch[],
  o: Partial<FingeringOptions> = {},
): FingeringPlan {
  const options: FingeringOptions = { ...DEFAULT_OPTIONS, ...o }
  const warnings: FingeringWarning[] = []

  const candidates: Placement[][] = []
  for (const [index, pitch] of pitches.entries()) {
    const query = {
      maxPosition: options.maxPosition,
      maxStretch: options.maxStretch,
      ...(options.allowedStrings ? { allowedStrings: options.allowedStrings } : {}),
    }
    let places = placementsFor(pitch, query)

    // Pin the opening string when the caller asked for it.
    if (index === 0 && options.startString) {
      const pinned = places.filter((x) => x.string === options.startString)
      if (pinned.length > 0) places = pinned
    }

    if (places.length === 0) {
      if (toMidi(pitch) < toMidi(LOWEST_PITCH)) {
        warnings.push({
          kind: 'below-range',
          pitch,
          message: `${formatPitch(pitch)} is below the open C string`,
        })
      } else if (toMidi(pitch) > toMidi(HIGHEST_PRACTICAL)) {
        warnings.push({
          kind: 'above-max-position',
          pitch,
          message: `${formatPitch(pitch)} is above the range this app covers`,
        })
      } else {
        warnings.push({
          kind: 'no-placement',
          pitch,
          message: `${formatPitch(pitch)} needs a position above ${options.maxPosition}`,
        })
      }
    }
    candidates.push(places)
  }

  const result = search(candidates, options.weights)

  if (result === null) {
    return {
      notes: [],
      shifts: [],
      positionsUsed: [],
      stringsUsed: [],
      staysInFirstPosition: false,
      highestPosition: 0,
      cost: Number.POSITIVE_INFINITY,
      warnings,
      complete: false,
    }
  }

  const shifts = buildShifts(result.path)
  const shiftByIndex = new Map(shifts.map((s) => [s.atIndex, s]))

  const notes: FingeredNote[] = result.path.map((placement, index) => ({
    index,
    pitch: pitches[index] ?? placement.pitch,
    placement,
    shiftIntoThisNote: shiftByIndex.get(index) ?? null,
  }))

  const stopped = result.path.filter((x) => !x.isOpen)
  const positionsUsed = [...new Set(stopped.map((x) => x.position))].sort((a, b) => a - b)
  const stringsUsed = [...new Set(result.path.map((x) => x.string))]
  const highestPosition = positionsUsed.length > 0 ? Math.max(...positionsUsed) : 1

  return {
    notes,
    shifts,
    positionsUsed,
    stringsUsed,
    staysInFirstPosition: shifts.length === 0 && highestPosition === 1,
    highestPosition,
    cost: result.cost,
    warnings,
    complete: true,
  }
}
