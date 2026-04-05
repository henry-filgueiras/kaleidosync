import { acceptHMRUpdate, defineStore } from "pinia";
import { ref, watch } from "vue";

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
  const fractalTraverse = createPersistedBoolean("kaleidosync.fractalTraverse", true);
  const fractalTraverseStrength = createPersistedNumber("kaleidosync.fractalTraverseStrength", 0.84);

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
    fractalTraverse,
    fractalTraverseStrength,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useVisualizerSettings, import.meta.hot));
}
