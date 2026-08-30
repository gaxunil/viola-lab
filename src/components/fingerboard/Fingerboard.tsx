/**
 * The fingerboard diagram.
 *
 * Drawn as inline SVG rather than canvas, for three reasons: it scales to any
 * phone without a second render pass, every dot is a real element that can carry
 * a title, and the whole thing can be given one honest accessible name instead
 * of being a bitmap with a caption bolted on.
 *
 * It is NOT a guitar fretboard, and it must not look like one. A viola has no
 * frets, so there is nothing on the instrument corresponding to a hard vertical
 * line: a note is a place your finger learns, not a slot it drops into. The
 * position references are therefore faint dashed lines with names, and the
 * semitone scale along the bottom edge is a ruler, not a grid. Everything about
 * where a note lives is carried by the dot itself.
 *
 * The reader is an advanced player and a beginner theorist. She already knows
 * where the notes are. What the diagram is for is showing her how the scale she
 * can already play maps onto the theory she is learning, and — the fact she most
 * needs — where her hand has to move.
 *
 * All geometry lives in `fingerboardLayout.ts`, which is testable in node. This
 * file is only the part that needs a browser.
 */

import { type JSX, For, Show, createMemo } from 'solid-js'
import { type Scale } from '@core/scale/scale'
import { type FingeringPlan } from '@core/viola/fingering'
import { positionName } from '@core/viola/fingerboard'
import {
  type FingerboardDot,
  type LabelMode,
  buildFingerboardLayout,
  describeFingerboard,
  dotForPlanNote,
} from './fingerboardLayout'

export interface FingerboardProps {
  scale?: Scale
  plan?: FingeringPlan
  labelMode?: LabelMode
  /** The note currently sounding. */
  highlightIndex?: number | null
  showShifts?: boolean
}

/**
 * A landscape box on a portrait phone. At 360 CSS pixels wide the viewBox scales
 * by about 1.06, so a 10-unit label renders near 10.6px and a dot near 20px
 * across — above the 44px tap target only when tapped as a group, which is fine
 * because nothing here is tappable.
 */
const VIEW_W = 340
const VIEW_H = 168

/** Left gutter: room for the string numeral and its open note. */
const BOARD_X0 = 46
const BOARD_X1 = VIEW_W - 16
const BOARD_W = BOARD_X1 - BOARD_X0
/** Top gutter: room for a shift arc to arch over the A string. */
const BAND_Y0 = 30
/** Bottom gutter: room for the position names under the board. */
const BAND_H = VIEW_H - BAND_Y0 - 24

/** Thicker for the lower strings; a C string really is visibly fatter. */
const STRING_WIDTH: readonly number[] = [1.1, 1.6, 2.3, 3.2]

const R_PLAYED = 9.5
const R_HIGHLIGHT = 11.5
/** With a plan on screen the other scale notes are context, and shrink to rings. */
const R_GHOST_QUIET = 4
/** Without a plan the scale map IS the content, so its dots are readable. */
const R_GHOST_LOUD = 8

const cxOf = (dot: FingerboardDot): number => BOARD_X0 + dot.x * BOARD_W
const cyOf = (y: number): number => BAND_Y0 + y * BAND_H

/**
 * Label a shift with the position it arrives in.
 *
 * "pos." is not decoration. In a music app "3rd" and "6th" read as INTERVALS
 * first — a third and a sixth are notes apart, not places on the neck — so the
 * bare ordinal actively misleads. The two extra characters remove the ambiguity.
 */
const shortPosition = (position: number): string =>
  `${positionName(position).split(' ')[0] ?? String(position)} pos.`

interface ShiftArc {
  readonly path: string
  readonly tipX: number
  readonly tipY: number
  readonly angle: number
  readonly labelX: number
  readonly labelY: number
  readonly label: string
  readonly title: string
}

