<template>
  <Transition name="fade">
    <aside v-if="visible" class="overlay" :style="overlayStyles" aria-hidden="true">
      <div class="wash"></div>
      <div class="tension"></div>
      <div class="ring ring-primary"></div>
      <div class="ring ring-secondary"></div>
      <div class="core"></div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { AudioSource } from "@wearesage/shared";
import { useSources } from "../stores/sources";
import { usePulse } from "../stores/pulse";
import { useVisualizerSettings } from "../stores/visualizer-settings";

const sources = useSources();
const pulse = usePulse();
const settings = useVisualizerSettings();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const visible = computed(() => {
  return settings.beatHorizon && sources.source !== null && sources.source !== AudioSource.NONE;
});

const strength = computed(() => {
  return clamp(Number(settings.beatHorizonStrength) || 0.88, 0.35, 1.35);
});

const overlayStyles = computed(() => {
  const stream = Math.max(0, Number(sources.stream) || 0);
  const confidenceGate = clamp(pulse.confidence * 0.86 + pulse.impact * 0.22, 0, 1);
  const energy = clamp(
    (pulse.impact * 1.08 + pulse.anticipation * 0.72) * (0.18 + confidenceGate * 0.82) * strength.value,
    0,
    1.4
  );
  const hue = Math.round((196 + stream * 132 + pulse.phase * 28 + pulse.anticipation * 52) % 360);
  const accentHue = Math.round((hue + 42) % 360);
  const washScale = 0.8 + pulse.anticipation * 0.08 + pulse.impact * 0.18;
  const primaryRingScale = 0.82 + pulse.anticipation * 0.08 + pulse.impact * 0.62;
  const secondaryRingScale = 0.98 + pulse.phase * 0.08 + pulse.impact * 0.72;

  return {
    "--pulse-hue": String(hue),
    "--pulse-hue-accent": String(accentHue),
    "--pulse-overlay-opacity": (0.04 + confidenceGate * 0.12 + energy * 0.05).toFixed(3),
    "--pulse-wash-opacity": (0.03 + confidenceGate * 0.08 + pulse.impact * 0.18).toFixed(3),
    "--pulse-core-opacity": (pulse.impact * 0.44 + pulse.anticipation * 0.1).toFixed(3),
    "--pulse-ring-opacity": (0.04 + confidenceGate * 0.08 + pulse.impact * 0.22).toFixed(3),
    "--pulse-ring-secondary-opacity": (0.02 + confidenceGate * 0.05 + pulse.impact * 0.16).toFixed(3),
    "--pulse-tension-opacity": (pulse.anticipation * confidenceGate * 0.24).toFixed(3),
    "--pulse-wash-scale": washScale.toFixed(3),
    "--pulse-ring-scale": primaryRingScale.toFixed(3),
    "--pulse-ring-secondary-scale": secondaryRingScale.toFixed(3),
    "--pulse-blur": `${(34 + energy * 52).toFixed(1)}px`,
  };
});
</script>

<style lang="scss" scoped>
.overlay {
  @include position(fixed, 0 0 0 0, 3);
  overflow: hidden;
  pointer-events: none;
  opacity: var(--pulse-overlay-opacity);
  mix-blend-mode: screen;
}

.wash,
.tension,
.ring,
.core {
  @include position(absolute, 50% null null 50%);
  border-radius: 50%;
  transform: translate3d(-50%, -50%, 0);
  will-change: transform, opacity, filter;
}

.wash {
  width: 62vw;
  height: 62vw;
  background:
    radial-gradient(circle, hsla(var(--pulse-hue-accent), 100%, 80%, var(--pulse-wash-opacity)) 0%, transparent 38%),
    radial-gradient(circle, hsla(var(--pulse-hue), 100%, 72%, calc(var(--pulse-wash-opacity) * 0.7)) 0%, transparent 58%);
  filter: blur(var(--pulse-blur));
  opacity: var(--pulse-wash-opacity);
  transform: translate3d(-50%, -50%, 0) scale(var(--pulse-wash-scale));
}

.tension {
  width: 34vw;
  height: 34vw;
  border: 1px solid hsla(var(--pulse-hue-accent), 100%, 82%, var(--pulse-tension-opacity));
  box-shadow:
    0 0 28px hsla(var(--pulse-hue), 100%, 72%, calc(var(--pulse-tension-opacity) * 0.6)),
    inset 0 0 24px hsla(var(--pulse-hue-accent), 100%, 84%, calc(var(--pulse-tension-opacity) * 0.4));
  filter: blur(1px);
  opacity: var(--pulse-tension-opacity);
  transform: translate3d(-50%, -50%, 0) scale(calc(0.88 + var(--pulse-wash-scale) * 0.08));
}

.ring {
  border: 1px solid hsla(var(--pulse-hue), 100%, 84%, var(--pulse-ring-opacity));
  filter: blur(1px);
}

.ring-primary {
  width: 28vw;
  height: 28vw;
  opacity: var(--pulse-ring-opacity);
  transform: translate3d(-50%, -50%, 0) scale(var(--pulse-ring-scale));
}

.ring-secondary {
  width: 46vw;
  height: 46vw;
  border-color: hsla(var(--pulse-hue-accent), 100%, 86%, var(--pulse-ring-secondary-opacity));
  opacity: var(--pulse-ring-secondary-opacity);
  transform: translate3d(-50%, -50%, 0) scale(var(--pulse-ring-secondary-scale));
}

.core {
  width: 13vw;
  height: 13vw;
  background:
    radial-gradient(circle, hsla(var(--pulse-hue-accent), 100%, 84%, calc(var(--pulse-core-opacity) * 0.95)) 0%, transparent 50%),
    radial-gradient(circle, hsla(var(--pulse-hue), 100%, 74%, calc(var(--pulse-core-opacity) * 0.72)) 0%, transparent 68%);
  filter: blur(12px);
  opacity: var(--pulse-core-opacity);
}
</style>
