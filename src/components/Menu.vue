<template>
  <nav>
    <AudioSourceButton @click="$emit('open-sources')" />

    <IconButton
      v-if="sources.source === AudioSource.AUDIUS"
      aria-label="Library"
      :label="settings.showMenuLabels ? 'Library' : undefined"
      icon="vinyl"
      @click="router.push('/audius')" />

    <IconButton
      aria-label="Designs"
      icon="eye"
      :label="settings.showMenuLabels ? 'Designs' : undefined"
      @click="$emit('open-designs')" />

    <IconButton
      aria-label="Customize"
      icon="sliders"
      :label="settings.showMenuLabels ? 'Customize' : undefined"
      @click="router.push('/design')" />

    <IconButton
      aria-label="Settings"
      icon="settings"
      :label="settings.showMenuLabels ? 'Settings' : undefined"
      @click="router.push('/settings')" />

    <IconButton
      aria-label="Share"
      @click="share"
      icon="share"
      :label="settings.showMenuLabels ? 'Share' : undefined" />

    <IconButton
      v-if="viewport.fullscreenSupported"
      aria-label="Fullscreen"
      @click="viewport.toggleFullscreen"
      icon="fullscreen"
      :label="settings.showMenuLabels ? 'Fullscreen' : undefined" />
  </nav>
</template>

<script setup lang="ts">
import { IconButton, useViewport, useNativeShare, AudioSourceButton } from "@wearesage/vue";
import { AudioSource } from "@wearesage/shared";
import { useRouter } from "../sage-router-pages";
import { useSources } from "../stores/sources";
import { useVisualizerSettings } from "../stores/visualizer-settings";

defineEmits(["open-sources", "open-designs"]);

const viewport = useViewport();
const sources = useSources();
const share = useNativeShare();
const settings = useVisualizerSettings();
const router = useRouter();
</script>

<style lang="scss" scoped>
nav {
  @include fixed-menu;
}
</style>
