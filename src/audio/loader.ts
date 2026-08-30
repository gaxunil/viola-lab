/**
 * Fetching and decoding the sample set.
 *
 * Two rules here, both learned from how phones behave rather than from theory.
 *
 * Fetch everything in parallel but DECODE at most three at a time.
 * `decodeAudioData` is the expensive part and Safari has historically run it on
 * or near the main thread; turning forty-six decodes loose at once is what janks
 * a low-end phone, not the download.
 *
 * Load in two phases. The four open strings come first and are enough to start
 * playing, so `ready()` resolves in a fraction of the time; the rest arrive
 * behind it. On a school network that is the difference between "loading" and
 * "broken".
 */

export interface SampleZone {
  readonly midi: number
  readonly pitch: string
  readonly file: string
  readonly bytes?: number
}

export interface InstrumentManifest {
  readonly name: string
  readonly license?: string
  readonly sourceUrl?: string
  readonly formats: readonly string[]
  readonly zones: readonly SampleZone[]
  readonly lowestMidi: number
  readonly highestMidi: number
  readonly maxShiftSemitones: number
  readonly releaseSec: number
  readonly attackSec: number
  readonly coreZones?: readonly number[]
}

export interface LoadProgress {
  readonly loaded: number
  readonly total: number
  readonly failed: number
}

export interface LoadedSamples {
  readonly buffers: ReadonlyMap<number, AudioBuffer>
  readonly failed: readonly number[]
}

const DECODE_CONCURRENCY = 3

/** Run tasks with a cap on how many are in flight at once. */
async function withLimit<T>(
  tasks: ReadonlyArray<() => Promise<T>>,
  limit: number,
): Promise<Array<PromiseSettledResult<T>>> {
  const results: Array<PromiseSettledResult<T>> = new Array(tasks.length)
  let next = 0

  async function worker(): Promise<void> {
    for (;;) {
      const index = next++
      const task = tasks[index]
      if (task === undefined) return
      try {
        results[index] = { status: 'fulfilled', value: await task() }
      } catch (reason) {
        results[index] = { status: 'rejected', reason }
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker))
  return results
}

export interface LoadOptions {
  readonly baseUrl: string
  readonly context: BaseAudioContext
  readonly fetchImpl?: typeof fetch
  readonly onProgress?: (progress: LoadProgress) => void
  readonly signal?: AbortSignal
}

async function loadZones(
  zones: readonly SampleZone[],
  o: LoadOptions,
  into: Map<number, AudioBuffer>,
  failed: number[],
  progressBase: number,
  progressTotal: number,
): Promise<void> {
  const doFetch = o.fetchImpl ?? fetch
  let done = progressBase

  const tasks = zones.map((zone) => async () => {
    const url = `${o.baseUrl.replace(/\/$/, '')}/${zone.file}`
    const response = await doFetch(url, o.signal ? { signal: o.signal } : {})
    if (!response.ok) throw new Error(`${url} -> ${response.status}`)
    const bytes = await response.arrayBuffer()
    const buffer = await o.context.decodeAudioData(bytes)
    into.set(zone.midi, buffer)
    return zone.midi
  })

  const settled = await withLimit(tasks, DECODE_CONCURRENCY)

  for (const [index, result] of settled.entries()) {
    done += 1
    if (result.status === 'rejected') {
      const zone = zones[index]
      if (zone) failed.push(zone.midi)
    }
    o.onProgress?.({ loaded: done, total: progressTotal, failed: failed.length })
  }
}

export async function fetchManifest(
  baseUrl: string,
  fetchImpl: typeof fetch = fetch,
): Promise<InstrumentManifest> {
  const response = await fetchImpl(`${baseUrl.replace(/\/$/, '')}/manifest.json`)
  if (!response.ok) throw new Error(`sample manifest -> ${response.status}`)
  return (await response.json()) as InstrumentManifest
}

/**
 * Load the core zones, then hand back a promise for the rest.
 *
 * The caller can start playing as soon as the first promise resolves.
 */
export async function loadSamples(
  manifest: InstrumentManifest,
  o: LoadOptions,
): Promise<{ core: LoadedSamples; rest: Promise<LoadedSamples> }> {
  const buffers = new Map<number, AudioBuffer>()
  const failed: number[] = []

  const coreSet = new Set(manifest.coreZones ?? [])
  const core = manifest.zones.filter((z) => coreSet.has(z.midi))
  const remainder = manifest.zones.filter((z) => !coreSet.has(z.midi))

  await loadZones(core, o, buffers, failed, 0, manifest.zones.length)

  const rest = loadZones(remainder, o, buffers, failed, core.length, manifest.zones.length).then(
    () => ({ buffers, failed: [...failed] }),
  )

  return { core: { buffers, failed: [...failed] }, rest }
}
