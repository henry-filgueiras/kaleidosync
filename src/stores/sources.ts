import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, ref, watch } from "vue";
import { useTransition } from "@vueuse/core";
import { interpolateNumber } from "d3-interpolate";
import {
  AudioSource,
  RadioParadiseStation,
  enumKeyToLabel,
  type RadioParadiseStation as RadioParadiseStationType,
} from "@wearesage/shared";
import { audioSystem } from "@wearesage/vue/classes/AudioSystemManager";
import { MediaSessionManager } from "@wearesage/vue/classes/MediaSessionManager";
import { useAudioAnalyser } from "@wearesage/vue/composables/audio/useAudioAnalyser";
import { useAudioMetadata } from "@wearesage/vue/composables/audio/useAudioMetadata";
import { useRadioStream } from "@wearesage/vue/composables/useRadioStream";
import { useRouter } from "@wearesage/vue/router/sage-router";
import { useRAF } from "@wearesage/vue/stores/raf";
import { useSpotify } from "@wearesage/vue/stores/spotify";
import { useToast } from "@wearesage/vue/stores/toast";
import { clamp, easeInOut } from "@wearesage/vue/util";

export const AudioSourceIcons: Record<AudioSource, string> = {
  [AudioSource.SPOTIFY]: "spotify",
  [AudioSource.AUDIUS]: "audius",
  [AudioSource.MICROPHONE]: "microphone",
  [AudioSource.RADIO_PARADISE]: "radio-paradise",
  [AudioSource.KEXP]: "kexp",
  [AudioSource.FILE]: "upload",
  [AudioSource.BROWSER_AUDIO]: "sound",
  [AudioSource.NONE]: "sound",
};

export const SelectableAudioSources: AudioSource[] = [
  AudioSource.SPOTIFY,
  AudioSource.AUDIUS,
  AudioSource.MICROPHONE,
  AudioSource.BROWSER_AUDIO,
  AudioSource.RADIO_PARADISE,
  AudioSource.KEXP,
  AudioSource.FILE,
];

const LIVE_INPUT_SOURCES = new Set([AudioSource.MICROPHONE, AudioSource.BROWSER_AUDIO]);

type BrowserAudioSystemInternals = {
  audioContext?: AudioContext;
  filterNode?: BiquadFilterNode;
  analyserNode?: AnalyserNode;
  microphone?: MediaStream;
  mediaStreamSource?: MediaStreamAudioSourceNode;
  currentSource?: MediaElementAudioSourceNode | MediaStreamAudioSourceNode;
  state?: { source: string | null; isInitialized: boolean };
  stopMicrophoneWithTimeout?: (timeoutMs?: number) => Promise<void>;
  disconnectCurrentSource?: () => void;
  getAudioContext?: () => AudioContext | null;
};

type BrowserAudioAnalyserPipeline = {
  audioContext: AudioContext;
  filterNode: BiquadFilterNode;
  analyserNode: AnalyserNode;
};

function getBrowserAudioSystemAdapter() {
  // Browser Audio currently relies on internal @wearesage/vue audio-system fields
  // because this repo does not expose a safer public API for analyser-backed
  // display-capture streams yet.
  const system = audioSystem as unknown as BrowserAudioSystemInternals;

  return {
    async stopActiveInput(timeoutMs = 3000) {
      await system.stopMicrophoneWithTimeout?.(timeoutMs);
    },
    disconnectCurrentSource() {
      system.disconnectCurrentSource?.();
    },
    clearMediaStreamSource() {
      system.mediaStreamSource = undefined;
    },
    resetStateAfterCleanup() {
      if (system.state && system.state.source !== "spotify") {
        system.state.source = null;
        system.state.isInitialized = false;
      }
    },
    getAnalyserPipeline(): BrowserAudioAnalyserPipeline | null {
      const audioContext = system.getAudioContext?.() || system.audioContext;
      if (!audioContext || !system.filterNode || !system.analyserNode) {
        return null;
      }

      return {
        audioContext,
        filterNode: system.filterNode,
        analyserNode: system.analyserNode,
      };
    },
    attachCaptureStream(stream: MediaStream, mediaStreamSource: MediaStreamAudioSourceNode) {
      system.microphone = stream;
      system.mediaStreamSource = mediaStreamSource;
      system.currentSource = mediaStreamSource;

      if (system.state) {
        system.state.source = "audio";
        system.state.isInitialized = true;
      }
    },
  };
}

