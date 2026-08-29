/**
 * Every tuning knob in the audio path, each applied in exactly one place.
 *
 * The limiter settings are carried over unchanged from the companion slide deck,
 * where they were verified clip-safe under exactly the stacking this app does:
 * a drone, a click and several sampled notes sounding at once.
 */

export const MASTER_GAIN = 1.0

/** Peak of a single voice's envelope, before velocity. */
export const NOTE_PEAK = 0.45

/** The click is deliberately quieter than a note; it is a reference, not the music. */
export const CLICK_PEAK = 0.34

export const LIMITER = {
  threshold: -6,
  knee: 3,
  ratio: 12,
  attack: 0.003,
  release: 0.25,
} as const

/** Long enough to avoid a click, short enough to feel immediate. */
export const STOP_FADE_SEC = 0.06

/** A bowed note does not start instantly, but it must not click either. */
export const SYNTH_ATTACK_SEC = 0.07
export const SYNTH_RELEASE_SEC = 0.12

/** Click frequencies, high enough to cut through a viola without being shrill. */
export const CLICK_FREQ = {
  strong: 1600,
  medium: 1200,
  weak: 900,
} as const

export const CLICK_LENGTH_SEC = 0.035
