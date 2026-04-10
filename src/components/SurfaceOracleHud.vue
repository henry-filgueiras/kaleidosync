<template>
  <section class="hud-shell">
    <button type="button" class="hud-toggle" @click="surfaceOracle.toggleHudVisibility()">
      {{ hudVisible ? "Hide Surface HUD" : "Show Surface HUD" }}
    </button>

    <Transition name="fade-up">
      <aside v-if="hudVisible" class="hud" :style="hudStyle">
        <div class="accent-bar"></div>

        <header class="header">
          <div class="identity">
            <p class="eyebrow">Surface Oracle</p>
            <h2>{{ activePresetName }}</h2>
            <p class="subtitle">{{ activePresetDescription }}</p>
          </div>

          <div class="actions">
            <button type="button" class="action-button" @click="surfaceOracle.togglePause()">
              {{ paused ? "Resume" : "Pause" }}
            </button>
            <button type="button" class="action-button danger" @click="surfaceOracle.requestReset()">Reset</button>
          </div>
        </header>

        <div class="top-controls">
          <label class="field">
            <span class="field-label">Preset</span>
            <select class="field-select" :value="activePresetId" @change="onPresetChange">
              <option v-for="preset in presets" :key="preset.id" :value="preset.id">
                {{ preset.name }}
              </option>
              <option v-if="activePresetId === 'custom'" value="custom">Custom</option>
            </select>
          </label>

          <div class="field">
            <span class="field-label">Touch</span>
            <div class="segmented" role="radiogroup" aria-label="Surface click mode">
              <button
                v-for="mode in clickModes"
                :key="mode.value"
                type="button"
                class="segment"
                :class="{ active: clickMode === mode.value }"
                :aria-pressed="clickMode === mode.value"
                @click="surfaceOracle.setClickMode(mode.value)">
                {{ mode.label }}
              </button>
            </div>
          </div>
        </div>

        <div class="diagnostics">
          <div class="diag">
            <span class="diag-label">Grid</span>
            <span class="diag-value">{{ gridLabel }}</span>
          </div>
          <div class="diag">
            <span class="diag-label">Pointer</span>
            <span class="diag-value">{{ pointerLabel }}</span>
          </div>
          <div class="diag">
            <span class="diag-label">Emitters</span>
            <span class="diag-value">{{ diagnostics.emitterCount }}</span>
          </div>
          <div class="diag">
            <span class="diag-label">Pulse</span>
            <span class="diag-value">{{ signalMetrics.pulse }}</span>
          </div>
          <div class="diag">
            <span class="diag-label">Bass</span>
            <span class="diag-value">{{ signalMetrics.bass }}</span>
          </div>
          <div class="diag">
            <span class="diag-label">Novelty</span>
            <span class="diag-value">{{ signalMetrics.novelty }}</span>
          </div>
        </div>

        <div class="control-list">
          <label v-for="control in controlMeta" :key="control.key" class="control-row">
            <span class="control-meta">
              <span class="control-name">{{ control.label }}</span>
              <span class="control-value">{{ control.formatter(controls[control.key]) }}</span>
            </span>
            <input
              class="control-slider"
              type="range"
              :min="control.min"
              :max="control.max"
              :step="control.step"
              :value="controls[control.key]"
              @input="onControlInput(control.key, $event)" />
          </label>
        </div>

        <p class="note">
          Impulse mode splashes the medium directly. Emitter mode plants persistent oscillators that the music can drive.
        </p>
      </aside>
    </Transition>
  </section>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { useAudioFeatures } from "../stores/audio-features";
import { usePulse } from "../stores/pulse";
import { SURFACE_ORACLE_CONTROL_META, SURFACE_ORACLE_PRESETS, useSurfaceOracleStore } from "../stores/surface-oracle";
import type { SurfaceOracleControlKey, SurfaceOraclePresetId } from "../surface-oracle/types";

const audioFeatures = useAudioFeatures();
const pulse = usePulse();
const surfaceOracle = useSurfaceOracleStore();
const { controls, clickMode, hudVisible, paused, diagnostics, activePresetId, activePresetName, activePresetDescription, accent } =
  storeToRefs(surfaceOracle);
const presets = SURFACE_ORACLE_PRESETS;
const controlMeta = SURFACE_ORACLE_CONTROL_META;
const clickModes = [
  { label: "Impulse", value: "impulse" as const },
  { label: "Emitter", value: "emitter" as const },
];

const pointerLabel = computed(() => {
  return diagnostics.value.pointer.inside
    ? `${Math.round(diagnostics.value.pointer.x)}, ${Math.round(diagnostics.value.pointer.y)}`
    : "standby";
});

const gridLabel = computed(() => {
  if (!diagnostics.value.gridWidth || !diagnostics.value.gridHeight) return "warming up";
  return `${diagnostics.value.gridWidth} x ${diagnostics.value.gridHeight} @ ${diagnostics.value.cellSize}px`;
});

const signalMetrics = computed(() => {
  return {
    pulse: `${Math.round(pulse.impact * pulse.confidence * 100)}%`,
    bass: `${Math.round(audioFeatures.features.bass * 100)}%`,
    novelty: `${Math.round(Math.max(audioFeatures.features.novelty, audioFeatures.features.spectralFlux) * 100)}%`,
  };
});

const hudStyle = computed(() => {
  return {
    "--hud-accent": accent.value,
  };
});

function onPresetChange(event: Event) {
  const presetId = (event.target as HTMLSelectElement).value as SurfaceOraclePresetId;
  if (presetId === "custom") return;
  surfaceOracle.applyPreset(presetId);
}

