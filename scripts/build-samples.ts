/**
 * Build the sampled viola: download the University of Iowa 2012 arco viola
 * recordings, pick one recording per semitone across C3-A6, and convert each
 * into a short mono AAC clip that the browser sampler streams.
 *
 * This is an offline build tool. It runs on a laptop, writes into
 * public/samples/viola-v1/, and that committed output is what ships. Nothing
 * here reaches the browser, so it may use the filesystem, the network, ffmpeg,
 * and console.log freely — progress output is the point, a silent hour looks
 * like a hang.
 *
 *   bun run scripts/build-samples.ts            download if needed, convert everything
 *   bun run scripts/build-samples.ts --check    report what exists, touch the network never
 *   bun run scripts/build-samples.ts --force    re-convert even where outputs exist
 *   bun run scripts/build-samples.ts --opus     additionally emit .opus alongside the .m4a
 *
 * Licence: the Iowa Electronic Music Studios set carries an explicit
 * unrestricted grant — "freely available on this website and may be downloaded
 * and used for any projects, without restrictions"
 * (https://theremin.music.uiowa.edu/MIS.html). No attribution is demanded; we
 * give it anyway, in README.md and in the manifest.
 */

import { spawn } from 'node:child_process'
import { mkdir, readdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'

const REPO = join(import.meta.dir, '..')

/** Raw downloads and unpacked AIFF. Gitignored: an input, not an artifact. */
const CACHE = join(REPO, 'samples-src')
const ZIP_DIR = CACHE
const AIF_DIR = join(CACHE, 'aif')
const WORK_DIR = join(CACHE, 'work')

/** The committed output. Versioned in the path so a future re-render can ship alongside. */
const OUT_DIR = join(REPO, 'public', 'samples', 'viola-v1')

const LOWEST_MIDI = 48 // C3, the open C string
const HIGHEST_MIDI = 93 // A6

/**
 * A6 is the top because three-octave scales are the audition material this app
 * exists to drill, and from an A root a three-octave scale ends on A6. It is
 * also exactly where the Iowa A-string archive stops, so the app's ceiling and
 * the available recordings agree — nothing has to be transposed to reach it.
 */

const MAX_SECONDS = 2.5
const FADE_SECONDS = 0.12

/**
 * Loudness target. See normaliseGain() for why this is a measured constant
 * gain rather than ffmpeg's loudnorm.
 */
const TARGET_LUFS = -18
const TRUE_PEAK_CEILING_DBTP = -1

type StringId = 'sulC' | 'sulG' | 'sulD' | 'sulA'

type ViolaString = {
  readonly id: StringId
  /** MIDI note of the open string. Drives the preference order in chooseString(). */
  readonly openMidi: number
  /** Verified Content-Length. A cached zip of exactly this size is not re-fetched. */
  readonly zipBytes: number
}

/**
 * The four arco zips. Ordered low to high; chooseString() relies on openMidi,
 * not on this order, but keeping them sorted makes the reports readable.
 *
 *   string | open | sampled range | zip
 *   sulC   | C3   | C3-C5         | 20,694,437 B
 *   sulG   | G3   | G3-G5         | 22,355,623 B
 *   sulD   | D4   | D4-D6         | 21,043,961 B
 *   sulA   | A4   | A4-A6         | 18,012,343 B
 */
const STRINGS: readonly ViolaString[] = [
  { id: 'sulC', openMidi: 48, zipBytes: 20_694_437 },
  { id: 'sulG', openMidi: 55, zipBytes: 22_355_623 },
  { id: 'sulD', openMidi: 62, zipBytes: 21_043_961 },
  { id: 'sulA', openMidi: 69, zipBytes: 18_012_343 },
]

/**
 * Per-note escape hatch from the chooseString() rule. Empty today; it exists so
 * that "this particular note sounds wrong on that string" is a one-line data
 * change rather than a rewrite of the selection logic. Keys are MIDI numbers.
 */
const STRING_OVERRIDES: Readonly<Record<number, StringId>> = {}

/**
 * Which recording to use for a note when several strings cover it.
 *
 * The rule: the highest string whose open pitch is at or below the note. That
 * is where a player most often is — you cross to the next string as soon as it
 * is available rather than climbing far up a lower one, and the timbre of a
 * note played near the bottom of its string is the one an ear expects. It gives
 * a clean four-way split with the boundaries exactly on the open strings:
 *
 *   C3-F#3  (48-54) -> sulC
 *   G3-B3   (55-61) -> sulG
 *   D4-G#4  (62-68) -> sulD
 *   A4-A6   (69-93) -> sulA
 *
 * If the preferred string is missing (a download failed), fall back to the
 * highest string that does have the note, and let the caller report it.
 */
function chooseString(midi: number, have: ReadonlySet<string>): ViolaString | undefined {
  const override = STRING_OVERRIDES[midi]
  if (override !== undefined) {
    const forced = STRINGS.find((s) => s.id === override)
    if (forced && have.has(indexKey(forced.id, midi))) return forced
  }

  const covering = STRINGS.filter((s) => have.has(indexKey(s.id, midi)))
  if (covering.length === 0) return undefined

  const atOrBelow = covering.filter((s) => s.openMidi <= midi)
  const pool = atOrBelow.length > 0 ? atOrBelow : covering
  return pool.reduce((best, s) => (s.openMidi > best.openMidi ? s : best))
}

const indexKey = (id: StringId, midi: number) => `${id}:${midi}`

/**
 * Note names. Sharps, because these are MIDI note labels rather than musical
 * spellings — the app spells notes in key context through src/core/pitch. The
 * source recordings are named with flats (Ab4, Bb4...), which parsePitch()
 * handles; nothing downstream depends on the source spelling.
 */
const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'] as const

function midiToName(midi: number): string {
  const name = NOTE_NAMES[((midi % 12) + 12) % 12]
  if (name === undefined) throw new Error(`unreachable: no name for midi ${midi}`)
  return `${name}${Math.floor(midi / 12) - 1}`
}

/**
 * Filename convention: lowercase the note name and spell the accidental out.
 * c3.m4a, csharp3.m4a. A literal '#' is a URL fragment delimiter and would need
 * escaping in every fetch; spelling it avoids the whole class of bug.
 */
const fileStem = (midi: number) => midiToName(midi).toLowerCase().replace('#', 'sharp')

const LETTER_SEMITONE: Readonly<Record<string, number>> = {
  C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11,
}

/** "Ab3" / "C#4" / "C3" -> MIDI, or undefined if the token is not a pitch. */
function parsePitch(token: string): number | undefined {
  const m = /^([A-G])([b#]?)(-?\d+)$/.exec(token)
  if (!m) return undefined
  const [, letter, accidental, octave] = m
  if (letter === undefined || octave === undefined) return undefined
  const base = LETTER_SEMITONE[letter]
  if (base === undefined) return undefined
  const alter = accidental === 'b' ? -1 : accidental === '#' ? 1 : 0
  return base + alter + (Number(octave) + 1) * 12
}

type RunResult = { readonly code: number; readonly stdout: string; readonly stderr: string }

function run(cmd: string, args: readonly string[]): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(cmd, [...args], { stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
    child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })
    child.on('error', reject)
    child.on('close', (code) => { resolve({ code: code ?? -1, stdout, stderr }) })
  })
}

