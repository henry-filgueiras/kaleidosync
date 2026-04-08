import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, reactive, ref, watch } from "vue";
import { useVisualizerSettings } from "./visualizer-settings";

const PIZZA_PRESET_STORAGE_KEY = "kaleidosync.pizzaPresetLab.activePreset";
const DEFAULT_PIZZA_PRESET_DURATION_MS = 920;

export type PizzaPresetLook = {
  fractalStrength: number;
  carveDepth: number;
  grooveStrength: number;
  crustProtection: number;
  valleyGlow: number;
  shadingContrast: number;
  ridgeBrowning: number;
  sauceWetness: number;
  toppingInfluence: number;
};

export type PizzaPresetCamera = {
  orbit: number;
  elevation: number;
  distance: number;
  targetY: number;
};

export type PizzaPresetLighting = {
  rotation: number;
  elevation: number;
  contrast: number;
  rim: number;
};

export type PizzaPresetSnapshot = {
  look: PizzaPresetLook;
  camera: PizzaPresetCamera;
  lighting: PizzaPresetLighting;
};

export type PizzaPresetDefinition = {
  id: string;
  label: string;
  subtitle: string;
  description: string;
  accent: string;
  artifactClass: string;
  surfaceMode: string;
  materialState: string;
  transitionMs?: number;
  look: PizzaPresetLook;
  camera: PizzaPresetCamera;
  lighting: PizzaPresetLighting;
};

const LOOK_KEYS = [
  "fractalStrength",
  "carveDepth",
  "grooveStrength",
  "crustProtection",
  "valleyGlow",
  "shadingContrast",
  "ridgeBrowning",
  "sauceWetness",
  "toppingInfluence",
] as const;

const CAMERA_KEYS = ["orbit", "elevation", "distance", "targetY"] as const;
const LIGHTING_KEYS = ["rotation", "elevation", "contrast", "rim"] as const;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, progress: number) {
  return start + (end - start) * progress;
}

function easeInOutCubic(progress: number) {
  return progress < 0.5 ? 4 * progress * progress * progress : 1 - Math.pow(-2 * progress + 2, 3) / 2;
}

function cloneLook(look: PizzaPresetLook): PizzaPresetLook {
  return {
    fractalStrength: look.fractalStrength,
    carveDepth: look.carveDepth,
    grooveStrength: look.grooveStrength,
    crustProtection: look.crustProtection,
    valleyGlow: look.valleyGlow,
    shadingContrast: look.shadingContrast,
    ridgeBrowning: look.ridgeBrowning,
    sauceWetness: look.sauceWetness,
    toppingInfluence: look.toppingInfluence,
  };
}

function cloneCamera(camera: PizzaPresetCamera): PizzaPresetCamera {
  return {
    orbit: camera.orbit,
    elevation: camera.elevation,
    distance: camera.distance,
    targetY: camera.targetY,
  };
}

function cloneLighting(lighting: PizzaPresetLighting): PizzaPresetLighting {
  return {
    rotation: lighting.rotation,
    elevation: lighting.elevation,
    contrast: lighting.contrast,
    rim: lighting.rim,
  };
}

function cloneSnapshot(snapshot: PizzaPresetSnapshot): PizzaPresetSnapshot {
  return {
    look: cloneLook(snapshot.look),
    camera: cloneCamera(snapshot.camera),
    lighting: cloneLighting(snapshot.lighting),
  };
}

function applySnapshot(target: PizzaPresetSnapshot, source: PizzaPresetSnapshot) {
  for (const key of LOOK_KEYS) {
    target.look[key] = source.look[key];
  }

  for (const key of CAMERA_KEYS) {
    target.camera[key] = source.camera[key];
  }

  for (const key of LIGHTING_KEYS) {
    target.lighting[key] = source.lighting[key];
  }
}

function interpolateSnapshot(
  from: PizzaPresetSnapshot,
  to: PizzaPresetSnapshot,
  progress: number
): PizzaPresetSnapshot {
  const snapshot = cloneSnapshot(from);

  for (const key of LOOK_KEYS) {
    snapshot.look[key] = lerp(from.look[key], to.look[key], progress);
  }

  for (const key of CAMERA_KEYS) {
    snapshot.camera[key] = lerp(from.camera[key], to.camera[key], progress);
  }

  for (const key of LIGHTING_KEYS) {
    snapshot.lighting[key] = lerp(from.lighting[key], to.lighting[key], progress);
  }

  return snapshot;
}

