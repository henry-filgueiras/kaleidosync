<template>
  <View :class="{ hidden: ui.showShaderScroll }">
    <!-- <Transition name="fade-up">
      <AccountPill v-if="showMenu || showSources" />
    </Transition> -->

    <Transition name="fade">
      <Menu v-if="showMenu && !forceHide" @open-sources="openSources" @open-designs="openDesigns" />
    </Transition>

    <Transition name="fade">
      <AudioSources v-if="showSources" @close="closeSources" @select-source="selectSource" @select-radio-paradise="selectRadioParadise" />
    </Transition>

    <Transition name="fade-down">
      <TrackDisplay v-if="showMenu && !forceHide && sources.source" />
    </Transition>

    <BeatHorizon />
    <PrismVeil />
    <AudioDebugMeter />
  </View>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { audioSystem } from "@wearesage/vue/classes/AudioSystemManager";
import { View, useViewport, useUI, useSketches, parseQueryString, TrackDisplay, useToast } from "@wearesage/vue";
import { RAW_AUDIO_NOISE_FLOOR_DB, rawLevelToDecibels, sampleRawAnalyserLevel } from "../audio-level";
import { Menu, AudioSources, AudioDebugMeter, BeatHorizon, PrismVeil } from "../components";
import { useRouter } from "@wearesage/vue";
import { AudioSource, RadioParadiseStation } from "@wearesage/shared";
import { useSources } from "../stores/sources";
import { useVisualizerSettings } from "../stores/visualizer-settings";

const router = useRouter();
const viewport = useViewport();
const sources = useSources();
const sketches = useSketches();
const ui = useUI();
const toast = useToast();
const settings = useVisualizerSettings();
const showSources = ref(!sources.source);
const showMenu = ref(!showSources.value);
const forceHide = ref(false);
const { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } = useMagicKeys();
const showMenuTimeout = ref<any>(null);
const forceHideTimeout = ref<any>(null);
const MOUSE_TIMEOUT = 2000;
const PRESET_CYCLE_CONFIG = {
  evaluationIntervalMs: 900,
  signalHistorySize: 18,
  rate: {
    min: 0.35,
    max: 1.4,
    default: 0.85,
  },
  minGapMs: {
    base: 12_000,
    min: 7_000,
    max: 40_000,
  },
  maxGapMs: {
    base: 26_000,
    min: 14_000,
    max: 90_000,
  },
  audioTriggerCooldownMs: {
    min: 3_500,
    fractionOfMinGap: 0.45,
  },
  normalizedSignal: {
    peakFloorMin: 0.16,
    peakFloorBase: 0.34,
    peakFloorRateScale: 0.05,
    averageMultiplier: 1.45,
    riseThreshold: 0.025,
  },
  rawLiveSignal: {
    peakFloorDbMin: -44,
    peakFloorDbMax: -34,
    peakFloorBase: -40,
    peakFloorRatePivot: 0.85,
    peakFloorRateScale: 7,
    surgeDbMin: 2.2,
    surgeDbMax: 5,
    surgeDbBase: 4.2,
    surgeDbRateScale: 1.4,
    riseDbMin: 1.1,
    riseDbMax: 3,
    riseDbBase: 2.2,
    riseDbRateScale: 0.5,
  },
} as const;
const signalHistory = ref<number[]>([]);
const lastPresetCycleAt = ref(Date.now());
const lastAudioTriggerAt = ref(0);
const LIVE_INPUT_CYCLE_SOURCES = new Set([AudioSource.MICROPHONE, AudioSource.BROWSER_AUDIO]);
let autoCycleInterval: number | null = null;
let cycleAnalyserBuffer: Uint8Array | null = null;