function getBrowserAudioSupportMessage() {
  return "Browser Audio needs screen-audio capture support. Try Chrome or Edge and share a tab/window with audio enabled. For the macOS Spotify app, use BlackHole or Loopback with Microphone mode.";
}

function getBrowserAudioNoTrackMessage() {
  return "That capture did not include an audio track. Share a browser tab with audio enabled, or route the Spotify desktop app into a virtual device like BlackHole or Loopback.";
}

export function getAudioSourceLabel(source: AudioSource): string {
  const enumKey = Object.keys(AudioSource).find((key) => AudioSource[key as keyof typeof AudioSource] === source);
  return enumKey ? enumKeyToLabel(enumKey) : "Unknown";
}

export const useSources = defineStore("sources", () => {
  const router = useRouter();
  const toast = useToast();
  const spotify = useSpotify();
  const raf = useRAF();
  const mediaSessionManager = new MediaSessionManager();
  const { extractMetadata } = useAudioMetadata();
  const audioAnalyser = useAudioAnalyser();

  const audioPlaying = ref(false);
  const audioStoreVolume = ref(0);
  const audioStoreStream = ref(0);
  const source = ref<AudioSource | null>(null);
  const radioParadiseStation = ref<RadioParadiseStationType>(RadioParadiseStation.MAIN_MIX);
  const currentFileUrls = ref<string[]>([]);
  const browserAudioStream = ref<MediaStream | null>(null);
  const isTransitioning = ref(false);
  const isQueueLocked = ref(false);

  let removeBrowserAudioListeners: (() => void) | null = null;
  let browserAudioEndingByCleanup = false;

  async function connectToAudioStore() {
    try {
      const { useAudio } = await import("@wearesage/vue/stores/audio");
      const audio = useAudio();

      watch(
        () => audio.playing,
        (playing) => {
          audioPlaying.value = playing;
        },
        { immediate: true }
      );

      watch(
        () => audio.volume,
        (volume) => {
          audioStoreVolume.value = volume;
        },
        { immediate: true }
      );

      watch(
        () => audio.stream,
        (stream) => {
          audioStoreStream.value = stream;
        },
        { immediate: true }
      );

      console.log("Sources: Connected to audio store for volume/stream/playing data");
    } catch (error) {
      console.warn("Sources: Could not connect to audio store:", error);
    }
  }

  void connectToAudioStore();

  const radioStream = computed(() => {
    if (source.value === AudioSource.RADIO_PARADISE || source.value === AudioSource.KEXP) {
      return useRadioStream(source.value, radioParadiseStation.value, false);
    }
    return null;
  });

  const prettySource = computed(() => {
    if (source.value === null) return null;
    if (radioStream.value?.stationName.value) return radioStream.value.stationName.value;
    return getAudioSourceLabel(source.value);
  });

  const sourceIcon = computed(() => (source.value !== null ? AudioSourceIcons[source.value] : "sound"));
  const useSpotifyValues = computed(() => source.value === AudioSource.SPOTIFY && spotify.playing);
  const spotifyVolume = computed(() => spotify.volume);

  const rawSourceVolume = computed(() => {
    if (useSpotifyValues.value) return spotifyVolume.value;
    return audioStoreVolume.value;
  });

  const interpolatedVolume = ref(rawSourceVolume.value);
  const isVolumeInterpolating = ref(false);

  watch(
    () => rawSourceVolume.value,
    (newVolume) => {
      if (!isVolumeInterpolating.value) {
        interpolatedVolume.value = newVolume;
      }
    }
  );

  const isPlayingAThing = computed(() => {
    if (source.value === AudioSource.SPOTIFY) return spotify.playing;
    if (source.value !== null && LIVE_INPUT_SOURCES.has(source.value)) return true;
    return audioPlaying.value;
  });

  const minVolume = useTransition(
    computed(() => (isPlayingAThing.value ? 0 : 1)),
    {
      duration: 1000,
      transition: easeInOut,
    }
  );

  const lastSourceStream = ref(0);
  const streamOffset = ref(0);
  const hasCalculatedOffset = ref(false);
  const rawStream = computed(() => (useSpotifyValues.value ? spotify.stream : audioStoreStream.value));

  const isNewStreamStable = computed(() => {
    return rawStream.value > 0.001 && source.value !== null && !LIVE_INPUT_SOURCES.has(source.value);
  });

  watch(
    () => isNewStreamStable.value,
    (stable) => {
      if (stable && !hasCalculatedOffset.value) {
        const newOffset = lastSourceStream.value - rawStream.value;
        streamOffset.value = newOffset;
        hasCalculatedOffset.value = true;
        console.log(`Stream offset calculated once: ${newOffset.toFixed(3)}`);
      }
    }
  );

  watch(
    () => source.value,
    (newSource, oldSource) => {
      if (oldSource !== null && newSource !== oldSource) {
        console.log(`Stream continuity: switching from ${getAudioSourceLabel(oldSource)} to ${getAudioSourceLabel(newSource)}`);

        hasCalculatedOffset.value = false;

        const fromVolume = interpolatedVolume.value || rawSourceVolume.value;
        const toVolume = rawSourceVolume.value;

        if (Math.abs(fromVolume - toVolume) > 0.01) {
          isVolumeInterpolating.value = true;
          const volumeInterpolator = interpolateNumber(fromVolume, toVolume);

          raf.remove("volume-source-transition");
          raf.add(
            (now, progress) => {
              interpolatedVolume.value = volumeInterpolator(progress);
              if (progress >= 1) {
                isVolumeInterpolating.value = false;
              }
            },
            {
              id: "volume-source-transition",
              duration: 750,
            }
          );
        } else {
          interpolatedVolume.value = toVolume;
          isVolumeInterpolating.value = false;
        }
      }
    }
  );

  const volume = computed(() => clamp(interpolatedVolume.value, minVolume.value, 1));
  const stream = computed(() => {
    if (source.value !== null && LIVE_INPUT_SOURCES.has(source.value)) {
      return rawStream.value;
    }
    return rawStream.value + streamOffset.value;
  });

  watch(
    () => stream.value,
    (newStream) => {
      if (isNewStreamStable.value) {
        lastSourceStream.value = newStream;
      }
    }
  );

  const playing = computed(() => isPlayingAThing.value);

  async function ensureAudioSystemReady() {
    const { useAudio } = await import("@wearesage/vue/stores/audio");
    const audio = useAudio();

    if (audio.userGestureInitialized) return true;
    return await audio.initializeAudio();
  }

  function resetBrowserAudioListeners() {
    removeBrowserAudioListeners?.();
    removeBrowserAudioListeners = null;
  }

  async function cleanupBrowserAudioSource() {
    browserAudioEndingByCleanup = true;
    resetBrowserAudioListeners();

    try {
      const browserAudioSystem = getBrowserAudioSystemAdapter();

      await browserAudioSystem.stopActiveInput(3000);
      browserAudioSystem.disconnectCurrentSource();
      browserAudioSystem.clearMediaStreamSource();
      browserAudioSystem.resetStateAfterCleanup();
    } catch (error) {
      console.warn("Could not fully clean up browser audio capture:", error);
    } finally {
      browserAudioStream.value = null;
      browserAudioEndingByCleanup = false;
    }
  }

  async function handleBrowserAudioCaptureEnded() {
    if (browserAudioEndingByCleanup || source.value !== AudioSource.BROWSER_AUDIO) return;

    await cleanupBrowserAudioSource();
    mediaSessionManager.deactivate();
    source.value = null;
    void toast.message("Browser audio capture ended. Pick Browser Audio again to resume.");
  }

  function attachBrowserAudioListeners(stream: MediaStream) {
    const onEnded = () => {
      void handleBrowserAudioCaptureEnded();
    };

    const tracks = stream.getTracks();
    tracks.forEach((track) => {
      track.addEventListener("ended", onEnded);
    });

    removeBrowserAudioListeners = () => {
      tracks.forEach((track) => {
        track.removeEventListener("ended", onEnded);
      });
    };
  }

  async function initializeBrowserAudioCapture() {
    if (typeof navigator === "undefined" || !navigator.mediaDevices?.getDisplayMedia) {
      return {
        ok: false,
        message: getBrowserAudioSupportMessage(),
      };
    }

    const ready = await ensureAudioSystemReady();
    if (!ready) {
      return {
        ok: false,
        message: "Audio could not initialize yet. Click Browser Audio again after the page finishes waking up the audio system.",
      };
    }

    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: true,
        audio: true,
      });

      if (stream.getAudioTracks().length === 0) {
        stream.getTracks().forEach((track) => track.stop());
        return {
          ok: false,
          message: getBrowserAudioNoTrackMessage(),
        };
      }

      await cleanupBrowserAudioSource();

      const browserAudioSystem = getBrowserAudioSystemAdapter();
      const analyserPipeline = browserAudioSystem.getAnalyserPipeline();
      if (!analyserPipeline) {
        stream.getTracks().forEach((track) => track.stop());
        return {
          ok: false,
          message: "Browser Audio could not attach to the analyser. Refresh the page and try again.",
        };
      }

      const { audioContext, filterNode, analyserNode } = analyserPipeline;

      if (audioContext.state === "suspended") {
        await audioContext.resume();
      }

      browserAudioSystem.disconnectCurrentSource();

      const mediaStreamSource = audioContext.createMediaStreamSource(stream);
      mediaStreamSource.connect(filterNode);
      filterNode.connect(analyserNode);

      browserAudioSystem.attachCaptureStream(stream, mediaStreamSource);

      browserAudioStream.value = stream;
      attachBrowserAudioListeners(stream);

      return { ok: true, message: "" };
    } catch (error) {
      const captureError = error as DOMException | Error;

      if (captureError.name === "NotAllowedError") {
        return {
          ok: false,
          message: "Browser audio capture was cancelled. Pick Browser Audio again and approve screen audio sharing.",
        };
      }

      if (captureError.name === "NotFoundError" || captureError.name === "AbortError") {
        return {
          ok: false,
          message: "No capturable browser audio source was selected. Try again and choose a tab or screen with audio sharing enabled.",
        };
      }

      return {
        ok: false,
        message: `Browser Audio failed to start: ${captureError.message || "unknown error"}`,
      };
    }
  }

  async function handleRadioSourceSelection(radioSource: AudioSource) {
    const station = radioStream.value;
    if (!station?.streamUrl.value) {
      console.warn(`No stream URL available for ${getAudioSourceLabel(radioSource)}`);
      return false;
    }

    const ready = await ensureAudioSystemReady();
    if (!ready) {
      console.warn("Audio system could not initialize for radio playback");
      return false;
    }

    try {
      await audioAnalyser.audioSystem.initializeAudioElement();

      const { useAudio } = await import("@wearesage/vue/stores/audio");
      const audio = useAudio();

      await audio.setSource(station.streamUrl.value);

      if (radioSource === AudioSource.RADIO_PARADISE) {
        await joinRadioParadiseSpace(radioParadiseStation.value);
      }

      return true;
    } catch (error) {
      console.error(`Failed to initialize radio source ${getAudioSourceLabel(radioSource)}:`, error);
      return false;
    }
  }

  async function handleMicrophoneSourceSelection() {
    try {
      const ready = await ensureAudioSystemReady();
      if (!ready) {
        toast.error("Microphone mode could not initialize the audio system yet. Try again.");
        source.value = AudioSource.NONE;
        return false;
      }

      const success = await audioAnalyser.initializeMicrophone();

      if (!success) {
        toast.error("Microphone mode could not start. Check browser permissions and try again.");
        source.value = AudioSource.NONE;
      }

      return success;
    } catch (error) {
      console.error("Error initializing microphone:", error);
      toast.error("Microphone mode failed to start.");
      source.value = AudioSource.NONE;
      return false;
    }
  }

  async function handleBrowserAudioSourceSelection() {
    const result = await initializeBrowserAudioCapture();

    if (!result.ok) {
      toast.error(result.message);
      source.value = AudioSource.NONE;
      return false;
    }

    void toast.message("Browser Audio is live. Share a tab or screen with audio to drive the visualizer.");
    return true;
  }

  async function handleFileSourceSelection() {
    try {
      const ready = await ensureAudioSystemReady();
      if (!ready) {
        toast.error("File mode could not initialize the audio system yet. Try again.");
        source.value = AudioSource.NONE;
        return false;
      }

      await audioAnalyser.audioSystem.initializeAudioElement();
      return true;
    } catch (error) {
      console.error("Error initializing file source:", error);
      toast.error("File mode failed to initialize.");
      source.value = AudioSource.NONE;
      return false;
    }
  }

  async function selectSource(newSource: AudioSource) {
    if (isTransitioning.value) {
      console.warn(`Source transition already in progress, ignoring switch to ${getAudioSourceLabel(newSource)}`);
      return false;
    }

    if (!SelectableAudioSources.includes(newSource)) {
      console.warn(`Invalid audio source: ${newSource}`);
      return false;
    }

    isTransitioning.value = true;
    isQueueLocked.value = true;

    try {
      const oldSource = source.value;
      if (oldSource !== newSource) {
        await performSourceCleanup(oldSource);
      }

      mediaSessionManager.activateForSource(newSource);
      source.value = newSource;

      if (newSource === AudioSource.SPOTIFY) {
        if (spotify.accessToken) {
          spotify.initialize();
        } else {
          spotify.getSpotifyTokens();
          return false;
        }
      }

      if (source.value === AudioSource.AUDIUS) {
        router.push("/audius");
      }

      if (newSource === AudioSource.RADIO_PARADISE || newSource === AudioSource.KEXP) {
        return await handleRadioSourceSelection(newSource);
      }

      if (newSource === AudioSource.MICROPHONE) {
        return await handleMicrophoneSourceSelection();
      }

      if (newSource === AudioSource.BROWSER_AUDIO) {
        return await handleBrowserAudioSourceSelection();
      }

      if (newSource === AudioSource.FILE) {
        return await handleFileSourceSelection();
      }

      return true;
    } catch (error) {
      console.error(`Source transition failed to ${getAudioSourceLabel(newSource)}:`, error);
      source.value = AudioSource.NONE;
      mediaSessionManager.deactivate();
      return false;
    } finally {
      isTransitioning.value = false;
      isQueueLocked.value = false;
    }
  }

  async function selectRadioParadiseStation(station: RadioParadiseStationType) {
    radioParadiseStation.value = station;
    localStorage.setItem("radioParadiseStation", station.toString());

    if (source.value === AudioSource.RADIO_PARADISE) {
      await handleRadioSourceSelection(AudioSource.RADIO_PARADISE);
    }
  }

  async function cleanupFileSource() {
    try {
      currentFileUrls.value.forEach((url) => {
        URL.revokeObjectURL(url);
      });
      currentFileUrls.value = [];
    } catch (error) {
      console.warn("Error during file cleanup:", error);
    }
  }

  async function performSourceCleanup(oldSource: AudioSource | null) {
    if (!oldSource) return;

    mediaSessionManager.deactivate();

    try {
      const { useAudio } = await import("@wearesage/vue/stores/audio");
      const audio = useAudio();

      if (audio.playing) {
        await audio.pause();
      }

      const { useQueue } = await import("@wearesage/vue/stores/queue");
      const queue = useQueue();
      queue.reset();

      await new Promise((resolve) => setTimeout(resolve, 50));

      switch (oldSource) {
        case AudioSource.SPOTIFY: {
          const { useSpotify } = await import("@wearesage/vue/stores/spotify");
          useSpotify().reset();
          break;
        }
        case AudioSource.MICROPHONE:
          await cleanupBrowserAudioSource();
          break;
        case AudioSource.RADIO_PARADISE:
          await leaveRadioParadiseSpace();
          break;
        case AudioSource.FILE:
          await cleanupFileSource();
          break;
        case AudioSource.BROWSER_AUDIO:
          await cleanupBrowserAudioSource();
          break;
        default:
          break;
      }
    } catch (error) {
      console.warn("Error during source cleanup:", error);
    }
  }

  async function loadFiles(files: FileList) {
    if (!files?.length) {
      console.warn("No files provided to load");
      return;
    }

    if (source.value !== AudioSource.FILE) {
      console.warn("Cannot load files - not in file source mode");
      return;
    }

    if (isQueueLocked.value) {
      return;
    }

    try {
      await cleanupFileSource();

      const { useQueue } = await import("@wearesage/vue/stores/queue");
      const { useAudio } = await import("@wearesage/vue/stores/audio");
      const queue = useQueue();
      const audio = useAudio();
      const tracks = [];

      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        if (!file.type.startsWith("audio/")) continue;

        const objectUrl = URL.createObjectURL(file);
        const metadata = await extractMetadata(file);

        currentFileUrls.value.push(objectUrl, ...(metadata.artworkBlobUrls || []));

        tracks.push({
          id: `file:${file.name}:${file.lastModified}`,
          source: AudioSource.FILE,
          sourceId: objectUrl,
          title: metadata.title || file.name.replace(/\.[^/.]+$/, ""),
          artist: metadata.artist || "Unknown Artist",
          album: metadata.album,
          duration: metadata.duration,
          artwork: metadata.artwork ? { large: metadata.artwork } : undefined,
          artworkBlobUrls: metadata.artworkBlobUrls,
          rawData: { file, objectUrl, url: objectUrl },
        });
      }

      if (!tracks.length) {
        toast.error("No supported audio files were selected.");
        return;
      }

      queue.setQueue(tracks, 0);
      await audio.setSource(tracks[0].sourceId);
      if (!queue.queue.isPlaying) {
        queue.togglePlayPause();
      }
    } catch (error) {
      console.error("Error loading files:", error);
      await cleanupFileSource();
    }
  }

  function setSourceFromServer(serverSource: AudioSource) {
    if (SelectableAudioSources.includes(serverSource)) {
      void selectSource(serverSource);
    }
  }

  function initializeSource() {
    const savedStation = localStorage.getItem("radioParadiseStation");
    if (savedStation) {
      const stationValue = parseInt(savedStation, 10) as RadioParadiseStationType;
      if (Object.values(RadioParadiseStation).includes(stationValue)) {
        radioParadiseStation.value = stationValue;
      }
    }

    source.value = null;
  }

  async function reset() {
    await performSourceCleanup(source.value);
    raf.remove("volume-source-transition");
    isVolumeInterpolating.value = false;
    source.value = null;
    localStorage.removeItem("selectedAudioSource");

    try {
      const { useQueue } = await import("@wearesage/vue/stores/queue");
      useQueue().reset();
    } catch (error) {
      console.warn("Could not reset queue during sources cleanup:", error);
    }
  }

  async function toggle() {
    const { useAudio } = await import("@wearesage/vue/stores/audio");
    return useAudio().toggle();
  }

  if (spotify.accessToken) {
    void selectSource(AudioSource.SPOTIFY);
  } else {
    initializeSource();
  }

  return {
    source,
    radioParadiseStation,
    radioStream,
    prettySource,
    sourceIcon,
    selectSource,
    selectRadioParadiseStation,
    setSourceFromServer,
    loadFiles,
    volume,
    stream,
    playing,
    reset,
    toggle,
    mediaSessionManager,
    isTransitioning,
    isQueueLocked,
  };
});

async function joinRadioParadiseSpace(_station: RadioParadiseStationType) {
  // Upstream removed the old socket-space integration; keep this as a no-op.
}

async function leaveRadioParadiseSpace() {
  // Upstream removed the old socket-space integration; keep this as a no-op.
}

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSources, import.meta.hot));
}
