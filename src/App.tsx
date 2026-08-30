import { For, Show, createSignal, type Component } from 'solid-js'
import Metronome from './features/metronome/Metronome'
import Rhythm from './features/rhythm/Rhythm'
import Scales from './features/scales/Scales'

type TabId = 'scales' | 'rhythm' | 'metronome'

const TABS: ReadonlyArray<{ id: TabId; label: string }> = [
  { id: 'scales', label: 'Scales' },
  { id: 'rhythm', label: 'Rhythm' },
  { id: 'metronome', label: 'Metronome' },
]

const App: Component = () => {
  const [tab, setTab] = createSignal<TabId>('scales')

  return (
    <main class="shell">
      <header>
        <h1>Viola Lab</h1>
        <p class="tagline">Rhythm, keys and scales — in alto clef.</p>
      </header>

      <nav class="tabs" role="tablist">
        <For each={TABS}>
          {(t) => (
            <button
              type="button"
              role="tab"
              aria-selected={tab() === t.id}
              class="tab"
              classList={{ chosen: tab() === t.id }}
              onClick={() => setTab(t.id)}
            >
              {t.label}
            </button>
          )}
        </For>
      </nav>

      {/* Each panel owns its own audio system, so switching tabs stops the
          previous one cleanly rather than leaving it sounding underneath. */}
      <Show when={tab() === 'scales'}>
        <Scales />
      </Show>
      <Show when={tab() === 'rhythm'}>
        <Rhythm />
      </Show>
      <Show when={tab() === 'metronome'}>
        <Metronome />
      </Show>

      <footer>v{__APP_VERSION__}</footer>
    </main>
  )
}

export default App
