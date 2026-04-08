<template>
  <Transition name="fade-up">
    <aside v-if="visible" class="hud" :style="hudStyle">
      <div class="accent-bar" :style="{ transform: `scaleX(${transitionIndicator})` }"></div>

      <header class="header">
        <div class="identity">
          <p class="eyebrow">Pizza Preset Lab</p>
          <h2>{{ activePreset.label }}</h2>
          <p class="subtitle">{{ activePreset.subtitle }}</p>
        </div>

        <div class="cycle-controls">
          <button type="button" class="nav-button" @click="presetLab.selectRelativePreset(-1)">Prev</button>
          <button type="button" class="nav-button" @click="presetLab.selectRelativePreset(1)">Next</button>
        </div>
      </header>

      <p class="flavor">{{ activePreset.artifactClass }} · {{ activePreset.surfaceMode }} · {{ activePreset.materialState }}</p>

      <div class="metrics">
        <div v-for="metric in metrics" :key="metric.label" class="metric">
          <span class="metric-label">{{ metric.label }}</span>
          <div class="metric-bar">
            <span class="metric-fill" :style="{ transform: `scaleX(${metric.value})` }"></span>
          </div>
          <span class="metric-value">{{ metric.valueLabel }}</span>
        </div>
      </div>

      <div class="chips">
        <span class="chip">Profile: {{ activePreset.label }}</span>
        <span class="chip">Depth {{ terrainLabel }}</span>
        <span v-if="isTransitioning" class="chip chip-active">Morphing {{ progressLabel }}</span>
      </div>

      <nav class="preset-grid" aria-label="Pizza presets">
        <button
          v-for="preset in presets"
          :key="preset.id"
          type="button"
          class="preset-button"
          :class="{ active: preset.id === activePresetId }"
          :aria-pressed="preset.id === activePresetId"
          @click="presetLab.selectPreset(preset.id)">
          <span class="preset-name">{{ preset.label }}</span>
          <span class="preset-tag">{{ preset.surfaceMode }}</span>
        </button>
      </nav>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { storeToRefs } from "pinia";
import { AudioSource } from "@wearesage/shared";
import { useSources } from "../stores/sources";
import { useVisualizerSettings } from "../stores/visualizer-settings";
import { usePizzaPresetLab } from "../stores/pizza-preset-lab";

const settings = useVisualizerSettings();
const sources = useSources();
const presetLab = usePizzaPresetLab();
const { presets, activePreset, activePresetId, currentLook, transitionIndicator, isTransitioning } = storeToRefs(presetLab);

function normalize(value: number, min: number, max: number) {
  return Math.min(1, Math.max(0, (value - min) / Math.max(max - min, 0.0001)));
}

const visible = computed(() => {
  if (settings.visualizationMode !== "fractal-traverse") return false;
  if (settings.fractalTraverseLayoutMode !== "pizza-kaleido") return false;
  return sources.source !== null && sources.source !== AudioSource.NONE;
});

const metrics = computed(() => {
  const look = currentLook.value;
  const terrainScore = look.carveDepth * 0.48 + look.shadingContrast * 0.28 + look.ridgeBrowning * 0.24;

  return [
    {
      label: "Fractal",
      value: normalize(look.fractalStrength, 0.35, 1.35),
      valueLabel: `${Math.round(look.fractalStrength * 100)}%`,
    },
    {
      label: "Groove",
      value: normalize(look.grooveStrength, 0.2, 1.25),
      valueLabel: `${Math.round(look.grooveStrength * 100)}%`,
    },
    {
      label: "Crust",
      value: normalize(look.crustProtection, 0.68, 0.9),
      valueLabel: `${Math.round(look.crustProtection * 100)}%`,
    },
    {
      label: "Glow",
      value: normalize(look.valleyGlow, 0, 0.85),
      valueLabel: `${Math.round(look.valleyGlow * 100)}%`,
    },
    {
      label: "Terrain",
      value: normalize(terrainScore, 0.72, 1.32),
      valueLabel: `${Math.round(terrainScore * 100)}%`,
    },
  ];
});

const terrainLabel = computed(() => {
  const look = currentLook.value;
  const terrainWeight = look.carveDepth * 0.56 + look.shadingContrast * 0.24 + look.ridgeBrowning * 0.2;

  if (terrainWeight >= 1.14) return "Severe";
  if (terrainWeight >= 0.96) return "Pronounced";
  return "Balanced";
});

const progressLabel = computed(() => {
  return `${Math.round(transitionIndicator.value * 100)}%`;
});

const hudStyle = computed(() => {
  return {
    "--hud-accent": activePreset.value.accent,
  };
});
</script>

