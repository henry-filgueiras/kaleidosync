<template>
  <nav>
    <AudioSourceButton @click="$emit('open-sources')" />

    <IconButton
      v-if="sources.source === AudioSource.AUDIUS"
      to="/audius"
      :label="settings.showMenuLabels ? 'Library' : undefined"
      icon="vinyl" />

    <IconButton icon="eye" :label="settings.showMenuLabels ? 'Designs' : undefined" @click="$emit('open-designs')" />

    <IconButton to="/design" icon="sliders" :label="settings.showMenuLabels ? 'Customize' : undefined" />

    <IconButton to="/settings" icon="settings" :label="settings.showMenuLabels ? 'Settings' : undefined" />

    <IconButton @click="share" icon="share" :label="settings.showMenuLabels ? 'Share' : undefined" />

    <IconButton
      v-if="viewport.fullscreenSupported"
      @click="viewport.toggleFullscreen"
      icon="fullscreen"
      :label="settings.showMenuLabels ? 'Fullscreen' : undefined" />
  </nav>
</template>

<script setup lang="ts">
import { IconButton, useViewport, useNativeShare, AudioSourceButton } from "@wearesage/vue";
import { AudioSource } from "@wearesage/shared";
import { useSources } from "../stores/sources";
import { useVisualizerSettings } from "../stores/visualizer-settings";

defineEmits(["open-sources", "open-designs"]);

const viewport = useViewport();
const sources = useSources();
const share = useNativeShare();
const settings = useVisualizerSettings();
</script>

<style lang="scss" scoped>
nav {
  @include fixed-menu;
}
</style>
