<template>
  <Transition name="fade">
    <aside v-if="visible" class="horizon" :style="horizonStyles" aria-hidden="true">
      <div class="lane lane-top">
        <div class="sweep"></div>
      </div>
      <div class="lane lane-bottom">
        <div class="sweep"></div>
      </div>
      <div class="wing wing-left"></div>
      <div class="wing wing-right"></div>
      <div class="pulse pulse-core"></div>
      <div class="pulse pulse-ring"></div>
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

const intensity = computed(() => {
  return clamp((pulse.impact * 1.2 + pulse.anticipation * 0.92 + pulse.confidence * 0.14) * strength.value, 0, 1.55);
});

const hue = computed(() => {
  const stream = Math.max(0, Number(sources.stream) || 0);
  return (176 + stream * 160 + pulse.anticipation * 64 + pulse.impact * 22) % 360;
});

const horizonStyles = computed(() => {
  const sweepWidth = 14 + intensity.value * 18;
  const wingWidth = 10 + pulse.anticipation * 28 * strength.value;
  const flashSize = 12 + pulse.impact * 26 * strength.value;
  const ringSize = 18 + (pulse.impact + pulse.anticipation * 0.4) * 34 * strength.value;
  const currentHue = Math.round(hue.value);
  const accentHue = Math.round((hue.value + 58) % 360);

  return {
    "--beat-hue": String(currentHue),
    "--beat-hue-accent": String(accentHue),
    "--beat-opacity": (0.16 + pulse.confidence * 0.3 + intensity.value * 0.12).toFixed(3),
    "--beat-lane-opacity": (0.08 + pulse.confidence * 0.22 + pulse.anticipation * 0.36).toFixed(3),
    "--beat-confidence": pulse.confidence.toFixed(3),
    "--beat-phase-pct": `${(pulse.phase * 100).toFixed(1)}%`,
    "--beat-sweep-width": `${sweepWidth.toFixed(1)}vw`,
    "--beat-wing-width": `${wingWidth.toFixed(1)}vw`,
    "--beat-flash-size": `${flashSize.toFixed(1)}vw`,
    "--beat-ring-size": `${ringSize.toFixed(1)}vw`,
    "--beat-core-opacity": (pulse.impact * 0.7 + pulse.anticipation * 0.18).toFixed(3),
    "--beat-ring-opacity": (pulse.impact * 0.32 + pulse.anticipation * 0.25).toFixed(3),
    "--beat-ring-scale": (0.82 + pulse.impact * 0.62 + pulse.anticipation * 0.14).toFixed(3),
  };
});
</script>

<style lang="scss" scoped>
.horizon {
  @include position(fixed, 0 0 0 0, 3);
  overflow: hidden;
  pointer-events: none;
  opacity: var(--beat-opacity);
  mix-blend-mode: screen;
}

.lane,
.wing,
.pulse {
  @include position(absolute, null null null null);
  will-change: transform, opacity;
}

.lane {
  left: 7vw;
  right: 7vw;
  height: 1px;
  background: linear-gradient(90deg, transparent, hsla(var(--beat-hue), 100%, 76%, var(--beat-lane-opacity)), transparent);
  box-shadow: 0 0 18px hsla(var(--beat-hue-accent), 100%, 72%, calc(var(--beat-lane-opacity) * 0.9));
}

.lane-top {
  top: 17vh;
}

.lane-bottom {
  bottom: 17vh;
}

.sweep {
  @include position(absolute, -0.45rem null null null);
  width: var(--beat-sweep-width);
  height: 0.9rem;
  left: calc(var(--beat-phase-pct) - (var(--beat-sweep-width) / 2));
  border-radius: 999px;
  background: linear-gradient(90deg, transparent, hsla(var(--beat-hue-accent), 100%, 78%, 0.95), transparent);
  filter: blur(10px);
  opacity: calc(0.04 + var(--beat-lane-opacity) + var(--beat-core-opacity) * 0.5);
}

.wing {
  top: 22vh;
  bottom: 22vh;
  width: var(--beat-wing-width);
  filter: blur(22px);
  opacity: calc(0.06 + var(--beat-confidence) * 0.1 + var(--beat-core-opacity) * 0.2);
}

.wing-left {
  left: -6vw;
  background: linear-gradient(90deg, hsla(var(--beat-hue), 100%, 72%, 0.76), transparent 74%);
}

.wing-right {
  right: -6vw;
  background: linear-gradient(270deg, hsla(var(--beat-hue-accent), 100%, 76%, 0.76), transparent 74%);
}

.pulse {
  top: 50%;
  left: 50%;
  border-radius: 50%;
  transform: translate3d(-50%, -50%, 0);
}

.pulse-core {
  width: var(--beat-flash-size);
  height: var(--beat-flash-size);
  background:
    radial-gradient(circle, hsla(var(--beat-hue-accent), 100%, 82%, calc(var(--beat-core-opacity) * 0.9)) 0%, transparent 62%),
    radial-gradient(circle, hsla(var(--beat-hue), 100%, 72%, calc(var(--beat-core-opacity) * 0.55)) 0%, transparent 74%);
  filter: blur(10px);
}

.pulse-ring {
  width: var(--beat-ring-size);
  height: var(--beat-ring-size);
  border: 1px solid hsla(var(--beat-hue), 100%, 85%, var(--beat-ring-opacity));
  filter: blur(1px);
  opacity: var(--beat-ring-opacity);
  transform: translate3d(-50%, -50%, 0) scale(var(--beat-ring-scale));
}
</style>
