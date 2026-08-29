import js from '@eslint/js'
import globals from 'globals'
import solid from 'eslint-plugin-solid/configs/typescript'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

// Layer boundaries: components -> state -> audio -> core.
// Enforced with the built-in no-restricted-imports rather than a plugin, since
// the path aliases make the rule a one-liner per layer. The companion guard is
// src/core/architecture.test.ts, which also catches raw DOM/Web Audio usage.
const forbid = (layer, patterns) => ({
  files: [`src/${layer}/**/*.{ts,tsx}`],
  rules: {
    'no-restricted-imports': [
      'error',
      {
        patterns: patterns.map((group) => ({
          group: [group],
          message: `src/${layer} may not import ${group} — see the layering rule in README.md.`,
        })),
      },
    ],
  },
})

export default defineConfig([
  globalIgnores(['dist', 'dev-dist', 'node_modules']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [js.configs.recommended, tseslint.configs.recommended],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/**/*.tsx', 'src/components/**/*.ts'],
    extends: [solid],
  },
  {
    files: ['*.config.ts', 'server.ts', 'scripts/**/*.ts', 'tests/**/*.ts'],
    languageOptions: { globals: globals.node },
  },
  // core is the pure layer: no framework, no Web Audio, no sibling layers.
  forbid('core', ['solid-js', 'solid-js/*', '@audio/*', '@state/*', '@components/*']),
  // audio may use core, but knows nothing about the framework or the UI.
  forbid('audio', ['solid-js', 'solid-js/*', '@state/*', '@components/*']),
  // state adapts audio into signals; it does not reach into components.
  forbid('state', ['@components/*']),
  // components render signals; they never touch the audio engine directly.
  forbid('components', ['@audio/*']),
])
