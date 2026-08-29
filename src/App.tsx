import type { Component } from 'solid-js'

const App: Component = () => (
  <main class="shell">
    <h1>Viola Lab</h1>
    <p class="tagline">Rhythm, keys and scales — in alto clef.</p>
    <p class="scaffold">
      Scaffold deployed. The timing engine lands next.
    </p>
    <footer>v{__APP_VERSION__}</footer>
  </main>
)

export default App