<style lang="scss" scoped>
.hud {
  @include position(fixed, null null 1rem 1rem, 420);
  width: min(24rem, calc(100vw - 2rem));
  padding: 0.9rem 0.95rem 0.95rem;
  border-radius: 1rem;
  overflow: hidden;
  background:
    linear-gradient(160deg, rgba(10, 12, 18, 0.92), rgba(8, 9, 13, 0.7)),
    radial-gradient(circle at top left, color-mix(in srgb, var(--hud-accent) 18%, transparent), transparent 48%);
  border: 1px solid rgba(255, 255, 255, 0.12);
  box-shadow:
    0 18px 44px rgba(0, 0, 0, 0.28),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
  backdrop-filter: blur(18px) saturate(140%);
  color: rgba(246, 240, 230, 0.94);
  pointer-events: auto;

  @include mobile {
    @include position(fixed, null 0.75rem 0.75rem 0.75rem, 420);
    width: auto;
  }
}

.accent-bar {
  @include position(absolute, 0 0 null 0);
  height: 2px;
  background: linear-gradient(90deg, var(--hud-accent), rgba(255, 255, 255, 0.88));
  transform-origin: left center;
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
.flavor,
.metric-label,
.metric-value,
.preset-tag,
.chip,
.nav-button {
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
  font-size: 1.24rem;
  line-height: 1.05;
  font-family: "Major Mono Display";
  font-weight: 400;
  text-transform: uppercase;
}

.subtitle {
  margin: 0.28rem 0 0;
  font-size: 0.68rem;
  letter-spacing: 0.05em;
  color: rgba(255, 240, 224, 0.76);
}

.cycle-controls {
  display: flex;
  gap: 0.45rem;
}

.nav-button,
.preset-button {
  appearance: none;
  border: 1px solid rgba(255, 255, 255, 0.12);
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  cursor: pointer;
  transition:
    border-color 180ms ease,
    background 180ms ease,
    transform 180ms ease;
}

.nav-button {
  padding: 0.42rem 0.64rem;
  border-radius: 999px;
  font-size: 0.65rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.nav-button:hover,
.preset-button:hover {
  border-color: color-mix(in srgb, var(--hud-accent) 46%, rgba(255, 255, 255, 0.2));
  background: rgba(255, 255, 255, 0.08);
  transform: translateY(-1px);
}

.nav-button:focus-visible,
.preset-button:focus-visible {
  outline: 2px solid color-mix(in srgb, var(--hud-accent) 72%, white);
  outline-offset: 2px;
}

.flavor {
  margin: 0.68rem 0 0.78rem;
  font-size: 0.67rem;
  line-height: 1.45;
  color: rgba(255, 233, 214, 0.72);
}

.metrics {
  display: grid;
  gap: 0.38rem;
}

.metric {
  display: grid;
  grid-template-columns: 3.9rem minmax(0, 1fr) auto;
  align-items: center;
  gap: 0.55rem;
}

.metric-label,
.metric-value {
  font-size: 0.64rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
}

.metric-label {
  color: rgba(255, 247, 237, 0.7);
}

.metric-value {
  color: rgba(255, 241, 227, 0.82);
}

.metric-bar {
  position: relative;
  height: 0.34rem;
  overflow: hidden;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.08);
}

.metric-fill {
  @include position(absolute, 0 0 0 0);
  transform-origin: left center;
  background:
    linear-gradient(90deg, color-mix(in srgb, var(--hud-accent) 72%, rgba(255, 255, 255, 0.82)), rgba(255, 255, 255, 0.96));
  border-radius: inherit;
}

.chips {
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  margin: 0.8rem 0 0.82rem;
}

.chip {
  padding: 0.26rem 0.48rem;
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.06);
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 0.6rem;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: rgba(255, 244, 231, 0.82);
}

.chip-active {
  border-color: color-mix(in srgb, var(--hud-accent) 48%, rgba(255, 255, 255, 0.12));
  color: color-mix(in srgb, var(--hud-accent) 76%, white);
}

.preset-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0.42rem;

  @include mobile {
    grid-template-columns: 1fr;
  }
}

.preset-button {
  padding: 0.58rem 0.68rem;
  border-radius: 0.8rem;
  text-align: left;
}

.preset-button.active {
  border-color: color-mix(in srgb, var(--hud-accent) 54%, rgba(255, 255, 255, 0.16));
  background:
    linear-gradient(135deg, color-mix(in srgb, var(--hud-accent) 18%, rgba(255, 255, 255, 0.08)), rgba(255, 255, 255, 0.05));
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.04);
}

.preset-name {
  display: block;
  font-size: 0.8rem;
  line-height: 1.1;
}

.preset-tag {
  display: block;
  margin-top: 0.24rem;
  font-size: 0.58rem;
  letter-spacing: 0.07em;
  text-transform: uppercase;
  color: rgba(255, 236, 220, 0.68);
}
</style>
