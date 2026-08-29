/**
 * Getting iOS to make a sound at all.
 *
 * Two obstacles, and the second is the one that will make the app look broken.
 *
 * An AudioContext must be created inside a user gesture, and `resume()` can
 * reject or quietly do nothing, so readiness is confirmed by checking the state
 * after the promise settles rather than by assuming.
 *
 * Worse: **iOS silences Web Audio entirely when the hardware ring/silent switch
 * is on**, and there is no API to detect the switch. An `<audio>` element is not
 * affected, only Web Audio, because a Web-Audio-only page gets an "ambient"
 * audio session by default and ambient sessions obey the switch.
 *
 * Three layers of mitigation, in order of preference:
 *
 *   1. `navigator.audioSession.type = 'playback'` (Safari 16.4+). Declaring the
 *      page a media player is exactly true for a practice tool, and playback
 *      sessions ignore the switch. The tradeoff is that a playback session is
 *      non-mixing and will duck her other audio, so it is exposed as a setting.
 *   2. On older iOS, playing a tiny silent <audio> element in the same gesture
 *      establishes an element-backed session that Web Audio then rides along on.
 *   3. Honest UX. Neither of the above is guaranteed, so the app also offers a
 *      sound check that tells her to look at the switch.
 *
 * Note that nothing here can DETECT the mute switch. The graph renders normally
 * while the hardware output is silenced, so a level meter will bounce merrily
 * while she hears nothing. The meter's job is to prove the app is working and
 * point the finger at the device.
 */

export type SessionState = 'locked' | 'unlocking' | 'ready' | 'interrupted' | 'failed'

export type AudioSessionType = 'auto' | 'playback' | 'ambient' | 'transient' | 'play-and-record'

export interface AudioSessionApi {
  type: AudioSessionType
}

interface NavigatorWithAudioSession extends Navigator {
  readonly audioSession?: AudioSessionApi
}

/** A 50ms silent WAV, small enough to inline. */
const SILENT_WAV =
  'data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEARKwAAIhYAQACABAAZGF0YQAAAAA='

export const isIOS = (): boolean => {
  if (typeof navigator === 'undefined') return false
  const ua = navigator.userAgent
  // iPadOS 13+ reports as a Mac, so the touch-point check is load-bearing.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1)
}

/**
 * Ask for a non-mixing playback session.
 *
 * Returns false when the API is absent, which is the signal to fall back to the
 * silent-element trick and, ultimately, to telling her about the switch.
 */
export function applyPlaybackSession(type: AudioSessionType = 'playback'): boolean {
  if (typeof navigator === 'undefined') return false
  const session = (navigator as NavigatorWithAudioSession).audioSession
  if (!session || typeof session.type !== 'string') return false
  try {
    session.type = type
    return session.type === type
  } catch {
    return false
  }
}

export interface SilentElementKeepAlive {
  start(): void
  stop(): void
  readonly isRunning: boolean
}

/**
 * Play a looping silent element to drag Web Audio onto a non-ambient session.
 *
 * Only worth doing on iOS, and only until `navigator.audioSession` is
 * universally available. Costs a sliver of battery, so it is stopped when idle.
 */
export function createSilentKeepAlive(): SilentElementKeepAlive {
  let element: HTMLAudioElement | null = null

  return {
    get isRunning() {
      return element !== null
    },
    start() {
      if (element || typeof document === 'undefined') return
      const audio = document.createElement('audio')
      audio.src = SILENT_WAV
      audio.loop = true
      audio.setAttribute('playsinline', '')
      audio.volume = 0.0001
      void audio.play().catch(() => {
        // Blocked outside a gesture; the other two layers still apply.
      })
      element = audio
    },
    stop() {
      if (!element) return
      element.pause()
      element.removeAttribute('src')
      element = null
    },
  }
}
