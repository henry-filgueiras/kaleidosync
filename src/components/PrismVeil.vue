<template>
  <Transition name="fade">
    <aside v-if="visible" class="veil" :style="veilStyles" aria-hidden="true">
      <div class="sheet sheet-a"></div>
      <div class="sheet sheet-b"></div>
      <div class="sheet sheet-c"></div>
      <div class="ring"></div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AudioSource } from "@wearesage/shared";
import { useSources } from "../stores/sources";
import { useVisualizerSettings } from "../stores/visualizer-settings";

const sources = useSources();
const settings = useVisualizerSettings();
const smoothedVolume = ref(0);
const peakVolume = ref(0);
const drift = ref(0);
const hue = ref(196);

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

const visible = computed(() => {
  return settings.prismVeil && sources.source !== null && sources.source !== AudioSource.NONE;
});

const strength = computed(() => {
  return clamp(Number(settings.prismVeilStrength) || 0.78, 0.35, 1.35);
});

const energy = computed(() => {
  const volume = Math.max(0, smoothedVolume.value + peakVolume.value * 0.45);
  return clamp(Math.pow(volume, 0.72) * 2.1 * strength.value, 0, 1.45);
});

const veilStyles = computed(() => {
  const motion = energy.value;
  const opacity = 0.08 + motion * 0.23;
  const glow = 28 + motion * 68;
  const scale = 0.94 + motion * 0.28;
  const rotation = drift.value * 0.9;
  const ringOpacity = 0.06 + motion * 0.22;
  const hueA = Math.round(hue.value % 360);
  const hueB = Math.round((hue.value + 48) % 360);
  const hueC = Math.round((hue.value + 126) % 360);

  return {
    "--veil-energy": motion.toFixed(3),
    "--veil-opacity": opacity.toFixed(3),
    "--veil-blur": `${glow.toFixed(1)}px`,
    "--veil-scale": scale.toFixed(3),
    "--veil-rotate": `${rotation.toFixed(1)}deg`,
    "--veil-ring-opacity": ringOpacity.toFixed(3),
    "--veil-hue-a": String(hueA),
    "--veil-hue-b": String(hueB),
    "--veil-hue-c": String(hueC),
  };
});

watch(
  () => visible.value,
  (isVisible) => {
    if (isVisible) return;
    smoothedVolume.value = 0;
    peakVolume.value = 0;
  }
);

const sampler = window.setInterval(() => {
  if (!visible.value) return;

  const volume = clamp(Number(sources.volume) || 0, 0, 1);
  const stream = Math.max(0, Number(sources.stream) || 0);
  const rising = volume > smoothedVolume.value;

  smoothedVolume.value = rising ? smoothedVolume.value * 0.42 + volume * 0.58 : smoothedVolume.value * 0.84 + volume * 0.16;
  peakVolume.value = Math.max(volume, peakVolume.value * 0.93);
  drift.value = (drift.value + 0.8 + stream * 4 + smoothedVolume.value * 9) % 360;
  hue.value = (210 + drift.value * 0.68 + stream * 220) % 360;
}, 60);

onBeforeUnmount(() => {
  window.clearInterval(sampler);
});
</script>

<style lang="scss" scoped>
.veil {
  @include position(fixed, 0 0 0 0, 2);
  overflow: hidden;
  pointer-events: none;
  opacity: var(--veil-opacity);
  mix-blend-mode: screen;
  filter: saturate(calc(1 + var(--veil-energy) * 1.15));
}

.sheet,
.ring {
  @include position(absolute, null null null null);
  inset: -16%;
  will-change: transform, opacity, filter;
}

.sheet {
  filter: blur(var(--veil-blur));
  opacity: calc(0.14 + var(--veil-energy) * 0.22);
  transform: translate3d(0, 0, 0) rotate(var(--veil-rotate)) scale(var(--veil-scale));
}

.sheet-a {
  background:
    radial-gradient(circle at 24% 32%, hsla(var(--veil-hue-a), 100%, 72%, 0.92), transparent 34%),
    radial-gradient(circle at 62% 54%, hsla(var(--veil-hue-b), 92%, 60%, 0.42), transparent 36%);
  animation: drift-a 22s linear infinite;
}

.sheet-b {
  background:
    radial-gradient(circle at 68% 28%, hsla(var(--veil-hue-b), 100%, 72%, 0.82), transparent 30%),
    radial-gradient(circle at 38% 72%, hsla(var(--veil-hue-c), 94%, 66%, 0.38), transparent 32%);
  animation: drift-b 28s linear infinite reverse;
}

.sheet-c {
  inset: -24%;
  background: conic-gradient(
    from var(--veil-rotate),
    hsla(var(--veil-hue-c), 100%, 68%, 0.06),
    transparent 14%,
    hsla(var(--veil-hue-a), 100%, 72%, 0.24),
    transparent 38%,
    hsla(var(--veil-hue-b), 100%, 68%, 0.18),
    transparent 64%,
    hsla(var(--veil-hue-c), 100%, 74%, 0.22),
    transparent 88%
  );
  filter: blur(calc(var(--veil-blur) * 1.35));
  opacity: calc(0.08 + var(--veil-energy) * 0.14);
  animation: spin 34s linear infinite;
}

.ring {
  inset: 8%;
  border-radius: 50%;
  border: 1px solid hsla(var(--veil-hue-a), 100%, 84%, var(--veil-ring-opacity));
  filter: blur(2px);
  opacity: calc(0.22 + var(--veil-energy) * 0.2);
  transform: scale(calc(0.92 + var(--veil-energy) * 0.18));
}

@keyframes drift-a {
  0% {
    transform: translate3d(-5%, -3%, 0) rotate(-10deg) scale(calc(var(--veil-scale) + 0.03));
  }

  50% {
    transform: translate3d(4%, 3%, 0) rotate(8deg) scale(calc(var(--veil-scale) + 0.08));
  }

  100% {
    transform: translate3d(-5%, -3%, 0) rotate(-10deg) scale(calc(var(--veil-scale) + 0.03));
  }
}

@keyframes drift-b {
  0% {
    transform: translate3d(6%, -4%, 0) rotate(14deg) scale(calc(var(--veil-scale) + 0.06));
  }

  50% {
    transform: translate3d(-4%, 5%, 0) rotate(-9deg) scale(calc(var(--veil-scale) + 0.11));
  }

  100% {
    transform: translate3d(6%, -4%, 0) rotate(14deg) scale(calc(var(--veil-scale) + 0.06));
  }
}

@keyframes spin {
  from {
    transform: rotate(0deg) scale(calc(var(--veil-scale) + 0.1));
  }

  to {
    transform: rotate(360deg) scale(calc(var(--veil-scale) + 0.1));
  }
}
</style>
