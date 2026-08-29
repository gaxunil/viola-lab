/**
 * Static file server for the built SPA.
 *
 * Deliberately hand-rolled rather than nginx: the app is a Bun toolchain already,
 * and the headers that matter here are specific enough to be worth stating
 * explicitly — immutable caching for the versioned sample directory, no-cache for
 * the service worker, and a correct audio/mp4 type so iOS will decode the samples.
 */
import type { BunFile } from 'bun'

const DIST = new URL('./dist/', import.meta.url)
const PORT = Number(Bun.env.PORT ?? 8080)

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2',
  '.m4a': 'audio/mp4',
  '.opus': 'audio/ogg',
}

function cacheControl(pathname: string): string {
  // The service worker must never be served stale, or the app cannot update.
  if (pathname === '/sw.js' || pathname === '/registerSW.js') return 'no-cache'
  // Samples are versioned by directory (samples/viola-v1/...), so a new set is a
  // new URL. Safe to cache for a year.
  if (pathname.startsWith('/samples/')) return 'public, max-age=31536000, immutable'
  // Self-hosted notation fonts, so the staff renders offline.
  if (pathname.startsWith('/fonts/')) return 'public, max-age=31536000, immutable'
  // Vite emits hashed filenames into /assets.
  if (pathname.startsWith('/assets/')) return 'public, max-age=31536000, immutable'
  return 'no-cache'
}

/**
 * Resolve a request path to a file inside dist/.
 *
 * Returns the resolved *file* name alongside the handle, because the MIME type
 * must come from what we actually serve ("/" -> index.html), not from what was
 * requested.
 */
async function fileFor(pathname: string): Promise<{ file: BunFile; name: string } | null> {
  let decoded: string
  try {
    decoded = decodeURIComponent(pathname)
  } catch {
    return null // malformed percent-encoding
  }

  // Reject traversal after decoding, so %2e%2e%2f cannot slip through.
  if (decoded.includes('..') || decoded.includes('\\')) return null

  const name = decoded.replace(/^\/+/, '') || 'index.html'
  const file = Bun.file(new URL(name, DIST))
  return (await file.exists()) ? { file, name } : null
}

const server = Bun.serve({
  port: PORT,
  idleTimeout: 30,
  async fetch(req) {
    const url = new URL(req.url)

    if (url.pathname === '/healthz') {
      return new Response('ok', { headers: { 'content-type': 'text/plain' } })
    }

    const hit = await fileFor(url.pathname)

    // SPA fallback: any unmatched path renders the app shell.
    const resolved = hit ?? { file: Bun.file(new URL('index.html', DIST)), name: 'index.html' }

    const dot = resolved.name.lastIndexOf('.')
    const ext = dot === -1 ? '' : resolved.name.slice(dot)
    const headers = new Headers({
      'content-type': MIME[ext] ?? 'application/octet-stream',
      'cache-control': cacheControl(url.pathname),
      // The app is self-contained; nothing should be framing it.
      'x-content-type-options': 'nosniff',
      'x-frame-options': 'DENY',
    })

    return new Response(resolved.file, { headers })
  },
})

console.log(`viola-lab serving ${DIST.pathname} on :${server.port}`)
