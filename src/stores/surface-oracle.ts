import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import type {
  SurfaceOracleClickMode,
  SurfaceOracleControlKey,
  SurfaceOracleControls,
  SurfaceOracleDiagnosticsSnapshot,
  SurfaceOracleEmitterPlacementMode,
  SurfaceOracleEmitterVoiceId,
  SurfaceOraclePointerSample,
  SurfaceOraclePreset,
  SurfaceOraclePresetId,
} from "../surface-oracle/types";
import { useVisualizerSettings } from "./visualizer-settings";

export const SURFACE_ORACLE_PRESETS: SurfaceOraclePreset[] = [
  {
    id: "calm-glass",
    name: "Calm Glass",
    description: "Tight, polished ripples with fast decay and a restrained footprint.",
    accent: "#8be9ff",
    controls: {
      amplitude: 0.65,
      radius: 30,
      damping: 0.032,
      propagationSpeed: 0.13,
      viscosity: 0.18,
      sourceFrequency: 0.46,
      emitterStrength: 0.8,
    },
  },
  {
    id: "water",
    name: "Water",
    description: "Balanced travel and interference for a classic liquid readout.",
    accent: "#72d7ff",
    controls: {
      amplitude: 1,
      radius: 44,
      damping: 0.013,
      propagationSpeed: 0.26,
      viscosity: 0.055,
      sourceFrequency: 0.82,
      emitterStrength: 1.05,
    },
  },
  {
    id: "standing-wave",
    name: "Standing Wave",
    description: "Long-travel resonance for clear nodes and bright interference bands.",
    accent: "#b8f6ff",
    controls: {
      amplitude: 0.95,
      radius: 28,
      damping: 0.01,
      propagationSpeed: 0.275,
      viscosity: 0.045,
      sourceFrequency: 0.68,
      emitterStrength: 1.35,
    },
  },
  {
    id: "mercury",
    name: "Mercury",
    description: "Heavier waves with slower spread and a denser body.",
    accent: "#ffd7ad",
    controls: {
      amplitude: 1.45,
      radius: 72,
      damping: 0.014,
      propagationSpeed: 0.16,
      viscosity: 0.22,
      sourceFrequency: 0.38,
      emitterStrength: 1.1,
    },
  },
];

export const SURFACE_ORACLE_CONTROL_META: Array<{
  key: SurfaceOracleControlKey;
  label: string;
  min: number;
  max: number;
  step: number;
  formatter: (value: number) => string;
}> = [
  {
    key: "amplitude",
    label: "Amplitude",
    min: 0.15,
    max: 2.75,
    step: 0.05,
    formatter: value => `${value.toFixed(2)}x`,
  },
  {
    key: "radius",
    label: "Radius",
    min: 12,
    max: 180,
    step: 1,
    formatter: value => `${Math.round(value)} px`,
  },
  {
    key: "damping",
    label: "Damping",
    min: 0.005,
    max: 0.06,
    step: 0.001,
    formatter: value => value.toFixed(3),
  },
  {
    key: "propagationSpeed",
    label: "Spread",
    min: 0.08,
    max: 0.4,
    step: 0.005,
    formatter: value => value.toFixed(3),
  },
  {
    key: "viscosity",
    label: "Viscosity",
    min: 0,
    max: 0.3,
    step: 0.005,
    formatter: value => value.toFixed(3),
  },
  {
    key: "sourceFrequency",
    label: "Emitter Rate",
    min: 0.15,
    max: 2.5,
    step: 0.01,
    formatter: value => `${value.toFixed(2)} hz`,
  },
  {
    key: "emitterStrength",
    label: "Emitter Gain",
    min: 0.1,
    max: 2.2,
    step: 0.02,
    formatter: value => `${value.toFixed(2)}x`,
  },
];

export const SURFACE_ORACLE_EMITTER_VOICES: Array<{
  id: SurfaceOracleEmitterVoiceId;
  label: string;
  shortLabel: string;
  accent: string;
  description: string;
}> = [
  {
    id: "downbeat",
    label: "Downbeat",
    shortLabel: "ONE",
    accent: "#83e7ff",
    description: "Locks to the direct pulse impact and acts like a primary kick voice.",
  },
  {
    id: "four-floor",
    label: "Four Floor",
    shortLabel: "4F",
    accent: "#ffd39c",
    description: "Keeps a steadier metronomic thump even when the pulse gets slippery.",
  },
  {
    id: "anticipation",
    label: "Lift",
    shortLabel: "LIFT",
    accent: "#ff9cdd",
    description: "Swells into the beat and releases around the hit.",
  },
  {
    id: "novelty",
    label: "Flux",
    shortLabel: "FLUX",
    accent: "#9dffc6",
    description: "Listens for surprise, spectral flux, and sudden structural change.",
  },
  {
    id: "bass",
    label: "Bassline",
    shortLabel: "BASS",
    accent: "#92bfff",
    description: "Moves with low-frequency body and wider, slower pressure.",
  },
  {
    id: "shimmer",
    label: "Shimmer",
    shortLabel: "AIR",
    accent: "#e4f1ff",
    description: "Reads high-end sparkle and airy motion as a lighter tracer.",
  },
];

