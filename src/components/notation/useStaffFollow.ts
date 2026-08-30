import { createEffect, type Accessor } from 'solid-js'

/**
 * Keep the sounding note in view as the music runs past the edge of the panel.
 *
 * Two things here are less obvious than they look.
 *
 * The element that actually scrolls is usually a DESCENDANT of the host, because
 * the Staff component brings its own horizontally-scrolling wrapper. Assuming
 * the host scrolls means silently doing nothing, since the host never overflows.
 *
 * Position is estimated from the note's index rather than measured off the
 * rendered notehead. VexFlow lays these notes out evenly, and reaching into the
 * SVG to find a glyph would couple this to VexFlow's internals for a smoother
 * result nobody would notice.
 */
export interface StaffFollowOptions {
  readonly host: Accessor<HTMLElement | undefined>
  /** Which notated element is sounding, or null when nothing is. */
  readonly index: Accessor<number | null>
  readonly total: Accessor<number>
  readonly active: Accessor<boolean>
}

function findScroller(host: HTMLElement): HTMLElement | null {
  if (host.scrollWidth > host.clientWidth + 1) return host
  for (const child of host.querySelectorAll<HTMLElement>('*')) {
    if (child.scrollWidth > child.clientWidth + 1) return child
  }
  return null
}

export function followStaff(o: StaffFollowOptions): void {
  /**
   * Cached, because this runs once per note and querySelectorAll('*') over a
   * rendered stave is not cheap at practice tempo. Invalidated whenever the
   * cached node stops overflowing, which covers a re-render or a resize.
   */
  let cached: HTMLElement | null = null

  const scrollerWithin = (host: HTMLElement): HTMLElement | null => {
    if (cached && cached.isConnected && cached.scrollWidth > cached.clientWidth + 1) {
      return cached
    }
    cached = findScroller(host)
    return cached
  }

  createEffect(() => {
    const host = o.host()
    const index = o.index()
    const total = o.total()

    if (!host || total <= 0) return

    // Rewind to the start when playback stops, so a loop or a replay begins at
    // the beginning rather than wherever the last pass happened to end.
    if (!o.active() || index === null) {
      const idle = scrollerWithin(host)
      idle?.scrollTo({ left: 0, behavior: 'smooth' })
      return
    }

    const scroller = scrollerWithin(host)
    if (!scroller) return // it all fits; nothing to follow

    const overflow = scroller.scrollWidth - scroller.clientWidth
    if (overflow <= 0) return

    // Centre the note, clamped so the ends do not swing past the music.
    const target =
      (index / Math.max(1, total - 1)) * scroller.scrollWidth - scroller.clientWidth / 2
    scroller.scrollTo({ left: Math.max(0, Math.min(overflow, target)), behavior: 'smooth' })
  })
}