export default function Fingerboard(props: FingerboardProps): JSX.Element {
  // Conditional spreads throughout: `exactOptionalPropertyTypes` forbids writing
  // an explicit undefined into an optional property, and a parent that has not
  // chosen a scale yet passes exactly that.
  const options = createMemo(() => ({
    ...(props.scale === undefined ? {} : { scale: props.scale }),
    ...(props.plan === undefined ? {} : { plan: props.plan }),
    ...(props.labelMode === undefined ? {} : { labelMode: props.labelMode }),
  }))

  const layout = createMemo(() => buildFingerboardLayout(options()))
  const summary = createMemo(() => describeFingerboard(options()))

  const planned = createMemo(() => layout().dots.filter((dot) => dot.inPlan))
  const ghosts = createMemo(() => layout().dots.filter((dot) => !dot.inPlan))
  const ghostRadius = createMemo(() => (props.plan === undefined ? R_GHOST_LOUD : R_GHOST_QUIET))
  /**
   * A ghost dot is labelled only when it is the whole story. Alongside a
   * fingering it is background — the shape of the scale across the board — and
   * printing a note name in every one of them would bury the route she is
   * meant to read.
   */
  const showGhostLabels = createMemo(() => props.plan === undefined)

  /**
   * The highlight follows the plan, not the dot's own `noteIndex`: a spot the
   * scale touches twice records only its first visit, and playback has to light
   * up on the way down too.
   */
  const highlighted = createMemo<FingerboardDot | null>(() => {
    const plan = props.plan
    const index = props.highlightIndex
    if (plan === undefined || index === undefined || index === null) return null
    return dotForPlanNote(layout(), plan, index)
  })

  const semitoneTicks = createMemo(() => {
    // A plain loop rather than Array.from: the mapper closure reads the layout
    // signal, and while it would run synchronously inside this memo and track
    // correctly, the lint rule cannot see that. No closure, no ambiguity.
    const rows = layout().rows
    const ticks: number[] = []
    for (let i = 0; i <= rows; i++) ticks.push(BOARD_X0 + (i / rows) * BOARD_W)
    return ticks
  })

  // Shifts are on by default. Where the hand moves is the single most useful
  // thing this diagram knows that a printed scale sheet does not tell her.
  const arcs = createMemo<ShiftArc[]>(() => {
    const plan = props.plan
    if (plan === undefined || props.showShifts === false) return []

    const current = layout()
    const out: ShiftArc[] = []

    for (const shift of plan.shifts) {
      const to = dotForPlanNote(current, plan, shift.atIndex)
      const from = dotForPlanNote(current, plan, shift.atIndex - 1)
      if (to === null || from === null) continue

      const x1 = cxOf(from)
      const y1 = cyOf(from.y) - R_PLAYED - 3
      const x2 = cxOf(to)
      const y2 = cyOf(to.y) - R_PLAYED - 4
      const controlX = (x1 + x2) / 2
      const controlY = Math.min(y1, y2) - 15

      out.push({
        path: `M ${x1} ${y1} Q ${controlX} ${controlY} ${x2} ${y2}`,
        tipX: x2,
        tipY: y2,
        // The end tangent of a quadratic curve points away from its control
        // point, so the arrowhead can be aimed without sampling the path.
        angle: (Math.atan2(y2 - controlY, x2 - controlX) * 180) / Math.PI,
        labelX: controlX,
        labelY: controlY - 3,
        label: shortPosition(shift.toPosition),
        title: shift.label,
      })
    }

    return out
  })

  return (
    <svg
      class="fingerboard"
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      preserveAspectRatio="xMidYMid meet"
      role="img"
      aria-label={summary()}
      style={{
        display: 'block',
        width: '100%',
        height: 'auto',
        'max-width': '100%',
        // currentColor below resolves to this, so the ink follows the theme.
        color: 'var(--text)',
      }}
    >
      <title>{summary()}</title>

      {/* The board itself. Ebony on a viola, so it sits slightly proud of the page. */}
      <rect
        x={BOARD_X0}
        y={BAND_Y0}
        width={BOARD_W}
        height={BAND_H}
        rx="5"
        fill="var(--surface)"
      />

      {/* A ruler, not a grid: one faint tick per semitone along the bottom edge.
          There are no frets to draw, and drawing lines across the board would
          invent an instrument she does not play. */}
      <g stroke="var(--muted)" stroke-width="1" opacity="0.22">
        <For each={semitoneTicks()}>
          {(x) => <line x1={x} y1={BAND_Y0 + BAND_H - 5} x2={x} y2={BAND_Y0 + BAND_H} />}
        </For>
      </g>

      {/* Caption the axis once, so the ordinals below are read as places on the
          neck rather than as intervals. */}
      <text
        x={BOARD_X0 - 6}
        y={BAND_Y0 + BAND_H + 13}
        text-anchor="end"
        font-size="7.5"
        fill="var(--muted)"
        opacity="0.85"
      >
        position
      </text>

      <For each={layout().positionMarkers}>
        {(marker) => (
          <g>
            <line
              x1={BOARD_X0 + marker.x * BOARD_W}
              y1={BAND_Y0 + 4}
              x2={BOARD_X0 + marker.x * BOARD_W}
              y2={BAND_Y0 + BAND_H - 4}
              stroke="var(--muted)"
              stroke-width="1"
              stroke-dasharray="2 5"
              opacity="0.45"
            />
            <text
              x={BOARD_X0 + marker.x * BOARD_W}
              y={BAND_Y0 + BAND_H + 13}
              text-anchor="middle"
              font-size="8.5"
              fill="var(--muted)"
            >
              {marker.label}
            </text>
          </g>
        )}
      </For>

      {/* The nut. Everything to its left is off the string. */}
      <rect
        x={BOARD_X0 - 2.5}
        y={BAND_Y0 + 2}
        width="3.5"
        height={BAND_H - 4}
        rx="1.5"
        fill="currentColor"
        opacity="0.8"
      />

      <For each={layout().strings}>
        {(string) => (
          <g>
            <line
              x1={BOARD_X0}
              y1={cyOf(string.y)}
              x2={BOARD_X1}
              y2={cyOf(string.y)}
              stroke="var(--muted)"
              stroke-width={STRING_WIDTH[string.index] ?? 1.5}
              stroke-linecap="round"
              opacity="0.55"
            />
            {/* Numeral above, open note below: she thinks "the G string", the
                theory calls it III, and the diagram has to speak both. The
                octave rides along, because G3 and G4 are one letter to a
                beginner and two very different places on the instrument. */}
            <text
              x={BOARD_X0 - 19}
              y={cyOf(string.y) - 3}
              text-anchor="end"
              font-size="8"
              fill="var(--muted)"
            >
              {string.id}
            </text>
            <text
              x={BOARD_X0 - 19}
              y={cyOf(string.y) + 8}
              text-anchor="end"
              font-size="10.5"
              font-weight="600"
              fill="currentColor"
            >
              {string.openLabel}
            </text>
          </g>
        )}
      </For>

      {/* Scale notes the fingering does not use, drawn first so the route sits
          on top of them. */}
      <For each={ghosts()}>
        {(dot) => (
          <g>
            <title>{`${dot.label} — ${dot.string} string`}</title>
            <circle
              cx={cxOf(dot)}
              cy={cyOf(dot.y)}
              r={ghostRadius()}
              fill="var(--bg)"
              stroke="var(--muted)"
              stroke-width={dot.isOpen ? 2 : 1.2}
              stroke-dasharray={dot.isOpen ? 'none' : '2.5 2'}
            />
            <Show when={dot.isTonic}>
              <circle
                cx={cxOf(dot)}
                cy={cyOf(dot.y)}
                r={ghostRadius() + 3}
                fill="none"
                stroke="currentColor"
                stroke-width="1.1"
                opacity="0.75"
              />
            </Show>
            <Show when={showGhostLabels()}>
              <text
                x={cxOf(dot)}
                y={cyOf(dot.y)}
                text-anchor="middle"
                dominant-baseline="central"
                font-size={dot.label.length > 1 ? '8' : '9.5'}
                fill="var(--muted)"
              >
                {dot.label}
              </text>
            </Show>
          </g>
        )}
      </For>

      {/* Shift markers: an arc from the note the hand leaves to the note it
          arrives on, named with the position it arrives in. */}
      <For each={arcs()}>
        {(arc) => (
          <g fill="currentColor" stroke="currentColor">
            <title>{arc.title}</title>
            <path d={arc.path} fill="none" stroke-width="1.4" opacity="0.9" />
            <polygon
              points="0,0 -6.5,-3 -6.5,3"
              transform={`translate(${arc.tipX} ${arc.tipY}) rotate(${arc.angle})`}
              stroke="none"
            />
            <text
              x={arc.labelX}
              y={arc.labelY}
              text-anchor="middle"
              font-size="8.5"
              font-weight="600"
              stroke="none"
            >
              {arc.label}
            </text>
          </g>
        )}
      </For>

      {/* The fingering itself. Three signals, none of them colour alone: an open
          string is a ring and a stopped note is filled; the tonic wears an outer
          ring; the sounding note is larger and outlined. */}
      <For each={planned()}>
        {(dot) => {
          const isLive = (): boolean => highlighted() === dot
          const radius = (): number => (isLive() ? R_HIGHLIGHT : R_PLAYED)
          return (
            <g>
              <title>
                {`${dot.label} — ${dot.string} string${
                  dot.isOpen ? ', open' : `, ${positionName(dot.position ?? 1)}`
                }${dot.isTonic ? ', the tonic' : ''}`}
              </title>
              <Show when={dot.isTonic}>
                <circle
                  cx={cxOf(dot)}
                  cy={cyOf(dot.y)}
                  r={radius() + 3.4}
                  fill="none"
                  stroke="currentColor"
                  stroke-width="1.3"
                />
              </Show>
              <circle
                cx={cxOf(dot)}
                cy={cyOf(dot.y)}
                r={radius()}
                fill={dot.isOpen ? 'var(--bg)' : 'var(--accent)'}
                stroke={dot.isOpen ? 'var(--accent)' : 'none'}
                stroke-width={dot.isOpen ? 2.2 : 0}
              />
              <Show when={isLive()}>
                <circle
                  cx={cxOf(dot)}
                  cy={cyOf(dot.y)}
                  r={radius() + 4.5}
                  fill="none"
                  stroke="currentColor"
                  stroke-width="2.2"
                />
              </Show>
              <text
                x={cxOf(dot)}
                y={cyOf(dot.y)}
                text-anchor="middle"
                dominant-baseline="central"
                font-size={dot.label.length > 1 ? '9' : '10.5'}
                font-weight={isLive() ? '700' : '600'}
                fill={dot.isOpen ? 'var(--accent)' : 'var(--bg)'}
              >
                {dot.label}
              </text>
            </g>
          )
        }}
      </For>
    </svg>
  )
}
