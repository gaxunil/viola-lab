import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'

const alias = {
  '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
  '@audio': fileURLToPath(new URL('./src/audio', import.meta.url)),
  '@state': fileURLToPath(new URL('./src/state', import.meta.url)),
  '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
}

// Two projects, deliberately split:
//   unit   — pure logic (src/core) plus the scheduler driven by fake clocks.
//            Node environment, no jsdom, no mocking, milliseconds to run.
//   render — OfflineAudioContext assertions that need a real Web Audio
//            implementation. Slower; run as a pre-release gate.
export default defineConfig({
  test: {
    projects: [
      {
        resolve: { alias },
        test: {
          name: 'unit',
          environment: 'node',
          include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
          exclude: ['src/**/*.render.test.ts'],
        },
      },
      {
        resolve: { alias },
        test: {
          name: 'render',
          include: ['src/**/*.render.test.ts'],
        },
      },
    ],
  },
})
