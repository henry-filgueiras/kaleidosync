# Surface Oracle Port Plan

## What I inspected

### KaleidoSync

- `src/App.vue` and `src/components/Renderer.vue` to confirm the app always mounts the shared renderer and already gates visibility by `visualizationMode`.
- `src/pages/visualizer.vue` to find where full-screen visualization modes and mode-specific HUDs are composed.
- `src/pages/settings.vue` and `src/stores/visualizer-settings.ts` to confirm persisted visualization modes and persisted per-mode settings already exist.
- `src/stores/pulse.ts`, `src/stores/audio-features.ts`, and `src/stores/sources.ts` to identify the shared music/pulse/audio signals available to a new mode.
- `src/components/PizzaPresetHud.vue` as the closest existing example of a compact floating mode HUD.
- `src/components/FractalTraverse.vue` to confirm KaleidoSync already hosts a large, stateful, canvas/WebGL-driven mode outside the default shader renderer.

### Surface Oracle

- `src/sim/heightField.ts` for the actual interaction model: fixed-step height-field integration, impulse injection, persistent emitters, and reflective boundaries.
- `src/sim/types.ts` and `src/sim/presets.ts` for the control vocabulary and preset shape.
- `src/components/SurfaceCanvas.tsx` for the pointer/touch interaction rules, diagnostics cadence, and the canvas render loop.
- `src/components/ControlPanel.tsx` and `src/components/Diagnostics.tsx` for the floating instrument HUD and the distinction between controls versus readout.
- `src/App.tsx` and `README.md` to verify the intended product shape: a debuggable ripple medium rather than a decorative post effect.

## Surface Oracle concepts worth importing

- A real stateful height-field medium with persistent cell state instead of a purely cosmetic shader treatment.
- Fixed-step simulation updates so interaction and audio impulses remain legible and debuggable.
- Pointer/touch impulse injection with drag-spaced splashes rather than only hover cosmetics.
- Persistent emitters as first-class state that can be added and removed in the field.
- A small floating control surface with a few material controls and a lightweight diagnostics readout.
- The design stance that the surface is an instrument to play and tune, not just a background effect.

## What should not be imported directly

- The React component structure from `surface-oracle/src/App.tsx`, `SurfaceCanvas.tsx`, `ControlPanel.tsx`, and `Diagnostics.tsx`. KaleidoSync is Vue and already has a page/component/store composition pattern.
- Surface Oracle's standalone app shell and full-page HUD layout. In KaleidoSync this should live inside the existing `/visualizer` page and coexist with menu overlays.
- A separate preset system that ignores KaleidoSync's persisted settings store. KaleidoSync should keep persistence in Pinia/localStorage through `useVisualizerSettings`.
- Any assumption that the surface is the only renderer in the app. KaleidoSync still needs its classic renderer, its fractal mode, and existing overlays to keep working.
- Extra diagnostics chrome that competes with KaleidoSync's existing visual language. v1 should stay compact and purposeful.

## Exact integration seam inside KaleidoSync

- Add `"surface-oracle"` to `VISUALIZATION_MODES` in `src/stores/visualizer-settings.ts`.
- Extend `useVisualizerSettings` with persisted Surface Oracle controls so the new mode behaves like other persisted visualization modes.
- Add a dedicated Surface Oracle mode store for runtime-only state that should not live in the global settings store, such as emitters, pause state, click mode, reset tokens, and transient diagnostics.
- Render the new mode from `src/pages/visualizer.vue`, alongside the existing `FractalTraverse` and `PizzaPresetHud` branches.
- Keep `src/components/Renderer.vue` mounted, but hide its classic shader canvas when `visualizationMode === "surface-oracle"` the same way it already hides for non-classic full-screen modes.
- Follow the `PizzaPresetHud.vue` pattern for a compact, floating mode HUD rather than inventing a separate page.

## v1 implementation plan

1. Create the integration note first, then add the new mode identifier and persisted settings entries.
2. Add a small Surface Oracle store in KaleidoSync for runtime mode state and a few persisted tuning controls.
3. Implement a Vue `SurfaceOracle.vue` canvas component that adapts the Surface Oracle height-field logic into KaleidoSync's idioms.
4. Map KaleidoSync signals into the medium in a deliberately simple way:
   - pulse impact -> direct impulse injection / larger disturbances
   - bass energy -> ripple radius and drive gain
   - novelty / spectral flux -> occasional automatic splashes or emitter accents
   - pulse confidence -> stability and restraint of auto-injection
   - energy / centroid -> slight drift in feel, brightness, or viscosity response
5. Add a compact `SurfaceOracleHud.vue` with the minimum viable controls for v1:
   - preset/material
   - click mode (`impulse` / `emitter`)
   - a few tunable controls
   - small diagnostics readout
6. Wire the new mode into `src/pages/settings.vue` so it can be selected like the existing modes.
7. Verify that classic and fractal-traverse still render, that mode switching persists, and that the new mode responds to both pointer input and KaleidoSync audio signals.

## Risks, open questions, and deferred ideas

- `surface-oracle/src/sim/heightField.ts` currently resets its buffers on resize. For KaleidoSync v1 that is acceptable, but it means orientation or viewport changes will clear the medium.
- KaleidoSync's `usePulse` and `useAudioFeatures` stores expose enough signal for a first pass, but auto-emitter spawning from novelty should be conservative to avoid noisy behavior.
- Existing overlays like `PulseOverlay`, `BeatHorizon`, and `PrismVeil` may visually clash with the surface mode. v1 should prefer proving the medium first and only disable overlays if readability clearly suffers.
- Surface Oracle's richer standalone diagnostics panel should stay trimmed in KaleidoSync v1 to avoid turning the visualizer into a lab app.
- Future work could add semantic floaters, structure-aware emitters, or music-form landmarks, but those should come after the base medium proves stable and musically legible.
