import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, watch } from "vue";

export const VISUALIZATION_MODES = ["classic", "fractal-traverse"] as const;
export type VisualizationMode = (typeof VISUALIZATION_MODES)[number];
export const FRACTAL_TRAVERSE_LAYOUT_MODES = ["full-frame", "pizza-kaleido"] as const;
export type FractalTraverseLayoutMode = (typeof FRACTAL_TRAVERSE_LAYOUT_MODES)[number];

function createPersistedBoolean(key: string, fallback: boolean) {
  const value = ref(fallback);

  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(key);
    if (saved === "true") value.value = true;
    if (saved === "false") value.value = false;
  }

  watch(value, (nextValue) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, String(nextValue));
  });

  return value;
}

function createPersistedNumber(key: string, fallback: number) {
  const value = ref(fallback);

  if (typeof window !== "undefined") {
    const saved = Number(window.localStorage.getItem(key));
    if (!Number.isNaN(saved) && Number.isFinite(saved)) {
      value.value = saved;
    }
  }

  watch(value, (nextValue) => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, String(nextValue));
  });

  return value;
}

function createPersistedString<T extends string>(
  key: string,
  fallback: T,
  allowedValues: readonly T[],
  legacyResolver?: () => T | null
) {
  const value = ref<T>(fallback);

  if (typeof window !== "undefined") {
    const saved = window.localStorage.getItem(key);

    if (saved && allowedValues.includes(saved as T)) {
      value.value = saved as T;
    } else if (legacyResolver) {
      const legacyValue = legacyResolver();

      if (legacyValue && allowedValues.includes(legacyValue)) {
        value.value = legacyValue;
        window.localStorage.setItem(key, legacyValue);
      }
    }
  }

  watch(value, nextValue => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(key, nextValue);
  });

  return value;
}

export const useVisualizerSettings = defineStore("visualizer-settings", () => {
  const disableFlashing = createPersistedBoolean("kaleidosync.disableFlashing", false);
  const neonMode = createPersistedBoolean("kaleidosync.neonMode", false);
  const showMenuLabels = createPersistedBoolean("kaleidosync.showMenuLabels", false);
  const alwaysShowTrack = createPersistedBoolean("kaleidosync.alwaysShowTrack", false);
  const infinityPlay = createPersistedBoolean("kaleidosync.infinityPlay", false);
  const preferLossless = createPersistedBoolean("kaleidosync.preferLossless", false);
  const autoCyclePresets = createPersistedBoolean("kaleidosync.autoCyclePresets", true);
  const audioReactiveCycling = createPersistedBoolean("kaleidosync.audioReactiveCycling", true);
  const cycleRate = createPersistedNumber("kaleidosync.cycleRate", 0.85);
  const prismVeil = createPersistedBoolean("kaleidosync.prismVeil", true);
  const prismVeilStrength = createPersistedNumber("kaleidosync.prismVeilStrength", 0.78);
  const beatHorizon = createPersistedBoolean("kaleidosync.beatHorizon", true);
  const beatHorizonStrength = createPersistedNumber("kaleidosync.beatHorizonStrength", 0.88);
  const visualizationMode = createPersistedString<VisualizationMode>(
    "kaleidosync.visualizationMode",
    "classic",
    VISUALIZATION_MODES,
    () => {
      if (typeof window === "undefined") return null;
      return window.localStorage.getItem("kaleidosync.fractalTraverse") === "true" ? "fractal-traverse" : null;
    }
  );
  const fractalTraverseStrength = createPersistedNumber("kaleidosync.fractalTraverseStrength", 0.84);
  const fractalTraverseLayoutMode = createPersistedString<FractalTraverseLayoutMode>(
    "kaleidosync.fractalTraverseLayoutMode",
    "full-frame",
    FRACTAL_TRAVERSE_LAYOUT_MODES
  );
  const fractalTraverseSliceCount = createPersistedNumber("kaleidosync.fractalTraverseSliceCount", 8);

  return {
    disableFlashing,
    neonMode,
    showMenuLabels,
    alwaysShowTrack,
    infinityPlay,
    preferLossless,
    autoCyclePresets,
    audioReactiveCycling,
    cycleRate,
    prismVeil,
    prismVeilStrength,
    beatHorizon,
    beatHorizonStrength,
    visualizationMode,
    fractalTraverseStrength,
    fractalTraverseLayoutMode,
    fractalTraverseSliceCount,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useVisualizerSettings, import.meta.hot));
}
