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
  </View>
</template>

<script setup lang="ts">
import { ref, onMounted, watch } from "vue";
import { useMagicKeys } from "@vueuse/core";
import { View, useViewport, useUI, useSketches, parseQueryString, TrackDisplay, useToast } from "@wearesage/vue";
import { Menu, AudioSources } from "../components";
import { useRouter } from "@wearesage/vue";
import { AudioSource, RadioParadiseStation } from "@wearesage/shared";
import { useSources } from "../stores/sources";

const router = useRouter();
const viewport = useViewport();
const sources = useSources();
const sketches = useSketches();
const ui = useUI();
const toast = useToast();
const showSources = ref(!sources.source);
const showMenu = ref(!showSources.value);
const forceHide = ref(false);
const { ArrowUp, ArrowDown, ArrowLeft, ArrowRight } = useMagicKeys();
const showMenuTimeout = ref<any>(null);
const forceHideTimeout = ref<any>(null);
const MOUSE_TIMEOUT = 2000;

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
