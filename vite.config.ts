import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vite'
import solid from 'vite-plugin-solid'
import { VitePWA } from 'vite-plugin-pwa'

// Inject the package.json version so the UI can show which build is deployed.
const { version } = JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version: string }

export default defineConfig({
  define: { __APP_VERSION__: JSON.stringify(version) },
  plugins: [
    solid(),
    VitePWA({
      registerType: 'prompt',
      manifest: {
        name: 'Viola Lab',
        short_name: 'Viola Lab',
        description: 'Rhythm, keys and scales for viola.',
        theme_color: '#1b1b1f',
        background_color: '#1b1b1f',
        display: 'standalone',
        orientation: 'portrait',
        start_url: '/',
        icons: [],
      },
      workbox: {
        // Samples are content-addressed by directory version (samples/viola-v1/...),
        // so they can be cached hard once they land.
        // woff2 covers the self-hosted Bravura/Academico; m4a the viola samples.
        globPatterns: ['**/*.{js,css,html,woff2,m4a}'],
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
      },
    }),
  ],
  resolve: {
    alias: {
      '@core': fileURLToPath(new URL('./src/core', import.meta.url)),
      '@audio': fileURLToPath(new URL('./src/audio', import.meta.url)),
      '@state': fileURLToPath(new URL('./src/state', import.meta.url)),
      '@components': fileURLToPath(new URL('./src/components', import.meta.url)),
    },
  },
  server: { port: 5173 },
  build: { target: 'es2022' },
})