const cycleTiming = computed(() => {
  const rate = Math.max(
    PRESET_CYCLE_CONFIG.rate.min,
    Math.min(PRESET_CYCLE_CONFIG.rate.max, Number(settings.cycleRate) || PRESET_CYCLE_CONFIG.rate.default)
  );

  // Higher cycleRate shortens both the audio-trigger cooldown window and the timer fallback gap,
  // so presets can advance sooner without changing the overall clamp bounds.
  return {
    minGapMs: Math.max(
      PRESET_CYCLE_CONFIG.minGapMs.min,
      Math.min(PRESET_CYCLE_CONFIG.minGapMs.max, Math.round(PRESET_CYCLE_CONFIG.minGapMs.base / rate))
    ),
    maxGapMs: Math.max(
      PRESET_CYCLE_CONFIG.maxGapMs.min,
      Math.min(PRESET_CYCLE_CONFIG.maxGapMs.max, Math.round(PRESET_CYCLE_CONFIG.maxGapMs.base / rate))
    ),
    peakFloor: Math.max(
      PRESET_CYCLE_CONFIG.normalizedSignal.peakFloorMin,
      PRESET_CYCLE_CONFIG.normalizedSignal.peakFloorBase - rate * PRESET_CYCLE_CONFIG.normalizedSignal.peakFloorRateScale
    ),
    peakFloorDb: Math.max(
      PRESET_CYCLE_CONFIG.rawLiveSignal.peakFloorDbMin,
      Math.min(
        PRESET_CYCLE_CONFIG.rawLiveSignal.peakFloorDbMax,
        PRESET_CYCLE_CONFIG.rawLiveSignal.peakFloorBase +
          (PRESET_CYCLE_CONFIG.rawLiveSignal.peakFloorRatePivot - rate) * PRESET_CYCLE_CONFIG.rawLiveSignal.peakFloorRateScale
      )
    ),
    surgeDb: Math.max(
      PRESET_CYCLE_CONFIG.rawLiveSignal.surgeDbMin,
      Math.min(
        PRESET_CYCLE_CONFIG.rawLiveSignal.surgeDbMax,
        PRESET_CYCLE_CONFIG.rawLiveSignal.surgeDbBase - rate * PRESET_CYCLE_CONFIG.rawLiveSignal.surgeDbRateScale
      )
    ),
    riseDb: Math.max(
      PRESET_CYCLE_CONFIG.rawLiveSignal.riseDbMin,
      Math.min(
        PRESET_CYCLE_CONFIG.rawLiveSignal.riseDbMax,
        PRESET_CYCLE_CONFIG.rawLiveSignal.riseDbBase - rate * PRESET_CYCLE_CONFIG.rawLiveSignal.riseDbRateScale
      )
    ),
  };
});

onMounted(async () => {
  const queryParams = parseQueryString();

  if (queryParams.spotify === "connected") {
    void sources.selectSource(AudioSource.SPOTIFY);
    router.cleanQuery("spotify");
    closeSources();
    applyForceHide();
  }

  if (typeof queryParams.spotify_error === "string" && queryParams.spotify_error.length > 0) {
    toast.error(`Spotify auth failed: ${queryParams.spotify_error}`);
    router.cleanQuery("spotify_error");
  }

  autoCycleInterval = window.setInterval(evaluatePresetCycling, PRESET_CYCLE_CONFIG.evaluationIntervalMs);
});

onBeforeUnmount(() => {
  if (autoCycleInterval !== null) {
    window.clearInterval(autoCycleInterval);
  }
});

watch(
  () => viewport.mouse,
  () => {
    if (forceHide.value || showSources.value || ui.showShaderScroll) return;
    clearTimeout(showMenuTimeout.value);
    showMenu.value = true;
    showMenuTimeout.value = setTimeout(() => {
      showMenu.value = false;
    }, MOUSE_TIMEOUT);
  }
);

watch(
  showMenu,
  val => {
    if (val) {
      sketches.stopMagicInterval();
    } else {
      sketches.startMagicInterval();
    }
  },
  {
    immediate: true
  }
);

watch(
  () => sketches.sketch,
  () => applyForceHide()
);

watch(ArrowLeft, val => {
  if (val) sketches.selectPreviousSketch("keyboard");
});

watch(ArrowUp, val => {
  if (val) sketches.selectPreviousSketch("keyboard");
});

watch(ArrowRight, val => {
  if (val) sketches.selectNextSketch("keyboard");
});

watch(ArrowDown, val => {
  if (val) sketches.selectNextSketch("keyboard");
});

watch(
  () => sketches.activeSketchId,
  () => {
    lastPresetCycleAt.value = Date.now();
    signalHistory.value = [];
  },
  { immediate: true }
);

watch(
  () => sources.source,
  () => {
    signalHistory.value = [];
    lastAudioTriggerAt.value = 0;
    lastPresetCycleAt.value = Date.now();
    cycleAnalyserBuffer = null;
  }
);

function applyForceHide() {
  clearTimeout(showMenuTimeout.value);
  clearTimeout(forceHideTimeout.value);
  forceHide.value = true;
  showMenu.value = false;
  forceHideTimeout.value = setTimeout(() => {
    forceHide.value = false;
  }, MOUSE_TIMEOUT / 2);
}

function openSources() {
  showMenu.value = false;
  showSources.value = true;
}

function closeSources() {
  showSources.value = false;
  showMenu.value = true;
}

async function selectSource(source: AudioSource) {
  if (source === AudioSource.SPOTIFY) {
    const spotifyStatus = await checkSpotifyReadiness();

    if (!spotifyStatus.ok) {
      toast.error(spotifyStatus.message);
      return;
    }
  }

  const selected = await sources.selectSource(source);
  if (!selected) return;

  showSources.value = false;
  showMenu.value = false;
}

function openDesigns() {
  showMenu.value = false;
  ui.showShaderScroll = true;
}