export function getPizzaPresetLookFromSettings(
  settings: ReturnType<typeof useVisualizerSettings>
): PizzaPresetLook {
  return {
    fractalStrength: clamp(Number(settings.fractalTraverseStrength) || 0.84, 0.35, 1.35),
    carveDepth: clamp(Number(settings.fractalTraversePizzaCarveDepth) || 1, 0.55, 1.45),
    grooveStrength: clamp(Number(settings.fractalTraversePizzaGrooveStrength) || 0.72, 0.2, 1.25),
    crustProtection: clamp(Number(settings.fractalTraversePizzaCrustProtection) || 0.82, 0.68, 0.9),
    valleyGlow: clamp(Number(settings.fractalTraversePizzaValleyGlow) || 0.38, 0, 0.85),
    shadingContrast: 0.94,
    ridgeBrowning: 0.82,
    sauceWetness: 0.92,
    toppingInfluence: 0.16,
  };
}

function resolveLiveLook(
  settings: ReturnType<typeof useVisualizerSettings>,
  preset: PizzaPresetDefinition
): PizzaPresetLook {
  const settingsLook = getPizzaPresetLookFromSettings(settings);

  return {
    fractalStrength: settingsLook.fractalStrength,
    carveDepth: settingsLook.carveDepth,
    grooveStrength: settingsLook.grooveStrength,
    crustProtection: settingsLook.crustProtection,
    valleyGlow: settingsLook.valleyGlow,
    shadingContrast: preset.look.shadingContrast,
    ridgeBrowning: preset.look.ridgeBrowning,
    sauceWetness: preset.look.sauceWetness,
    toppingInfluence: preset.look.toppingInfluence,
  };
}

export function applyPizzaPresetLookToSettings(
  settings: ReturnType<typeof useVisualizerSettings>,
  look: PizzaPresetLook
) {
  settings.visualizationMode = "fractal-traverse";
  settings.fractalTraverseLayoutMode = "pizza-kaleido";
  settings.fractalTraverseStrength = Number(look.fractalStrength.toFixed(3));
  settings.fractalTraversePizzaCarveDepth = Number(look.carveDepth.toFixed(3));
  settings.fractalTraversePizzaGrooveStrength = Number(look.grooveStrength.toFixed(3));
  settings.fractalTraversePizzaCrustProtection = Number(look.crustProtection.toFixed(3));
  settings.fractalTraversePizzaValleyGlow = Number(look.valleyGlow.toFixed(3));
}

