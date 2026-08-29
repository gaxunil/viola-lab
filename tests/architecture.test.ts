import { readdirSync, readFileSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const SRC = fileURLToPath(new URL('../src/', import.meta.url))

/**
 * Walk a layer, returning [relativePath, source] for every implementation file.
 *
 * Test files are deliberately excluded: a test may legitimately name a forbidden
 * symbol (this file does), and the rule we care about is what ships, not what
 * asserts.
 */
function sourcesIn(layer: string): Array<[string, string]> {
  const root = join(SRC, layer)
  const out: Array<[string, string]> = []

  const walk = (dir: string) => {
    for (const entry of readdirSync(dir)) {
      const full = join(dir, entry)
      if (statSync(full).isDirectory()) {
        walk(full)
        continue
      }
      if (!/\.tsx?$/.test(entry)) continue
      if (/\.test\.tsx?$/.test(entry)) continue
      out.push([full.slice(SRC.length), readFileSync(full, 'utf8')])
    }
  }

  try {
    walk(root)
  } catch {
    // A layer with no files yet is fine — the guard grows with the codebase.
  }
  return out
}

/**
 * These guards are the executable form of the project's central architectural
 * rule: components -> state -> audio -> core, with core pure enough to unit test
 * in a node environment with no jsdom and no mocking.
 *
 * ESLint enforces the import direction. This catches the rest: raw DOM and Web
 * Audio access that no import statement would reveal.
 */
describe('layer purity', () => {
  it('core imports no framework and touches no browser API', () => {
    const offenders: string[] = []

    for (const [path, src] of sourcesIn('core')) {
      // Build the needles at runtime so this file does not trip its own rule.
      const forbidden: Array<[string, RegExp]> = [
        ['solid-js import', new RegExp(`from ['"]solid-js`)],
        ['DOM access', new RegExp(String.raw`\b(document|window|navigator)\.`)],
        ['Web Audio', new RegExp(['Audio', 'Context'].join(''))],
        ['timers', new RegExp(String.raw`\b(setTimeout|setInterval|requestAnimationFrame)\s*\(`)],
      ]

      for (const [label, pattern] of forbidden) {
        if (pattern.test(src)) offenders.push(`${path}: ${label}`)
      }
    }

    expect(offenders).toEqual([])
  })

  it('audio knows nothing about the UI framework', () => {
    const offenders = sourcesIn('audio')
      .filter(([, src]) => new RegExp(`from ['"]solid-js`).test(src))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })

  it('components never reach into the audio engine directly', () => {
    const offenders = sourcesIn('components')
      .filter(([, src]) => new RegExp(`from ['"]@audio/`).test(src))
      .map(([path]) => path)

    expect(offenders).toEqual([])
  })
})