export const SURFACE_ORACLE_EMITTER_VOICE_META = Object.fromEntries(
  SURFACE_ORACLE_EMITTER_VOICES.map(voice => [voice.id, voice])
) as Record<
  SurfaceOracleEmitterVoiceId,
  {
    id: SurfaceOracleEmitterVoiceId;
    label: string;
    shortLabel: string;
    accent: string;
    description: string;
  }
>;

const SURFACE_ORACLE_CLICK_MODE_STORAGE_KEY = "kaleidosync.surfaceOracleClickMode";
const SURFACE_ORACLE_EMITTER_PLACEMENT_MODE_STORAGE_KEY = "kaleidosync.surfaceOracleEmitterPlacementMode";

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createPointerSample(): SurfaceOraclePointerSample {
  return {
    x: 0,
    y: 0,
    inside: false,
  };
}

function createDiagnostics(): SurfaceOracleDiagnosticsSnapshot {
  return {
    fps: 0,
    gridWidth: 0,
    gridHeight: 0,
    cellSize: 0,
    pointer: createPointerSample(),
    emitterCount: 0,
    emitterVoices: [],
  };
}

export const useSurfaceOracleStore = defineStore("surface-oracle", () => {
  const settings = useVisualizerSettings();
  const clickMode = ref<SurfaceOracleClickMode>("emitter");
  const emitterPlacementMode = ref<SurfaceOracleEmitterPlacementMode>("cycle");
  const paused = ref(false);
  const hudVisible = ref(true);
  const resetToken = ref(0);
  const diagnostics = reactive(createDiagnostics());
  const pointerLocked = ref(false);
  const nextEmitterVoiceIndex = ref(0);

  if (typeof window !== "undefined") {
    const savedClickMode = window.localStorage.getItem(SURFACE_ORACLE_CLICK_MODE_STORAGE_KEY);

    if (savedClickMode === "impulse" || savedClickMode === "emitter") {
      clickMode.value = savedClickMode;
    } else {
      window.localStorage.setItem(SURFACE_ORACLE_CLICK_MODE_STORAGE_KEY, clickMode.value);
    }

    const savedEmitterPlacementMode = window.localStorage.getItem(SURFACE_ORACLE_EMITTER_PLACEMENT_MODE_STORAGE_KEY);

    if (savedEmitterPlacementMode === "cycle" || SURFACE_ORACLE_EMITTER_VOICE_META[savedEmitterPlacementMode as SurfaceOracleEmitterVoiceId]) {
      emitterPlacementMode.value = savedEmitterPlacementMode as SurfaceOracleEmitterPlacementMode;
    } else {
      window.localStorage.setItem(SURFACE_ORACLE_EMITTER_PLACEMENT_MODE_STORAGE_KEY, emitterPlacementMode.value);
    }
  }

  const controls = computed<SurfaceOracleControls>(() => {
    return {
      amplitude: clamp(Number(settings.surfaceOracleAmplitude) || 1, 0.15, 2.75),
      radius: clamp(Number(settings.surfaceOracleRadius) || 44, 12, 180),
      damping: clamp(Number(settings.surfaceOracleDamping) || 0.013, 0.005, 0.06),
      propagationSpeed: clamp(Number(settings.surfaceOraclePropagationSpeed) || 0.26, 0.08, 0.4),
      viscosity: clamp(Number(settings.surfaceOracleViscosity) || 0.055, 0, 0.3),
      sourceFrequency: clamp(Number(settings.surfaceOracleSourceFrequency) || 0.82, 0.15, 2.5),
      emitterStrength: clamp(Number(settings.surfaceOracleEmitterStrength) || 1.05, 0.1, 2.2),
    };
  });

  const activePreset = computed(() => {
    return SURFACE_ORACLE_PRESETS.find(preset => preset.id === settings.surfaceOraclePresetId) ?? null;
  });

  const activePresetId = computed<SurfaceOraclePresetId>(() => settings.surfaceOraclePresetId);
  const activePresetName = computed(() => activePreset.value?.name ?? "Custom");
  const activePresetDescription = computed(() => {
    return activePreset.value?.description ?? "Manual tuning mode for probing the surface and shaping the medium by hand.";
  });
  const accent = computed(() => activePreset.value?.accent ?? "#9ddaff");
  const nextEmitterVoice = computed(() => {
    if (emitterPlacementMode.value !== "cycle") {
      return SURFACE_ORACLE_EMITTER_VOICE_META[emitterPlacementMode.value];
    }

    return SURFACE_ORACLE_EMITTER_VOICES[nextEmitterVoiceIndex.value % SURFACE_ORACLE_EMITTER_VOICES.length];
  });

  function applyPreset(presetId: Exclude<SurfaceOraclePresetId, "custom">) {
    const preset = SURFACE_ORACLE_PRESETS.find(entry => entry.id === presetId);
    if (!preset) return;

    settings.surfaceOraclePresetId = preset.id;
    settings.surfaceOracleAmplitude = preset.controls.amplitude;
    settings.surfaceOracleRadius = preset.controls.radius;
    settings.surfaceOracleDamping = preset.controls.damping;
    settings.surfaceOraclePropagationSpeed = preset.controls.propagationSpeed;
    settings.surfaceOracleViscosity = preset.controls.viscosity;
    settings.surfaceOracleSourceFrequency = preset.controls.sourceFrequency;
    settings.surfaceOracleEmitterStrength = preset.controls.emitterStrength;
  }

  function updateControl(key: SurfaceOracleControlKey, value: number) {
    settings.surfaceOraclePresetId = "custom";

    if (key === "amplitude") settings.surfaceOracleAmplitude = clamp(value, 0.15, 2.75);
    if (key === "radius") settings.surfaceOracleRadius = clamp(value, 12, 180);
    if (key === "damping") settings.surfaceOracleDamping = clamp(value, 0.005, 0.06);
    if (key === "propagationSpeed") settings.surfaceOraclePropagationSpeed = clamp(value, 0.08, 0.4);
    if (key === "viscosity") settings.surfaceOracleViscosity = clamp(value, 0, 0.3);
    if (key === "sourceFrequency") settings.surfaceOracleSourceFrequency = clamp(value, 0.15, 2.5);
    if (key === "emitterStrength") settings.surfaceOracleEmitterStrength = clamp(value, 0.1, 2.2);
  }

  function setClickMode(mode: SurfaceOracleClickMode) {
    clickMode.value = mode;
  }

  function setEmitterPlacementMode(mode: SurfaceOracleEmitterPlacementMode) {
    emitterPlacementMode.value = mode;
  }

  function togglePause() {
    paused.value = !paused.value;
  }

  function toggleHudVisibility() {
    hudVisible.value = !hudVisible.value;
  }

  function requestReset() {
    resetToken.value += 1;
    nextEmitterVoiceIndex.value = 0;
  }

  function updateDiagnostics(snapshot: SurfaceOracleDiagnosticsSnapshot) {
    diagnostics.fps = snapshot.fps;
    diagnostics.gridWidth = snapshot.gridWidth;
    diagnostics.gridHeight = snapshot.gridHeight;
    diagnostics.cellSize = snapshot.cellSize;
    diagnostics.pointer.x = snapshot.pointer.x;
    diagnostics.pointer.y = snapshot.pointer.y;
    diagnostics.pointer.inside = snapshot.pointer.inside;
    diagnostics.emitterCount = snapshot.emitterCount;
    diagnostics.emitterVoices = snapshot.emitterVoices;
  }

  function setPointerLocked(locked: boolean) {
    pointerLocked.value = locked;
  }

  function consumeEmitterVoice() {
    if (emitterPlacementMode.value !== "cycle") {
      return SURFACE_ORACLE_EMITTER_VOICE_META[emitterPlacementMode.value];
    }

    const voice = SURFACE_ORACLE_EMITTER_VOICES[nextEmitterVoiceIndex.value % SURFACE_ORACLE_EMITTER_VOICES.length];
    nextEmitterVoiceIndex.value = (nextEmitterVoiceIndex.value + 1) % SURFACE_ORACLE_EMITTER_VOICES.length;
    return voice;
  }

  function resetEmitterVoiceCycle() {
    nextEmitterVoiceIndex.value = 0;
  }

  watch(clickMode, nextMode => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SURFACE_ORACLE_CLICK_MODE_STORAGE_KEY, nextMode);
  });

  watch(emitterPlacementMode, nextMode => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(SURFACE_ORACLE_EMITTER_PLACEMENT_MODE_STORAGE_KEY, nextMode);
  });

  return {
    controls,
    clickMode,
    emitterPlacementMode,
    paused,
    hudVisible,
    resetToken,
    diagnostics,
    pointerLocked,
    activePreset,
    activePresetId,
    activePresetName,
    activePresetDescription,
    accent,
    nextEmitterVoice,
    applyPreset,
    updateControl,
    setClickMode,
    setEmitterPlacementMode,
    togglePause,
    toggleHudVisibility,
    requestReset,
    updateDiagnostics,
    setPointerLocked,
    consumeEmitterVoice,
    resetEmitterVoiceCycle,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useSurfaceOracleStore, import.meta.hot));
}
