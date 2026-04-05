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
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { AudioSource } from "@wearesage/shared";
import { useSpotify } from "@wearesage/vue/stores/spotify";
import { useSources } from "../stores/sources";
import { useVisualizerSettings } from "../stores/visualizer-settings";

const sources = useSources();
const spotify = useSpotify();
const settings = useVisualizerSettings();

const impact = ref(0);
const anticipation = ref(0);
const confidence = ref(0);
const phase = ref(0);
const hue = ref(184);
const estimatedIntervalMs = ref(0);
const lastImpactAt = ref(0);
const lastSampleVolume = ref(0);
const lastHeuristicBeatAt = ref(0);
const heuristicIntervals = ref<number[]>([]);
const volumeHistory = ref<number[]>([]);
const spotifyBeatIndex = ref(0);
const lastSpotifyTrackId = ref("");
const lastSpotifyBeatKey = ref("");

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
  return clamp((impact.value * 1.2 + anticipation.value * 0.92 + confidence.value * 0.14) * strength.value, 0, 1.55);
});

const horizonStyles = computed(() => {
  const sweepWidth = 14 + intensity.value * 18;
  const wingWidth = 10 + anticipation.value * 28 * strength.value;
  const flashSize = 12 + impact.value * 26 * strength.value;
  const ringSize = 18 + (impact.value + anticipation.value * 0.4) * 34 * strength.value;
  const currentHue = Math.round(hue.value % 360);
  const accentHue = Math.round((hue.value + 58) % 360);

  return {
    "--beat-hue": String(currentHue),
    "--beat-hue-accent": String(accentHue),
    "--beat-opacity": (0.16 + confidence.value * 0.3 + intensity.value * 0.12).toFixed(3),
    "--beat-lane-opacity": (0.08 + confidence.value * 0.22 + anticipation.value * 0.36).toFixed(3),
    "--beat-phase-pct": `${(phase.value * 100).toFixed(1)}%`,
    "--beat-sweep-width": `${sweepWidth.toFixed(1)}vw`,
    "--beat-wing-width": `${wingWidth.toFixed(1)}vw`,
    "--beat-flash-size": `${flashSize.toFixed(1)}vw`,
    "--beat-ring-size": `${ringSize.toFixed(1)}vw`,
    "--beat-core-opacity": (impact.value * 0.7 + anticipation.value * 0.18).toFixed(3),
    "--beat-ring-opacity": (impact.value * 0.32 + anticipation.value * 0.25).toFixed(3),
    "--beat-ring-scale": (0.82 + impact.value * 0.62 + anticipation.value * 0.14).toFixed(3),
  };
});

watch(
  () => [visible.value, sources.source],
  () => {
    resetBeatState();
  }
);

function resetBeatState() {
  impact.value = 0;
  anticipation.value = 0;
  confidence.value = 0;
  phase.value = 0;
  estimatedIntervalMs.value = 0;
  lastImpactAt.value = 0;
  lastSampleVolume.value = 0;
  lastHeuristicBeatAt.value = 0;
  heuristicIntervals.value = [];
  volumeHistory.value = [];
  spotifyBeatIndex.value = 0;
  lastSpotifyBeatKey.value = "";
}

function getBeatDurationMs(beats: any[], index: number) {
  const beat = beats[index];
  const nextBeat = beats[index + 1];
  const explicitDuration = Number(beat?.duration) * 1000;

  if (Number.isFinite(explicitDuration) && explicitDuration > 0) {
    return explicitDuration;
  }

  if (nextBeat) {
    return Math.max(180, (Number(nextBeat.start) - Number(beat.start)) * 1000);
  }

  return 500;
}

function registerImpact(now: number, intervalMs?: number) {
  lastImpactAt.value = now;
  impact.value = 1;

  if (intervalMs && Number.isFinite(intervalMs) && intervalMs >= 180 && intervalMs <= 1600) {
    estimatedIntervalMs.value = intervalMs;
  }
}

function updateImpact(now: number) {
  if (!lastImpactAt.value) {
    impact.value = 0;
    return;
  }

  impact.value = clamp(1 - (now - lastImpactAt.value) / 520, 0, 1);
}

