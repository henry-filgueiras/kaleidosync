<template>
  <View>
    <nav>
      <MenuHeader title="settings" @close="router.push('/visualizer')" />
      <Column align="end" cascade>
        <Toggle label="Disable Flashing" v-model="settings.disableFlashing" />
        <Toggle label="Neon Mode" v-model="settings.neonMode" />
        <Toggle label="Show Menu Labels" v-model="settings.showMenuLabels" />
        <Toggle label="Always Show Track" v-model="settings.alwaysShowTrack" />
        <Toggle label="Auto Cycle Presets" v-model="settings.autoCyclePresets" />
        <Toggle label="Audio-Reactive Cycling" v-model="settings.audioReactiveCycling" />
        <Toggle label="Infinity Play" v-model="settings.infinityPlay" />
        <Toggle label="Prefer Lossless Audio" v-model="settings.preferLossless" />
        <RangeInput label="Cycle Rate" v-model="settings.cycleRate" :min="0.35" :max="1.4" :step="0.01" />
        <p class="hint">Auto cycling advances on a timer and can also respond to stronger audio peaks after a cooldown.</p>
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