async function ffmpeg(args: readonly string[]): Promise<RunResult> {
  const result = await run('ffmpeg', args)
  if (result.code !== 0) {
    throw new Error(`ffmpeg failed (${result.code}):\n${result.stderr.trimEnd()}`)
  }
  return result
}

const zipUrl = (id: StringId) =>
  'https://theremin.music.uiowa.edu/sound%20files/MIS%20Pitches%20-%202014/Strings/Viola/' +
  `Viola.arco.ff.${id}.stereo.zip`
// The path on the server contains spaces. Percent-encoding them is not optional:
// the unencoded URL is rejected rather than redirected.

const zipPath = (id: StringId) => join(ZIP_DIR, `Viola.arco.ff.${id}.stereo.zip`)

async function sizeOf(path: string): Promise<number> {
  const file = Bun.file(path)
  return (await file.exists()) ? file.size : -1
}

const kb = (bytes: number) => `${(bytes / 1024).toFixed(1)} kB`
const mb = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`

/** Download one zip, unless a cached copy is already exactly the right size. */
async function fetchZip(string: ViolaString): Promise<boolean> {
  const path = zipPath(string.id)
  if ((await sizeOf(path)) === string.zipBytes) {
    console.log(`  ${string.id}: cached (${mb(string.zipBytes)})`)
    return true
  }

  console.log(`  ${string.id}: downloading ${mb(string.zipBytes)}...`)
  // Stage through .part so an interrupted run cannot leave a truncated file
  // that a later run might mistake for a complete one.
  const partial = `${path}.part`
  try {
    // The Iowa server is a university box that stalls mid-transfer rather than
    // refusing, and a stalled build looks identical to a slow one. The timeout
    // turns that into a failure we can report and route around.
    //
    // The body is buffered rather than streamed straight into Bun.write: handing
    // Bun.write a Response whose stream is later aborted leaves it waiting
    // forever, so the abort never surfaces. Twenty megabytes in memory is a fine
    // price for a rejection that actually arrives.
    const response = await fetch(zipUrl(string.id), { signal: AbortSignal.timeout(5 * 60_000) })
    if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`)
    await Bun.write(partial, await response.arrayBuffer())
    const got = await sizeOf(partial)
    if (got !== string.zipBytes) {
      throw new Error(`size mismatch: expected ${string.zipBytes} B, got ${got} B`)
    }
    await rename(partial, path)
    console.log(`  ${string.id}: ok`)
    return true
  } catch (error) {
    await rm(partial, { force: true })
    // One dead string must not cost us the other three: the note selection
    // degrades to whatever did arrive, and the final report names the gap.
    console.error(`  ${string.id}: FAILED — ${error instanceof Error ? error.message : error}`)
    return false
  }
}