export const PIZZA_PRESET_LAB_PRESETS: PizzaPresetDefinition[] = [
  {
    id: "topo-pie",
    label: "Topo Pie",
    subtitle: "Artifact Class: Edible Topography",
    description: "Balanced terrain-first relief with browned ridges and sauced valleys.",
    accent: "hsl(24 92% 66%)",
    artifactClass: "Edible Topography",
    surfaceMode: "Relief-Forward",
    materialState: "Cheese Ridge / Sauce Basin",
    look: {
      fractalStrength: 0.92,
      carveDepth: 1.04,
      grooveStrength: 0.36,
      crustProtection: 0.84,
      valleyGlow: 0.1,
      shadingContrast: 0.98,
      ridgeBrowning: 0.88,
      sauceWetness: 0.82,
      toppingInfluence: 0.34,
    },
    camera: {
      orbit: -1.84,
      elevation: 0.9,
      distance: 2.16,
      targetY: -0.03,
    },
    lighting: {
      rotation: -2.38,
      elevation: 0.9,
      contrast: 0.92,
      rim: 0.66,
    },
  },
  {
    id: "chaos-scar",
    label: "Chaos Scar",
    subtitle: "Surface Mode: Lorenz-Inscribed",
    description: "A more deliberate attractor groove cut across the terrain without losing the pizza read.",
    accent: "hsl(10 94% 68%)",
    artifactClass: "Chaos-Scored Relic",
    surfaceMode: "Lorenz-Inscribed",
    materialState: "Scarred Cheese Canopy",
    look: {
      fractalStrength: 0.9,
      carveDepth: 1.02,
      grooveStrength: 0.66,
      crustProtection: 0.845,
      valleyGlow: 0.18,
      shadingContrast: 1.02,
      ridgeBrowning: 0.82,
      sauceWetness: 0.9,
      toppingInfluence: 0.26,
    },
    camera: {
      orbit: -1.7,
      elevation: 0.84,
      distance: 2.02,
      targetY: -0.02,
    },
    lighting: {
      rotation: -2.28,
      elevation: 0.84,
      contrast: 1.02,
      rim: 0.72,
    },
  },
  {
    id: "forbidden-artifact",
    label: "Forbidden Artifact",
    subtitle: "Material State: Heated Relic Flesh",
    description: "Darker valleys, hotter glow, and harsher relief for the cursed museum specimen version.",
    accent: "hsl(350 86% 66%)",
    artifactClass: "Forbidden Food Relic",
    surfaceMode: "Cursed Relief",
    materialState: "Hot Basin / Blackened Crest",
    transitionMs: 1040,
    look: {
      fractalStrength: 1.02,
      carveDepth: 1.16,
      grooveStrength: 0.58,
      crustProtection: 0.81,
      valleyGlow: 0.46,
      shadingContrast: 1.16,
      ridgeBrowning: 1.04,
      sauceWetness: 0.98,
      toppingInfluence: 0.2,
    },
    camera: {
      orbit: -1.56,
      elevation: 0.8,
      distance: 2.08,
      targetY: -0.015,
    },
    lighting: {
      rotation: -2.08,
      elevation: 0.82,
      contrast: 1.18,
      rim: 0.84,
    },
  },
  {
    id: "pepperoni-mesa",
    label: "Pepperoni Mesa",
    subtitle: "Surface Mode: Topping-Capped Terrain",
    description: "Procedural pepperoni caps ride the relief like little mesas and hard plateaus.",
    accent: "hsl(16 88% 64%)",
    artifactClass: "Mesa Slice Survey",
    surfaceMode: "Topping-Capped Terrain",
    materialState: "Pepperoni Caps / Toasted Plains",
    look: {
      fractalStrength: 0.88,
      carveDepth: 1,
      grooveStrength: 0.34,
      crustProtection: 0.85,
      valleyGlow: 0.1,
      shadingContrast: 0.94,
      ridgeBrowning: 0.82,
      sauceWetness: 0.8,
      toppingInfluence: 1,
    },
    camera: {
      orbit: -1.92,
      elevation: 0.9,
      distance: 2.16,
      targetY: -0.04,
    },
    lighting: {
      rotation: -2.46,
      elevation: 0.92,
      contrast: 0.94,
      rim: 0.64,
    },
  },
  {
    id: "sauce-abyss",
    label: "Sauce Abyss",
    subtitle: "Artifact Class: Marinara Chasm",
    description: "A wetter, deeper sauce-heavy interpretation with strong cavity read and protected crust.",
    accent: "hsl(4 88% 64%)",
    artifactClass: "Marinara Chasm",
    surfaceMode: "Sauce-Weighted",
    materialState: "Wet Basin / Toasted Rim",
    transitionMs: 980,
    look: {
      fractalStrength: 0.98,
      carveDepth: 1.1,
      grooveStrength: 0.46,
      crustProtection: 0.86,
      valleyGlow: 0.24,
      shadingContrast: 1.04,
      ridgeBrowning: 0.76,
      sauceWetness: 1.02,
      toppingInfluence: 0.18,
    },
    camera: {
      orbit: -1.74,
      elevation: 0.82,
      distance: 2.08,
      targetY: -0.02,
    },
    lighting: {
      rotation: -2.36,
      elevation: 0.84,
      contrast: 1.08,
      rim: 0.78,
    },
  },
];

export const PIZZA_PRESET_IDS = PIZZA_PRESET_LAB_PRESETS.map(preset => preset.id);

function getPresetById(id: string) {
  return PIZZA_PRESET_LAB_PRESETS.find(preset => preset.id === id) ?? PIZZA_PRESET_LAB_PRESETS[0];
}

function presetToSnapshot(preset: PizzaPresetDefinition): PizzaPresetSnapshot {
  return {
    look: cloneLook(preset.look),
    camera: cloneCamera(preset.camera),
    lighting: cloneLighting(preset.lighting),
  };
}

function getStoredPresetId() {
  if (typeof window === "undefined") {
    return PIZZA_PRESET_LAB_PRESETS[0].id;
  }

  const saved = window.localStorage.getItem(PIZZA_PRESET_STORAGE_KEY);
  return saved && PIZZA_PRESET_IDS.includes(saved) ? saved : PIZZA_PRESET_LAB_PRESETS[0].id;
}

