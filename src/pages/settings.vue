<template>
  <View>
    <nav>
      <MenuHeader title="settings" @close="router.push('/visualizer')" />
      <Column align="end" cascade>
        <Toggle label="Disable Flashing" v-model="settings.disableFlashing" />
        <Toggle label="Neon Mode" v-model="settings.neonMode" />
        <div class="mode-control">
          <span class="mode-label">Visualization Mode</span>
          <div class="mode-options" role="radiogroup" aria-label="Visualization Mode">
            <button
              v-for="mode in visualizationModes"
              :key="mode.value"
              type="button"
              class="mode-option"
              :class="{ active: settings.visualizationMode === mode.value }"
              role="radio"
              :aria-checked="settings.visualizationMode === mode.value"
              @click="settings.visualizationMode = mode.value">
              {{ mode.label }}
            </button>
          </div>
        </div>
        <Toggle label="Beat Horizon" v-model="settings.beatHorizon" />
        <Toggle label="Prism Veil" v-model="settings.prismVeil" />
        <Toggle label="Show Menu Labels" v-model="settings.showMenuLabels" />
        <Toggle label="Always Show Track" v-model="settings.alwaysShowTrack" />
        <Toggle label="Auto Cycle Presets" v-model="settings.autoCyclePresets" />
        <Toggle label="Audio-Reactive Cycling" v-model="settings.audioReactiveCycling" />
        <Toggle label="Infinity Play" v-model="settings.infinityPlay" />
        <Toggle label="Prefer Lossless Audio" v-model="settings.preferLossless" />
        <RangeInput label="Beat Strength" v-model="settings.beatHorizonStrength" :min="0.35" :max="1.35" :step="0.01" />
        <div v-if="isFractalMode" class="mode-control">
          <span class="mode-label">Fractal Layout</span>
          <div class="mode-options" role="radiogroup" aria-label="Fractal Layout">
            <button
              v-for="layout in fractalLayoutModes"
              :key="layout.value"
              type="button"
              class="mode-option"
              :class="{ active: settings.fractalTraverseLayoutMode === layout.value }"
              role="radio"
              :aria-checked="settings.fractalTraverseLayoutMode === layout.value"
              @click="settings.fractalTraverseLayoutMode = layout.value">
              {{ layout.label }}
            </button>
          </div>
        </div>
        <RangeInput
          v-if="isFractalMode"
          label="Fractal Strength"
          v-model="settings.fractalTraverseStrength"
          :min="0.35"
          :max="1.35"
          :step="0.01" />
        <RangeInput
          v-if="isPizzaLayout"
          label="Pizza Slices"
          v-model="settings.fractalTraverseSliceCount"
          :min="6"
          :max="12"
          :step="1" />
        <RangeInput label="Veil Strength" v-model="settings.prismVeilStrength" :min="0.35" :max="1.35" :step="0.01" />
        <RangeInput label="Cycle Rate" v-model="settings.cycleRate" :min="0.35" :max="1.4" :step="0.01" />
        <p class="hint">Beat Horizon adds visible pre-hit tension and impact flashes. On Spotify it uses real beat timing; elsewhere it falls back to live peak detection.</p>
      </Column>
    </nav>
  </View>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { View, Column, Toggle, RangeInput, useRouter } from "@wearesage/vue";
import { MenuHeader } from "../components";
import {
  type FractalTraverseLayoutMode,
  type VisualizationMode,
  useVisualizerSettings,
} from "../stores/visualizer-settings";

const router = useRouter();
const settings = useVisualizerSettings();
const isFractalMode = computed(() => settings.visualizationMode === "fractal-traverse");
const isPizzaLayout = computed(() => settings.fractalTraverseLayoutMode === "pizza-kaleido");
const visualizationModes: Array<{ label: string; value: VisualizationMode }> = [
  { label: "Classic", value: "classic" },
  { label: "Fractal Traverse", value: "fractal-traverse" },
];
const fractalLayoutModes: Array<{ label: string; value: FractalTraverseLayoutMode }> = [
  { label: "Full Frame", value: "full-frame" },
  { label: "Pizza Kaleido", value: "pizza-kaleido" },
];
</script>

<style lang="scss" scoped>
nav {
  @include fixed-menu;
}

.mode-control {
  width: min(20rem, 100%);
  display: flex;
  flex-direction: column;
  align-items: flex-end;
  gap: 0.45rem;
}

.mode-label {
  font-size: 0.72rem;
  letter-spacing: 0.08em;
  text-transform: uppercase;
  opacity: 0.72;
}

.mode-options {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 0.45rem;
}

.mode-option {
  padding: 0.45rem 0.85rem;
  border: 1px solid rgba(255, 255, 255, 0.14);
  border-radius: 999px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  font: inherit;
  line-height: 1;
  cursor: pointer;
  transition: background 180ms ease, border-color 180ms ease, transform 180ms ease;
}

.mode-option.active {
  border-color: rgba(255, 255, 255, 0.28);
  background: rgba(255, 255, 255, 0.14);
}

.mode-option:focus-visible {
  outline: 2px solid rgba(255, 255, 255, 0.42);
  outline-offset: 2px;
}

.hint {
  max-width: 20rem;
  margin-top: 0.25rem;
  font-size: 0.75rem;
  line-height: 1.5;
  text-align: right;
  opacity: 0.72;
}
</style>

<route lang="json">
{
  "name": "Settings",
  "meta": {
    "description": "configure the visualizer",
    "requiresAuth": true
  }
}
</route>
