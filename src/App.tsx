import type { Component } from 'solid-js'
import Metronome from './features/metronome/Metronome'

const App: Component = () => (
  <main class="shell">
    <header>
      <h1>Viola Lab</h1>
      <p class="tagline">Rhythm, keys and scales — in alto clef.</p>
    </header>

    <Metronome />

    <footer>v{__APP_VERSION__}</footer>
  </main>
)

export default App