function updateSpotifyBeat(now: number) {
  if (sources.source !== AudioSource.SPOTIFY || !spotify.playing) return false;

  const analysis = spotify.analysisData as any;
  const beats = analysis?.audioAnalysis?.beats;
  const timestamp = Number(analysis?.track?.timestamp);
  const trackId = String(analysis?.track?.item?.id || "");

  if (!Array.isArray(beats) || beats.length === 0 || !Number.isFinite(timestamp) || !trackId) {
    return false;
  }

  if (lastSpotifyTrackId.value !== trackId) {
    lastSpotifyTrackId.value = trackId;
    spotifyBeatIndex.value = 0;
    lastSpotifyBeatKey.value = "";
  }

  const positionMs = now - timestamp;
  if (positionMs < 0) return false;

  let index = spotifyBeatIndex.value;

  while (index > 0 && positionMs < Number(beats[index].start) * 1000) {
    index--;
  }

  while (index < beats.length - 1 && positionMs >= Number(beats[index].start) * 1000 + getBeatDurationMs(beats, index)) {
    index++;
  }

  spotifyBeatIndex.value = index;

  const beatStartMs = Number(beats[index].start) * 1000;
  const beatDurationMs = getBeatDurationMs(beats, index);
  const beatKey = `${trackId}:${index}`;

  if (beatKey !== lastSpotifyBeatKey.value) {
    lastSpotifyBeatKey.value = beatKey;
    registerImpact(now, beatDurationMs);
  }

  phase.value = clamp((positionMs - beatStartMs) / beatDurationMs, 0, 1);
  anticipation.value = Math.pow(clamp((phase.value - 0.56) / 0.44, 0, 1), 1.35);
  confidence.value = 1;

  return true;
}

function updateHeuristicBeat(now: number) {
  const volume = clamp(Number(sources.volume) || 0, 0, 1);
  const rise = volume - lastSampleVolume.value;
  lastSampleVolume.value = volume;

  volumeHistory.value.push(volume);
  if (volumeHistory.value.length > 24) {
    volumeHistory.value.splice(0, volumeHistory.value.length - 24);
  }

  const averageVolume =
    volumeHistory.value.length > 0
      ? volumeHistory.value.reduce((sum, value) => sum + value, 0) / volumeHistory.value.length
      : volume;

  const threshold = Math.max(0.13, averageVolume * 1.28);
  const refractoryMs = estimatedIntervalMs.value > 0 ? Math.max(250, estimatedIntervalMs.value * 0.42) : 280;
  const sinceLastBeat = lastHeuristicBeatAt.value ? now - lastHeuristicBeatAt.value : Infinity;
  const detectedBeat = volume > threshold && rise > Math.max(0.022, averageVolume * 0.32) && sinceLastBeat >= refractoryMs;

  if (detectedBeat) {
    if (lastHeuristicBeatAt.value) {
      const interval = now - lastHeuristicBeatAt.value;

      if (interval >= 180 && interval <= 1600) {
        heuristicIntervals.value.push(interval);
        if (heuristicIntervals.value.length > 6) {
          heuristicIntervals.value.splice(0, heuristicIntervals.value.length - 6);
        }

        const averageInterval =
          heuristicIntervals.value.reduce((sum, value) => sum + value, 0) / heuristicIntervals.value.length;

        registerImpact(now, averageInterval);
      } else {
        registerImpact(now);
      }
    } else {
      registerImpact(now);
    }

    lastHeuristicBeatAt.value = now;
  }

  if (heuristicIntervals.value.length > 0 && lastHeuristicBeatAt.value) {
    const averageInterval = heuristicIntervals.value.reduce((sum, value) => sum + value, 0) / heuristicIntervals.value.length;
    const deviation =
      heuristicIntervals.value.reduce((sum, value) => sum + Math.abs(value - averageInterval), 0) / heuristicIntervals.value.length;
    const stability = clamp(1 - deviation / Math.max(averageInterval * 0.22, 1), 0, 1);
    const coverage = clamp(heuristicIntervals.value.length / 4, 0, 1);
    const progress = clamp((now - lastHeuristicBeatAt.value) / averageInterval, 0, 1);

    phase.value = progress;
    anticipation.value = Math.pow(clamp((progress - 0.6) / 0.4, 0, 1), 1.3) * stability;
    confidence.value = stability * coverage;
  } else {
    phase.value = 0;
    anticipation.value = 0;
    confidence.value = 0;
  }
}

const sampler = window.setInterval(() => {
  if (!visible.value) return;

  const now = Date.now();
  const stream = Math.max(0, Number(sources.stream) || 0);

  updateImpact(now);

  if (!updateSpotifyBeat(now)) {
    updateHeuristicBeat(now);
  }

  hue.value = (176 + stream * 160 + anticipation.value * 64 + impact.value * 22) % 360;
}, 40);

onBeforeUnmount(() => {
  window.clearInterval(sampler);
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
