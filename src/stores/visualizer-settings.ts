import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, watch } from "vue";

export const VISUALIZATION_MODES = ["classic", "fractal-traverse"] as const;
export type VisualizationMode = (typeof VISUALIZATION_MODES)[number];
export const FRACTAL_TRAVERSE_LAYOUT_MODES = ["full-frame", "pizza-kaleido", "pizza-coin"] as const;
export type FractalTraverseLayoutMode = (typeof FRACTAL_TRAVERSE_LAYOUT_MODES)[number];
const PIZZA_TOPOGRAPHY_MIGRATION_KEY = "kaleidosync.visualizationDefaultsVersion";
const PIZZA_TOPOGRAPHY_MIGRATION_VERSION = "pizza-topography-v1";

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
    "fractal-traverse",
    VISUALIZATION_MODES,
    () => {
      if (typeof window === "undefined") return null;
      return window.localStorage.getItem("kaleidosync.fractalTraverse") === "true" ? "fractal-traverse" : null;
    }
  );
  const fractalTraverseStrength = createPersistedNumber("kaleidosync.fractalTraverseStrength", 0.84);
  const fractalTraverseLayoutMode = createPersistedString<FractalTraverseLayoutMode>(
    "kaleidosync.fractalTraverseLayoutMode",
    "pizza-kaleido",
    FRACTAL_TRAVERSE_LAYOUT_MODES
  );
  const fractalTraverseSliceCount = createPersistedNumber("kaleidosync.fractalTraverseSliceCount", 8);
  const fractalTraversePizzaCarveDepth = createPersistedNumber("kaleidosync.fractalTraversePizzaCarveDepth", 1);
  const fractalTraversePizzaGrooveStrength = createPersistedNumber("kaleidosync.fractalTraversePizzaGrooveStrength", 0.72);
  const fractalTraversePizzaCrustProtection = createPersistedNumber("kaleidosync.fractalTraversePizzaCrustProtection", 0.82);
  const fractalTraversePizzaValleyGlow = createPersistedNumber("kaleidosync.fractalTraversePizzaValleyGlow", 0.38);

  if (typeof window !== "undefined") {
    const migrationVersion = window.localStorage.getItem(PIZZA_TOPOGRAPHY_MIGRATION_KEY);

    if (migrationVersion !== PIZZA_TOPOGRAPHY_MIGRATION_VERSION) {
      const savedVisualizationMode = window.localStorage.getItem("kaleidosync.visualizationMode");
      const savedLayoutMode = window.localStorage.getItem("kaleidosync.fractalTraverseLayoutMode");

      if (savedVisualizationMode === null || savedVisualizationMode === "classic") {
        visualizationMode.value = "fractal-traverse";
      }

      if (savedLayoutMode === null || savedLayoutMode === "full-frame") {
        fractalTraverseLayoutMode.value = "pizza-kaleido";
      }

      window.localStorage.setItem(PIZZA_TOPOGRAPHY_MIGRATION_KEY, PIZZA_TOPOGRAPHY_MIGRATION_VERSION);
    }
  }

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
    fractalTraversePizzaCarveDepth,
    fractalTraversePizzaGrooveStrength,
    fractalTraversePizzaCrustProtection,
    fractalTraversePizzaValleyGlow,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useVisualizerSettings, import.meta.hot));
}