async function selectRadioParadise(data: { station: RadioParadiseStation }) {
  sources.selectRadioParadiseStation(data.station);
  const selected = await sources.selectSource(AudioSource.RADIO_PARADISE);
  if (!selected) return;

  showSources.value = false;
  showMenu.value = false;
}

async function checkSpotifyReadiness() {
  const apiBase = (import.meta.env.VITE_API || "").replace(/\/$/, "");

  try {
    const response = await fetch(`${apiBase}/api/spotify/health`);

    if (!response.ok) {
      return {
        ok: false,
        message:
          "Spotify mode needs the local API server. Run `npm run api` and make sure `VITE_API_BASE_URL` points to `http://127.0.0.1:3001`."
      };
    }

    const data = await response.json();

    if (!data.configured) {
      const missing = Array.isArray(data.missing) && data.missing.length > 0 ? ` Missing: ${data.missing.join(", ")}.` : "";

      return {
        ok: false,
        message: `Spotify mode is not configured yet. Copy \`.env.local.example\` to \`.env.local\` and fill in your Spotify app credentials.${missing}`
      };
    }

    return { ok: true, message: "" };
  } catch {
    return {
      ok: false,
      message:
        "Spotify mode needs the local API server. Run `npm run api` and make sure `VITE_API_BASE_URL` points to `http://127.0.0.1:3001`."
    };
  }
}

function evaluatePresetCycling() {
  if (!settings.autoCyclePresets) return;
  if (!sketches.sketch || sketches.iterations.length < 2) return;
  if (!sources.source || sources.source === AudioSource.NONE) return;
  if (showSources.value || ui.showShaderScroll) return;
  if (showMenu.value && !forceHide.value) return;
  if (sketches.tweening) return;

  const now = Date.now();
  const sinceLastCycle = now - lastPresetCycleAt.value;
  const sinceLastAudioTrigger = now - lastAudioTriggerAt.value;
  const { minGapMs, maxGapMs, peakFloor, peakFloorDb, surgeDb, riseDb } = cycleTiming.value;

  const useRawLiveSignal = LIVE_INPUT_CYCLE_SOURCES.has(sources.source);
  const signal = useRawLiveSignal ? sampleLiveInputSignalDb() : Math.max(0, Number(sources.volume) || 0);
  const previousSignal = signalHistory.value.at(-1) ?? signal;

  signalHistory.value.push(signal);
  if (signalHistory.value.length > PRESET_CYCLE_CONFIG.signalHistorySize) {
    signalHistory.value.splice(0, signalHistory.value.length - PRESET_CYCLE_CONFIG.signalHistorySize);
  }

  const averageSignal =
    signalHistory.value.length > 0
      ? signalHistory.value.reduce((sum, value) => sum + value, 0) / signalHistory.value.length
      : signal;

  const audioPeakReady =
    settings.audioReactiveCycling &&
    sinceLastCycle >= minGapMs &&
    sinceLastAudioTrigger >=
      Math.max(
        PRESET_CYCLE_CONFIG.audioTriggerCooldownMs.min,
        Math.round(minGapMs * PRESET_CYCLE_CONFIG.audioTriggerCooldownMs.fractionOfMinGap)
      ) &&
    // Raw live-input dB readings are source-dependent and unnormalized, so they use additive
    // thresholds. The shared store volume is already normalized to 0..1, so it uses relative
    // thresholds against its recent baseline instead.
    // Peak thresholds reject floor noise, surge thresholds look for energy breaking above the
    // recent average, and rise thresholds catch sudden onsets instead of sustained loud passages.
    (useRawLiveSignal
      ? signal > peakFloorDb && signal > averageSignal + surgeDb && signal - previousSignal > riseDb
      : signal > peakFloor &&
          signal > averageSignal * PRESET_CYCLE_CONFIG.normalizedSignal.averageMultiplier &&
          signal - previousSignal > PRESET_CYCLE_CONFIG.normalizedSignal.riseThreshold);

  const timerReady = sinceLastCycle >= maxGapMs;

  if (!audioPeakReady && !timerReady) return;

  lastPresetCycleAt.value = now;
  if (audioPeakReady) {
    lastAudioTriggerAt.value = now;
  }

  sketches.selectNextSketch("internal");
  applyForceHide();
}

function sampleLiveInputSignalDb() {
  const result = sampleRawAnalyserLevel(audioSystem.getAnalyserNode(), cycleAnalyserBuffer);
  cycleAnalyserBuffer = result.buffer;
  return rawLevelToDecibels(result.level, RAW_AUDIO_NOISE_FLOOR_DB);
}
</script>

<route lang="json">
{
  "name": "Visualizer",
  "meta": {
    "description": "the main visualizer",
    "requiresAuth": true
  }
}
</route>

<style lang="scss" scoped>
.hidden {
  pointer-events: none;
}
</style>