export const usePizzaPresetLab = defineStore("pizza-preset-lab", () => {
  const settings = useVisualizerSettings();
  const activePresetId = ref(getStoredPresetId());
  const transitionProgress = ref(1);
  const transitionStartedAt = ref(0);
  const transitionDurationMs = ref(DEFAULT_PIZZA_PRESET_DURATION_MS);
  const transitionFrom = reactive<PizzaPresetSnapshot>(presetToSnapshot(getPresetById(activePresetId.value)));
  const transitionCurrent = reactive<PizzaPresetSnapshot>(presetToSnapshot(getPresetById(activePresetId.value)));
  const transitionTarget = reactive<PizzaPresetSnapshot>(presetToSnapshot(getPresetById(activePresetId.value)));

  const activePreset = computed(() => getPresetById(activePresetId.value));
  const isTransitioning = computed(() => transitionProgress.value < 1);
  const currentLook = computed(() => {
    return isTransitioning.value ? transitionCurrent.look : resolveLiveLook(settings, activePreset.value);
  });
  const currentCamera = computed(() => {
    return isTransitioning.value ? transitionCurrent.camera : activePreset.value.camera;
  });
  const currentLighting = computed(() => {
    return isTransitioning.value ? transitionCurrent.lighting : activePreset.value.lighting;
  });
  const transitionIndicator = computed(() => {
    return isTransitioning.value ? easeInOutCubic(transitionProgress.value) : 1;
  });

  watch(activePresetId, nextId => {
    if (typeof window === "undefined") return;
    window.localStorage.setItem(PIZZA_PRESET_STORAGE_KEY, nextId);
  });

  function step(now = typeof performance !== "undefined" ? performance.now() : Date.now()) {
    if (!isTransitioning.value) return;

    const duration = Math.max(transitionDurationMs.value, 1);
    const rawProgress = clamp((now - transitionStartedAt.value) / duration, 0, 1);
    const easedProgress = easeInOutCubic(rawProgress);
    const interpolated = interpolateSnapshot(transitionFrom, transitionTarget, easedProgress);

    applySnapshot(transitionCurrent, interpolated);
    transitionProgress.value = rawProgress;

    if (rawProgress >= 1) {
      applySnapshot(transitionCurrent, transitionTarget);
      transitionProgress.value = 1;
    }
  }

  function selectPreset(nextPresetId: string) {
    if (!isTransitioning.value && nextPresetId === activePresetId.value) {
      return;
    }

    const nextPreset = getPresetById(nextPresetId);
    const currentSnapshot: PizzaPresetSnapshot = isTransitioning.value
      ? cloneSnapshot(transitionCurrent)
      : {
          look: resolveLiveLook(settings, activePreset.value),
          camera: cloneCamera(activePreset.value.camera),
          lighting: cloneLighting(activePreset.value.lighting),
        };

    applySnapshot(transitionFrom, currentSnapshot);
    applySnapshot(transitionCurrent, currentSnapshot);
    applySnapshot(transitionTarget, presetToSnapshot(nextPreset));

    activePresetId.value = nextPreset.id;
    applyPizzaPresetLookToSettings(settings, nextPreset.look);

    transitionDurationMs.value = Math.max(0, nextPreset.transitionMs ?? DEFAULT_PIZZA_PRESET_DURATION_MS);
    transitionStartedAt.value = typeof performance !== "undefined" ? performance.now() : Date.now();
    transitionProgress.value = transitionDurationMs.value === 0 ? 1 : 0;

    if (transitionDurationMs.value === 0) {
      applySnapshot(transitionCurrent, transitionTarget);
    }
  }

  function selectRelativePreset(direction: 1 | -1) {
    const currentIndex = PIZZA_PRESET_LAB_PRESETS.findIndex(preset => preset.id === activePresetId.value);
    const safeIndex = currentIndex >= 0 ? currentIndex : 0;
    const nextIndex = (safeIndex + direction + PIZZA_PRESET_LAB_PRESETS.length) % PIZZA_PRESET_LAB_PRESETS.length;
    selectPreset(PIZZA_PRESET_LAB_PRESETS[nextIndex].id);
  }

  return {
    presets: PIZZA_PRESET_LAB_PRESETS,
    activePresetId,
    activePreset,
    currentLook,
    currentCamera,
    currentLighting,
    transitionProgress,
    transitionIndicator,
    isTransitioning,
    selectPreset,
    selectRelativePreset,
    step,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePizzaPresetLab, import.meta.hot));
}