/**
 * Unpack the .aif files. Note the extension is .aif, not .aiff, and every
 * archive also carries a __MACOSX/._* resource fork per file which unzip -j
 * would otherwise flatten into the same directory.
 */
async function extract(string: ViolaString): Promise<void> {
  const dir = join(AIF_DIR, string.id)
  const existing = await readdir(dir).catch(() => [] as string[])
  if (existing.some((name) => name.endsWith('.aif'))) return

  await mkdir(dir, { recursive: true })
  const result = await run('unzip', [
    '-q', '-o', '-j', zipPath(string.id), '*.aif', '-x', '__MACOSX/*', '-d', dir,
  ])
  if (result.code !== 0) throw new Error(`unzip ${string.id} failed: ${result.stderr.trimEnd()}`)
}

type Source = { readonly string: ViolaString; readonly midi: number; readonly path: string }

/** Index every extracted recording by string and pitch. */
async function indexSources(available: readonly ViolaString[]): Promise<Map<string, Source>> {
  const index = new Map<string, Source>()
  for (const string of available) {
    const dir = join(AIF_DIR, string.id)
    const names = await readdir(dir).catch(() => [] as string[])
    for (const name of names) {
      if (!name.endsWith('.aif')) continue
      // Viola.arco.ff.sulC.Ab3.stereo.aif — scan the dot-separated tokens rather
      // than trusting a fixed position, so a stray naming variant still lands.
      const midi = name.split('.').map(parsePitch).find((v) => v !== undefined)
      if (midi === undefined) continue
      index.set(indexKey(string.id, midi), { string, midi, path: join(dir, name) })
    }
  }
  return index
}

/**
 * Parse ffmpeg's ebur128 summary. Both numbers are needed: the integrated
 * loudness sets the gain, the true peak caps it.
 */
function parseLoudness(stderr: string): { integrated: number; truePeak: number } | undefined {
  const integrated = /^\s*I:\s*(-?\d+(?:\.\d+)?)\s*LUFS/m.exec(stderr)
  const peak = /^\s*Peak:\s*(-?\d+(?:\.\d+)?)\s*dBFS/m.exec(stderr)
  if (!integrated?.[1] || !peak?.[1]) return undefined
  return { integrated: Number(integrated[1]), truePeak: Number(peak[1]) }
}

/**
 * Normalisation: one measured constant gain per note, chosen so the note lands
 * on TARGET_LUFS integrated loudness, then clamped so its true peak stays under
 * TRUE_PEAK_CEILING_DBTP.
 *
 * Why not ffmpeg's loudnorm: in its single-pass form loudnorm is a dynamic
 * processor — it compresses, and on a 2.5 s bowed note with a slow swell that
 * audibly flattens the attack. Its two-pass linear mode would be fine but is
 * the same measurement we do here with an extra encode.
 *
 * Why loudness rather than peak: peak normalisation equalises the wrong thing.
 * The Iowa notes were recorded over several sessions and their peaks do not
 * track how loud they sound, so a peak-matched chromatic scale still lurches.
 * Matching integrated LUFS is what actually makes the scale sit still. All 37
 * notes get the identical treatment, so nothing is relatively coloured.
 */