function onControlInput(key: SurfaceOracleControlKey, event: Event) {
  const nextValue = Number.parseFloat((event.target as HTMLInputElement).value);
  surfaceOracle.updateControl(key, nextValue);
}
</script>

<style lang="scss" scoped>
.hud-shell {
  @include position(fixed, null null 1rem 1rem, 430);
  width: min(25rem, calc(100vw - 2rem));
  pointer-events: none;

  @include mobile {
    @include position(fixed, null 0.75rem 0.75rem 0.75rem, 430);
    width: auto;
  }
}

.hud-toggle,
.action-button,
.segment {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.14);
  background: rgba(255, 255, 255, 0.05);
  color: inherit;
  cursor: pointer;
  transition:
    border-color 180ms ease,
    background 180ms ease,
    transform 180ms ease;
}

.hud-toggle:hover,
.action-button:hover,
.segment:hover {
  border-color: color-mix(in srgb, var(--hud-accent, #72d7ff) 48%, rgba(255, 255, 255, 0.2));
  background: rgba(255, 255, 255, 0.09);
  transform: translateY(-1px);
}

.hud-toggle {
  margin-right: auto;
  display: flex;
  pointer-events: auto;
  padding: 0.46rem 0.8rem;
  border-radius: 999px;
  font-family: "Space Mono", monospace;
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  backdrop-filter: blur(14px) saturate(135%);
}

.hud {
  position: relative;
  margin-top: 0.6rem;
  padding: 0.95rem 1rem 1rem;
  border-radius: 1rem;
  overflow: hidden;
  pointer-events: auto;
  color: rgba(244, 245, 248, 0.94);
  background:
    radial-gradient(circle at top left, color-mix(in srgb, var(--hud-accent) 16%, transparent), transparent 52%),
    linear-gradient(160deg, rgba(9, 14, 24, 0.94), rgba(6, 10, 17, 0.78));
  border: 1px solid rgba(255, 255, 255, 0.1);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(18px) saturate(140%);
}

.accent-bar {
  @include position(absolute, 0 0 null 0);
  height: 2px;
  background: linear-gradient(90deg, var(--hud-accent), rgba(255, 255, 255, 0.88));
}

.header {
  @include flex-row(space-between, start);
  gap: 1rem;
}

.identity {
  min-width: 0;
}

.eyebrow,
.subtitle,
.field-label,
.diag-label,
.diag-value,
.control-name,
.control-value,
.note,
.hud-toggle,
.action-button,
.segment,
.field-select {
  font-family: "Space Mono", monospace;
}

.eyebrow {
  margin: 0 0 0.2rem;
  font-size: 0.66rem;
  letter-spacing: 0.14em;
  text-transform: uppercase;
  opacity: 0.72;
}

h2 {
  margin: 0;
  font-size: 1.18rem;
  line-height: 1.02;
  font-family: "Major Mono Display";
  font-weight: 400;
  text-transform: uppercase;
}

.subtitle {
  margin: 0.3rem 0 0;
  font-size: 0.68rem;
  line-height: 1.45;
  color: rgba(232, 239, 246, 0.76);
}

.actions {
  display: flex;
  gap: 0.45rem;
}

.action-button {
  padding: 0.42rem 0.68rem;
  border-radius: 999px;
  font-size: 0.64rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.action-button.danger {
  border-color: rgba(255, 174, 152, 0.22);
}

.top-controls {
  margin-top: 0.85rem;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.75rem;

  @include mobile {
    grid-template-columns: 1fr;
  }
}

.field {
  display: flex;
  flex-direction: column;
  gap: 0.38rem;
}

.field-label {
  font-size: 0.64rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.72;
}

.field-select {
  width: 100%;
  border-radius: 0.75rem;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  padding: 0.58rem 0.7rem;
  font-size: 0.72rem;
}

.segmented {
  display: flex;
  gap: 0.45rem;
}

.segment {
  flex: 1;
  padding: 0.56rem 0.7rem;
  border-radius: 999px;
  font-size: 0.66rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.segment.active {
  border-color: color-mix(in srgb, var(--hud-accent) 54%, rgba(255, 255, 255, 0.22));
  background: color-mix(in srgb, var(--hud-accent) 12%, rgba(255, 255, 255, 0.06));
}

.diagnostics {
  margin-top: 0.85rem;
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 0.55rem;

  @include mobile {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

.diag {
  padding: 0.55rem 0.62rem;
  border-radius: 0.8rem;
  background: rgba(255, 255, 255, 0.04);
  border: 1px solid rgba(255, 255, 255, 0.08);
}

.diag-label {
  display: block;
  font-size: 0.58rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.62;
}

.diag-value {
  display: block;
  margin-top: 0.18rem;
  font-size: 0.74rem;
  line-height: 1.35;
}

.control-list {
  margin-top: 0.85rem;
  display: grid;
  gap: 0.56rem;
}

.control-row {
  display: flex;
  flex-direction: column;
  gap: 0.32rem;
}

.control-meta {
  display: flex;
  justify-content: space-between;
  gap: 1rem;
}

.control-name {
  font-size: 0.68rem;
}

.control-value {
  font-size: 0.66rem;
  opacity: 0.74;
}

.control-slider {
  width: 100%;
  accent-color: var(--hud-accent);
}

.note {
  margin: 0.8rem 0 0;
  font-size: 0.64rem;
  line-height: 1.5;
  color: rgba(228, 236, 244, 0.74);
}
</style>
