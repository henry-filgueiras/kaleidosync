<template>
  <Transition name="fade">
    <aside v-if="visible" class="meter">
      <div class="header">
        <span class="title">Input Meter</span>
        <span class="source">{{ sourceLabel }}</span>
      </div>

      <div class="bar">
        <div class="fill" :style="{ width: `${levelPercent}%` }"></div>
        <div class="peak" :style="{ left: `${peakPercent}%` }"></div>
      </div>

      <div class="numbers">
        <span>Live {{ levelPercent }}%</span>
        <span>Peak {{ peakPercent }}%</span>
      </div>

      <p class="hint">Pause Spotify. If this still jumps, ambient audio is getting through.</p>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AudioSource } from "@wearesage/shared";
import { useSources } from "../stores/sources";

const sources = useSources();
const peak = ref(0);

const visible = computed(() => {
  return sources.source === AudioSource.MICROPHONE || sources.source === AudioSource.BROWSER_AUDIO;
});

const levelPercent = computed(() => {
  return Math.max(0, Math.min(100, Math.round(Number(sources.volume) * 100)));
});

const peakPercent = computed(() => {
  return Math.max(levelPercent.value, Math.min(100, Math.round(peak.value)));
});

const sourceLabel = computed(() => {
  if (sources.source === AudioSource.BROWSER_AUDIO) return "Browser Audio";
  if (sources.source === AudioSource.MICROPHONE) return "Microphone";
  return "Input";
});

watch(
  () => levelPercent.value,
  (value) => {
    if (value > peak.value) {
      peak.value = value;
    }
  },
  { immediate: true }
);

watch(
  () => visible.value,
  (isVisible) => {
    if (!isVisible) peak.value = 0;
  }
);

const peakDecay = window.setInterval(() => {
  if (!visible.value) return;
  if (peak.value <= levelPercent.value) return;

  peak.value = Math.max(levelPercent.value, peak.value - 2);
}, 120);

onBeforeUnmount(() => {
  window.clearInterval(peakDecay);
});
</script>

<style lang="scss" scoped>
.meter {
  @include position(fixed, null 1rem 1rem null, 450);
  @include box(0.75);
  width: min(18rem, calc(100vw - 2rem));
  border-radius: 0.75rem;
  background: rgba(8, 9, 14, 0.72);
  backdrop-filter: blur(12px);
  border: 1px solid rgba(255, 255, 255, 0.14);
  pointer-events: none;

  @include mobile {
    @include position(fixed, null 0.75rem 0.75rem 0.75rem, 450);
    width: auto;
  }
}

.header,
.numbers {
  @include flex-row(space-between, center);
  gap: 1rem;
}

.title,
.source,
.numbers,
.hint {
  font-family: "Space Mono", monospace;
}

.title,
.source {
  font-size: 0.72rem;
  text-transform: uppercase;
  letter-spacing: 0.08em;
}

.source {
  color: $pink;
  text-align: right;
}

.bar {
  position: relative;
  width: 100%;
  height: 0.7rem;
  margin: 0.6rem 0 0.45rem;
  border-radius: 999px;
  overflow: hidden;
  background: rgba(255, 255, 255, 0.08);
}

.fill {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, rgba(110, 231, 183, 0.85), rgba(255, 94, 125, 0.95));
  transition: width 90ms linear;
}

.peak {
  @include position(absolute, 0 null 0 0);
  width: 2px;
  background: rgba(255, 255, 255, 0.95);
  transform: translateX(-1px);
}

.numbers {
  font-size: 0.68rem;
  opacity: 0.85;
}

.hint {
  margin-top: 0.45rem;
  font-size: 0.66rem;
  line-height: 1.45;
  opacity: 0.7;
}
</style>