function normaliseGain(loudness: { integrated: number; truePeak: number }): number {
  const toTarget = TARGET_LUFS - loudness.integrated
  const toCeiling = TRUE_PEAK_CEILING_DBTP - loudness.truePeak
  return Math.min(toTarget, toCeiling)
}

async function durationOf(path: string): Promise<number> {
  const result = await run('ffprobe', [
    '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path,
  ])
  if (result.code !== 0) throw new Error(`ffprobe failed: ${result.stderr.trimEnd()}`)
  const seconds = Number(result.stdout.trim())
  if (!Number.isFinite(seconds)) throw new Error(`ffprobe gave no duration for ${path}`)
  return seconds
}

type Converted = {
  readonly midi: number
  readonly string: StringId
  readonly files: ReadonlyMap<string, number>
  readonly gainDb: number
}

/**
 * Convert one recording. Three ffmpeg passes over a two-second file, which is
 * cheap, and each pass does one comprehensible thing:
 *
 *   1. downmix to mono and cut the leading silence
 *   2. cap the length, fade the tail, and measure the result
 *   3. apply the measured gain and encode
 *
 * The split exists because the fade has to start FADE_SECONDS before the end of
 * whatever survived the silence trim, and that length is only knowable after
 * pass 1. Measuring in pass 2 means we measure exactly the audio we ship.
 */
async function convert(source: Source, emitOpus: boolean): Promise<Converted> {
  const stem = fileStem(source.midi)
  const trimmed = join(WORK_DIR, `${stem}.trim.wav`)
  const shaped = join(WORK_DIR, `${stem}.shape.wav`)

  // start_silence keeps 20 ms of the room ahead of the attack: cutting hard at
  // the first sample above threshold shaves the front of the bow transient,
  // which is most of what makes a sample sound like a string rather than a beep.
  await ffmpeg([
    '-hide_banner', '-loglevel', 'error', '-y', '-i', source.path,
    '-ac', '1', '-ar', '44100',
    '-af', 'silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.02:detection=peak',
    '-c:a', 'pcm_f32le', trimmed,
  ])

  const trimmedSeconds = await durationOf(trimmed)
  const length = Math.min(trimmedSeconds, MAX_SECONDS)
  const fadeStart = Math.max(0, length - FADE_SECONDS)

  // asetpts resets the timeline after atrim so afade's st= is relative to the
  // clip, not to wherever the trim landed in the original.
  const measured = await ffmpeg([
    '-hide_banner', '-y', '-i', trimmed,
    '-af', [
      `atrim=end=${length.toFixed(4)}`,
      'asetpts=N/SR/TB',
      `afade=t=out:st=${fadeStart.toFixed(4)}:d=${FADE_SECONDS}`,
      'ebur128=peak=true',
    ].join(','),
    '-c:a', 'pcm_f32le', shaped,
  ])

  const loudness = parseLoudness(measured.stderr)
  if (!loudness) throw new Error(`could not read loudness for ${stem}:\n${measured.stderr}`)
  const gainDb = normaliseGain(loudness)

  const files = new Map<string, number>()

  // AAC in .m4a, 64 kbps mono, and this is not a free choice. iOS is the
  // primary target and Safari's decodeAudioData handling of Ogg Opus is
  // unreliable; AAC is the one codec every WebKit build decodes. Opus is
  // strictly a bonus for other browsers.
  const m4a = join(OUT_DIR, `${stem}.m4a`)
  await ffmpeg([
    '-hide_banner', '-loglevel', 'error', '-y', '-i', shaped,
    '-af', `volume=${gainDb.toFixed(2)}dB`,
    '-c:a', 'aac', '-b:a', '64k', '-ac', '1', '-movflags', '+faststart', m4a,
  ])
  files.set('m4a', await sizeOf(m4a))

  if (emitOpus) {
    const opus = join(OUT_DIR, `${stem}.opus`)
    await ffmpeg([
      '-hide_banner', '-loglevel', 'error', '-y', '-i', shaped,
      '-af', `volume=${gainDb.toFixed(2)}dB`,
      '-c:a', 'libopus', '-b:a', '48k', '-ac', '1', opus,
    ])
    files.set('opus', await sizeOf(opus))
  }

  await rm(trimmed, { force: true })
  await rm(shaped, { force: true })

  return { midi: source.midi, string: source.string.id, files, gainDb }
}

