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
const signalHistory = ref<number[]>([]);
const lastPresetCycleAt = ref(Date.now());
const lastAudioTriggerAt = ref(0);
const LIVE_INPUT_CYCLE_SOURCES = new Set([AudioSource.MICROPHONE, AudioSource.BROWSER_AUDIO]);
let autoCycleInterval: number | null = null;
let cycleAnalyserBuffer: Uint8Array | null = null;

const cycleTiming = computed(() => {
  const rate = Math.max(0.35, Math.min(1.4, Number(settings.cycleRate) || 0.85));

  return {
    minGapMs: Math.max(7_000, Math.min(40_000, Math.round(12_000 / rate))),
    maxGapMs: Math.max(14_000, Math.min(90_000, Math.round(26_000 / rate))),
    peakFloor: Math.max(0.16, 0.34 - rate * 0.05),
    peakFloorDb: Math.max(-44, Math.min(-34, -40 + (0.85 - rate) * 7)),
    surgeDb: Math.max(2.2, Math.min(5, 4.2 - rate * 1.4)),
    riseDb: Math.max(1.1, Math.min(3, 2.2 - rate * 0.5)),
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

  autoCycleInterval = window.setInterval(evaluatePresetCycling, 900);
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
  if (signalHistory.value.length > 18) {
    signalHistory.value.splice(0, signalHistory.value.length - 18);
  }

  const averageSignal =
    signalHistory.value.length > 0
      ? signalHistory.value.reduce((sum, value) => sum + value, 0) / signalHistory.value.length
      : signal;

  const audioPeakReady =
    settings.audioReactiveCycling &&
    sinceLastCycle >= minGapMs &&
    sinceLastAudioTrigger >= Math.max(3_500, Math.round(minGapMs * 0.45)) &&
    (useRawLiveSignal
      ? signal > peakFloorDb && signal > averageSignal + surgeDb && signal - previousSignal > riseDb
      : signal > peakFloor && signal > averageSignal * 1.45 && signal - previousSignal > 0.025);

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
