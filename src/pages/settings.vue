<template>
  <View>
    <nav>
      <MenuHeader title="settings" @close="router.push('/visualizer')" />
      <Column align="end" cascade>
        <Toggle label="Disable Flashing" v-model="settings.disableFlashing" />
        <Toggle label="Neon Mode" v-model="settings.neonMode" />
        <Toggle label="Beat Horizon" v-model="settings.beatHorizon" />
        <Toggle label="Prism Veil" v-model="settings.prismVeil" />
        <Toggle label="Show Menu Labels" v-model="settings.showMenuLabels" />
        <Toggle label="Always Show Track" v-model="settings.alwaysShowTrack" />
        <Toggle label="Auto Cycle Presets" v-model="settings.autoCyclePresets" />
        <Toggle label="Audio-Reactive Cycling" v-model="settings.audioReactiveCycling" />
        <Toggle label="Infinity Play" v-model="settings.infinityPlay" />
        <Toggle label="Prefer Lossless Audio" v-model="settings.preferLossless" />
        <RangeInput label="Beat Strength" v-model="settings.beatHorizonStrength" :min="0.35" :max="1.35" :step="0.01" />
        <RangeInput label="Veil Strength" v-model="settings.prismVeilStrength" :min="0.35" :max="1.35" :step="0.01" />
        <RangeInput label="Cycle Rate" v-model="settings.cycleRate" :min="0.35" :max="1.4" :step="0.01" />
        <p class="hint">Beat Horizon adds visible pre-hit tension and impact flashes. On Spotify it uses real beat timing; elsewhere it falls back to live peak detection.</p>
      </Column>
    </nav>
  </View>
</template>

<script setup lang="ts">
import { View, Column, Toggle, RangeInput, useRouter } from "@wearesage/vue";
import { MenuHeader } from "../components";
import { useVisualizerSettings } from "../stores/visualizer-settings";

const router = useRouter();
const settings = useVisualizerSettings();
</script>

<style lang="scss" scoped>
nav {
  @include fixed-menu;
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