/** Run tasks with a small amount of parallelism; ffmpeg is single-threaded here. */
async function pool<T, R>(
  items: readonly T[],
  width: number,
  worker: (item: T, index: number) => Promise<R>,
): Promise<readonly R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const runners = Array.from({ length: Math.min(width, items.length) }, async () => {
    for (;;) {
      const index = next++
      const item = items[index]
      if (item === undefined) return
      results[index] = await worker(item, index)
    }
  })
  await Promise.all(runners)
  return results
}

type Zone = {
  readonly midi: number
  readonly pitch: string
  readonly string: StringId
  readonly file: string
  readonly bytes: number
}

const CORE_ZONES = [48, 55, 62, 69] as const // the open strings: C3 G3 D4 A4

function buildManifest(converted: readonly Converted[], formats: readonly string[]) {
  const zones: Zone[] = converted
    .slice()
    .sort((a, b) => a.midi - b.midi)
    .map((c) => ({
      midi: c.midi,
      pitch: midiToName(c.midi),
      string: c.string,
      file: `${fileStem(c.midi)}.m4a`,
      bytes: c.files.get('m4a') ?? 0,
    }))

  return {
    name: 'Iowa Viola 2012 (arco, ff)',
    license: 'University of Iowa EMS — unrestricted use',
    sourceUrl: 'https://theremin.music.uiowa.edu/MIS.html',
    formats,
    lowestMidi: LOWEST_MIDI,
    highestMidi: HIGHEST_MIDI,
    // Zero, because the set is fully chromatic. Every note the app can ask for
    // has its own recording, so the sampler never transposes and the whole
    // class of pitch-shift artefacts simply does not arise.
    maxShiftSemitones: 0,
    releaseSec: 0.15,
    attackSec: 0.008,
    coreZones: [...CORE_ZONES],
    zones,
  }
}

const MIDI_RANGE: readonly number[] = Array.from(
  { length: HIGHEST_MIDI - LOWEST_MIDI + 1 },
  (_, i) => LOWEST_MIDI + i,
)

/** --check: describe the current state of the cache and the output. No network. */
async function check(): Promise<void> {
  console.log('Cached downloads:')
  for (const string of STRINGS) {
    const size = await sizeOf(zipPath(string.id))
    const state = size < 0 ? 'missing'
      : size === string.zipBytes ? `ok (${mb(size)})`
      : `WRONG SIZE (${size} B, expected ${string.zipBytes} B)`
    console.log(`  ${string.id}: ${state}`)
  }

  console.log('\nExtracted recordings:')
  for (const string of STRINGS) {
    const names = await readdir(join(AIF_DIR, string.id)).catch(() => [] as string[])
    const count = names.filter((n) => n.endsWith('.aif')).length
    console.log(`  ${string.id}: ${count} .aif`)
  }

  console.log('\nOutput:')
  const manifestFile = Bun.file(join(OUT_DIR, 'manifest.json'))
  if (!(await manifestFile.exists())) {
    console.log('  no manifest.json — nothing has been built')
  } else {
    const manifest = (await manifestFile.json()) as ReturnType<typeof buildManifest>
    let total = 0
    const broken: string[] = []
    for (const zone of manifest.zones) {
      const size = await sizeOf(join(OUT_DIR, zone.file))
      if (size !== zone.bytes) broken.push(`${zone.file} (manifest ${zone.bytes} B, disk ${size} B)`)
      if (size > 0) total += size
    }
    console.log(`  manifest.json: ${manifest.zones.length} zones, formats ${manifest.formats.join(', ')}`)
    console.log(`  audio on disk: ${mb(total)}`)
    if (broken.length > 0) {
      console.log(`  MISMATCHED: ${broken.join(', ')}`)
    } else {
      console.log('  every zone file present with the recorded size')
    }
    const missing = MIDI_RANGE.filter((m) => !manifest.zones.some((z) => z.midi === m))
    console.log(missing.length === 0
      ? `  range complete: ${midiToName(LOWEST_MIDI)}-${midiToName(HIGHEST_MIDI)}`
      : `  MISSING: ${missing.map(midiToName).join(' ')}`)
  }
}

async function build(force: boolean, emitOpus: boolean): Promise<void> {
  await mkdir(ZIP_DIR, { recursive: true })
  await mkdir(WORK_DIR, { recursive: true })
  await mkdir(OUT_DIR, { recursive: true })

  console.log('Downloads:')
  const available: ViolaString[] = []
  for (const string of STRINGS) {
    if (await fetchZip(string)) available.push(string)
  }
  if (available.length === 0) {
    console.error('\nNo source archives available. Nothing to build.')
    process.exit(1)
  }

  console.log('\nExtracting...')
  for (const string of available) await extract(string)
  const index = await indexSources(available)
  console.log(`  ${index.size} recordings indexed across ${available.length} strings`)

  const have = new Set(index.keys())
  const plan: Source[] = []
  const missing: number[] = []
  for (const midi of MIDI_RANGE) {
    const string = chooseString(midi, have)
    const source = string ? index.get(indexKey(string.id, midi)) : undefined
    if (!source) {
      missing.push(midi)
      continue
    }
    if (string && string.openMidi > midi) {
      console.warn(`  note: ${midiToName(midi)} falls back to ${string.id} (preferred string absent)`)
    }
    plan.push(source)
  }

  const todo = force ? plan : await filterExisting(plan, emitOpus)
  const skipped = plan.length - todo.length
  console.log(`\nConverting ${todo.length} notes${skipped > 0 ? ` (${skipped} already built)` : ''}:`)

  let done = 0
  const converted = await pool(todo, 4, async (source) => {
    const result = await convert(source, emitOpus)
    done += 1
    const bytes = result.files.get('m4a') ?? 0
    const label = `${midiToName(source.midi)}`.padEnd(4)
    console.log(
      `  [${String(done).padStart(2)}/${todo.length}] ${label} ${source.string.id}` +
      `  ${kb(bytes).padStart(9)}  ${result.gainDb >= 0 ? '+' : ''}${result.gainDb.toFixed(1)} dB`,
    )
    return result
  })

  // Notes skipped this run still belong in the manifest, so re-read their sizes.
  const carried: Converted[] = []
  for (const source of plan) {
    if (todo.includes(source)) continue
    const stem = fileStem(source.midi)
    const files = new Map<string, number>([['m4a', await sizeOf(join(OUT_DIR, `${stem}.m4a`))]])
    if (emitOpus) files.set('opus', await sizeOf(join(OUT_DIR, `${stem}.opus`)))
    carried.push({ midi: source.midi, string: source.string.id, files, gainDb: 0 })
  }

  const all = [...converted, ...carried]
  const formats = emitOpus ? ['m4a', 'opus'] : ['m4a']
  const manifest = buildManifest(all, formats)
  const manifestPath = join(OUT_DIR, 'manifest.json')
  await Bun.write(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`)

  await rm(WORK_DIR, { recursive: true, force: true })

  const audioBytes = all.reduce(
    (sum, c) => sum + [...c.files.values()].reduce((a, b) => a + b, 0),
    0,
  )
  const manifestBytes = await sizeOf(manifestPath)

  console.log('\nDone.')
  console.log(`  notes:     ${all.length} of ${MIDI_RANGE.length} (${midiToName(LOWEST_MIDI)}-${midiToName(HIGHEST_MIDI)})`)
  console.log(`  formats:   ${formats.join(', ')}`)
  console.log(`  audio:     ${mb(audioBytes)}`)
  console.log(`  manifest:  ${kb(manifestBytes)}`)
  console.log(`  committed: ${mb(audioBytes + manifestBytes)} in public/samples/viola-v1/`)
  console.log(missing.length === 0
    ? '  missing:   none'
    : `  MISSING:   ${missing.map(midiToName).join(' ')}`)
}

/** Drop notes whose outputs already exist, so a re-run costs seconds. */
async function filterExisting(plan: readonly Source[], emitOpus: boolean): Promise<Source[]> {
  const todo: Source[] = []
  for (const source of plan) {
    const stem = fileStem(source.midi)
    const m4a = await sizeOf(join(OUT_DIR, `${stem}.m4a`))
    const opus = emitOpus ? await sizeOf(join(OUT_DIR, `${stem}.opus`)) : 1
    if (m4a <= 0 || opus <= 0) todo.push(source)
  }
  return todo
}

const args = new Set(process.argv.slice(2))
if (args.has('--check')) {
  await check()
} else {
  await build(args.has('--force'), args.has('--opus'))
}
