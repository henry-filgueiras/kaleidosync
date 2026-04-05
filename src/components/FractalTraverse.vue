<template>
  <Transition name="fade">
    <aside v-if="visible" class="traverse" aria-hidden="true">
      <canvas ref="canvas" class="canvas"></canvas>
      <div class="wash wash-a"></div>
      <div class="wash wash-b"></div>
      <div class="vignette"></div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { AudioSource } from "@wearesage/shared";
import { audioSystem } from "@wearesage/vue/classes/AudioSystemManager";
import { useViewport } from "@wearesage/vue";
import { RAW_AUDIO_NOISE_FLOOR_DB, rawLevelToDecibels, sampleRawAnalyserLevel } from "../audio-level";
import { useSources } from "../stores/sources";
import { useVisualizerSettings } from "../stores/visualizer-settings";

type ComplexPoint = {
  x: number;
  y: number;
};

type FractalViewport = {
  center: ComplexPoint;
  scale: number;
  rotation: number;
};

type FractalWaypoint = {
  center: ComplexPoint;
  scale: number;
  bend: number;
  rotation: number;
  hueOffset: number;
};

type MutableFractalSample = {
  escaped: boolean;
  smooth: number;
  trap: number;
};

type FractalFamily = {
  id: string;
  guidePoints: FractalWaypoint[];
  getStartViewport: () => FractalViewport;
  getMaxIterations: (scale: number) => number;
  sample: (pointX: number, pointY: number, maxIterations: number, out: MutableFractalSample) => void;
};

type AudioResponseState = {
  analyserBuffer: Uint8Array | null;
  fastEnergy: number;
  slowEnergy: number;
  previousFeature: number;
  noveltyHistory: number[];
  novelty: number;
  noveltySmoothed: number;
  surge: number;
  ambient: number;
  zoom: number;
  bend: number;
  palette: number;
  stream: number;
  loudness: number;
};

type TraversalState = {
  currentIndex: number;
  nextIndex: number;
  progress: number;
  segmentDuration: number;
  pathSpeed: number;
  rotation: number;
  bendPhase: number;
  driftPhase: number;
  palettePhase: number;
  segmentSeed: number;
  camera: FractalViewport;
};

type RenderState = {
  displayCanvas: HTMLCanvasElement | null;
  displayContext: CanvasRenderingContext2D | null;
  offscreenCanvas: HTMLCanvasElement | null;
  offscreenContext: CanvasRenderingContext2D | null;
  imageData: ImageData | null;
  renderWidth: number;
  renderHeight: number;
  displayWidth: number;
  displayHeight: number;
  sample: MutableFractalSample;
};

const canvas = ref<HTMLCanvasElement | null>(null);
const viewport = useViewport();
const sources = useSources();
const settings = useVisualizerSettings();

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function damp(current: number, target: number, smoothing: number, deltaSeconds: number) {
  return current + (target - current) * (1 - Math.exp(-smoothing * deltaSeconds));
}

function smoothStep(value: number) {
  const clamped = clamp(value, 0, 1);
  return clamped * clamped * (3 - 2 * clamped);
}

function distance(a: ComplexPoint, b: ComplexPoint) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function cubicBezierPoint(start: ComplexPoint, controlA: ComplexPoint, controlB: ComplexPoint, end: ComplexPoint, amount: number) {
  const inverse = 1 - amount;
  const inverseSquared = inverse * inverse;
  const amountSquared = amount * amount;

  return {
    x:
      inverseSquared * inverse * start.x +
      3 * inverseSquared * amount * controlA.x +
      3 * inverse * amountSquared * controlB.x +
      amountSquared * amount * end.x,
    y:
      inverseSquared * inverse * start.y +
      3 * inverseSquared * amount * controlA.y +
      3 * inverse * amountSquared * controlB.y +
      amountSquared * amount * end.y,
  };
}

function createMandelbrotFamily(): FractalFamily {
  // These guide points keep v1 traveling through reliably interesting Mandelbrot regions
  // without pulling traversal policy into the renderer or audio-response code.
  const guidePoints: FractalWaypoint[] = [
    { center: { x: -0.5, y: 0 }, scale: 2.35, bend: 0.12, rotation: -0.02, hueOffset: 0.02 },
    { center: { x: -0.785, y: 0.125 }, scale: 0.46, bend: 0.18, rotation: 0.03, hueOffset: 0.14 },
    { center: { x: -0.7436, y: 0.1318 }, scale: 0.14, bend: -0.2, rotation: 0.06, hueOffset: 0.28 },
    { center: { x: -0.7449, y: 0.1352 }, scale: 0.038, bend: 0.24, rotation: 0.09, hueOffset: 0.36 },
    { center: { x: -0.5, y: 0 }, scale: 1.68, bend: -0.08, rotation: -0.03, hueOffset: 0.48 },
    { center: { x: -1.7688, y: 0.0017 }, scale: 0.34, bend: -0.16, rotation: -0.05, hueOffset: 0.6 },
    { center: { x: -1.2507, y: 0.0201 }, scale: 0.12, bend: 0.16, rotation: 0.04, hueOffset: 0.7 },
    { center: { x: -0.1589, y: 1.0342 }, scale: 0.26, bend: 0.2, rotation: 0.05, hueOffset: 0.82 },
    { center: { x: -0.7412, y: 0.1587 }, scale: 0.09, bend: -0.18, rotation: 0.08, hueOffset: 0.92 },
  ];

  return {
    id: "mandelbrot",
    guidePoints,
    getStartViewport() {
      const first = guidePoints[0];
      return {
        center: { x: first.center.x, y: first.center.y },
        scale: first.scale,
        rotation: first.rotation,
      };
    },
    getMaxIterations(scale: number) {
      const zoomDepth = Math.log10(2.35 / Math.max(scale, 0.000001));
      return clamp(Math.round(78 + Math.max(0, zoomDepth) * 34), 78, 188);
    },
    sample(pointX: number, pointY: number, maxIterations: number, out: MutableFractalSample) {
      let zx = 0;
      let zy = 0;
      let zxSquared = 0;
      let zySquared = 0;
      let trap = Number.POSITIVE_INFINITY;
      let iteration = 0;

      for (; iteration < maxIterations && zxSquared + zySquared <= 16; iteration++) {
        zy = 2 * zx * zy + pointY;
        zx = zxSquared - zySquared + pointX;
        zxSquared = zx * zx;
        zySquared = zy * zy;
        trap = Math.min(trap, Math.abs(zx * zy), Math.abs(zx) + Math.abs(zy) * 0.35);
      }

      if (iteration >= maxIterations) {
        out.escaped = false;
        out.smooth = maxIterations;
        out.trap = trap;
        return;
      }

      const radius = Math.sqrt(zxSquared + zySquared);
      out.escaped = true;
      out.smooth = iteration + 1 - Math.log2(Math.log2(Math.max(radius, 4)));
      out.trap = trap;
    },
  };
}

function createAudioState(): AudioResponseState {
  return {
    analyserBuffer: null,
    fastEnergy: 0,
    slowEnergy: 0,
    previousFeature: 0,
    noveltyHistory: [],
    novelty: 0,
    noveltySmoothed: 0,
    surge: 0,
    ambient: 0.16,
    zoom: 0.12,
    bend: 0.2,
    palette: 0.18,
    stream: 0,
    loudness: 0,
  };
}

const family = createMandelbrotFamily();
const renderState: RenderState = {
  displayCanvas: null,
  displayContext: null,
  offscreenCanvas: null,
  offscreenContext: null,
  imageData: null,
  renderWidth: 0,
  renderHeight: 0,
  displayWidth: 0,
  displayHeight: 0,
  sample: {
    escaped: false,
    smooth: 0,
    trap: 0,
  },
};

const audio = createAudioState();
const traversal: TraversalState = createTraversalState(family);
const renderIntervalMs = 1000 / 24;
let animationFrameId = 0;
let lastFrameTime = 0;
let lastRenderTime = 0;

const visible = computed(() => {
  return settings.fractalTraverse && sources.source !== null && sources.source !== AudioSource.NONE;
});

const strength = computed(() => {
  return clamp(Number(settings.fractalTraverseStrength) || 0.84, 0.35, 1.35);
});

function createTraversalState(fractalFamily: FractalFamily): TraversalState {
  const camera = fractalFamily.getStartViewport();
  return {
    currentIndex: 0,
    nextIndex: 1,
    progress: 0,
    segmentDuration: calculateSegmentDuration(fractalFamily.guidePoints[0], fractalFamily.guidePoints[1]),
    pathSpeed: 1,
    rotation: camera.rotation,
    bendPhase: 0,
    driftPhase: 0,
    palettePhase: fractalFamily.guidePoints[0].hueOffset,
    segmentSeed: 0.37,
    camera,
  };
}

function calculateSegmentDuration(from: FractalWaypoint, to: FractalWaypoint) {
  // Blend spatial distance with zoom distance so wide repositions do not feel like cuts,
  // and deep dives still have enough time to read as deliberate travel.
  const spatialDistance = distance(from.center, to.center);
  const zoomDistance = Math.abs(Math.log(Math.max(from.scale, 0.000001) / Math.max(to.scale, 0.000001)));
  return clamp(8.5 + spatialDistance * 5.2 + zoomDistance * 3.7, 8.5, 20);
}

function resetAudioState() {
  audio.analyserBuffer = null;
  audio.fastEnergy = 0;
  audio.slowEnergy = 0;
  audio.previousFeature = 0;
  audio.noveltyHistory = [];
  audio.novelty = 0;
  audio.noveltySmoothed = 0;
  audio.surge = 0;
  audio.ambient = 0.16;
  audio.zoom = 0.12;
  audio.bend = 0.2;
  audio.palette = 0.18;
  audio.stream = 0;
  audio.loudness = 0;
}

function resetTraversalState() {
  const start = family.getStartViewport();
  traversal.currentIndex = 0;
  traversal.nextIndex = 1;
  traversal.progress = 0;
  traversal.segmentDuration = calculateSegmentDuration(family.guidePoints[0], family.guidePoints[1]);
  traversal.pathSpeed = 1;
  traversal.rotation = start.rotation;
  traversal.bendPhase = 0;
  traversal.driftPhase = 0;
  traversal.palettePhase = family.guidePoints[0].hueOffset;
  traversal.segmentSeed = 0.37;
  traversal.camera = start;
}

function advanceSegment() {
  traversal.currentIndex = traversal.nextIndex;
  traversal.nextIndex = (traversal.nextIndex + 1) % family.guidePoints.length;
  traversal.progress -= 1;
  traversal.segmentDuration = calculateSegmentDuration(
    family.guidePoints[traversal.currentIndex],
    family.guidePoints[traversal.nextIndex]
  );
  traversal.segmentSeed += 1.61803398875;
}

function ensureContexts() {
  if (!canvas.value) return false;

  if (renderState.displayCanvas !== canvas.value) {
    renderState.displayCanvas = canvas.value;
    renderState.displayContext = canvas.value.getContext("2d");
  }

  if (!renderState.offscreenCanvas) {
    renderState.offscreenCanvas = document.createElement("canvas");
    renderState.offscreenContext = renderState.offscreenCanvas.getContext("2d");
  }

  return Boolean(renderState.displayContext && renderState.offscreenCanvas && renderState.offscreenContext);
}

function updateRenderResolution() {
  if (!ensureContexts() || !canvas.value || !renderState.offscreenCanvas || !renderState.offscreenContext) return;

  const width = Math.max(1, Math.round(viewport.width || window.innerWidth || 1));
  const height = Math.max(1, Math.round(viewport.height || window.innerHeight || 1));
  const aspectRatio = width / Math.max(height, 1);
  const maxPixels = width < 900 ? 92_000 : 132_000;
  const renderHeight = clamp(Math.round(Math.sqrt(maxPixels / Math.max(aspectRatio, 0.55))), 200, 320);
  const renderWidth = clamp(Math.round(renderHeight * aspectRatio), 180, 540);
  const devicePixelRatio = Math.min(window.devicePixelRatio || 1, 1.25);
  const displayWidth = Math.round(width * devicePixelRatio);
  const displayHeight = Math.round(height * devicePixelRatio);

  if (renderState.displayWidth === displayWidth && renderState.displayHeight === displayHeight && renderState.renderWidth === renderWidth && renderState.renderHeight === renderHeight) {
    return;
  }

  renderState.displayWidth = displayWidth;
  renderState.displayHeight = displayHeight;
  renderState.renderWidth = renderWidth;
  renderState.renderHeight = renderHeight;
  renderState.imageData = renderState.offscreenContext.createImageData(renderWidth, renderHeight);

  canvas.value.width = displayWidth;
  canvas.value.height = displayHeight;
  renderState.offscreenCanvas.width = renderWidth;
  renderState.offscreenCanvas.height = renderHeight;

  if (renderState.displayContext) {
    renderState.displayContext.imageSmoothingEnabled = true;
    renderState.displayContext.imageSmoothingQuality = "high";
  }
}

function updateAudioResponse(deltaSeconds: number) {
  const volume = clamp(Number(sources.volume) || 0, 0, 1);
  const stream = clamp(Number(sources.stream) || 0, 0, 1);
  const analyserResult = sampleRawAnalyserLevel(audioSystem.getAnalyserNode(), audio.analyserBuffer);
  const rawDb = rawLevelToDecibels(analyserResult.level, RAW_AUDIO_NOISE_FLOOR_DB);
  const rawEnergy = clamp((rawDb - RAW_AUDIO_NOISE_FLOOR_DB) / 42, 0, 1);
  const feature = Math.max(volume * 0.72 + rawEnergy * 0.28, rawEnergy * 0.82);

  audio.analyserBuffer = analyserResult.buffer;
  audio.stream = stream;
  audio.loudness = volume;

  const fastAlpha = 1 - Math.exp(-deltaSeconds * 8);
  const slowAlpha = 1 - Math.exp(-deltaSeconds * 1.6);

  audio.fastEnergy += (feature - audio.fastEnergy) * fastAlpha;
  audio.slowEnergy += (feature - audio.slowEnergy) * slowAlpha;

  // Fast-vs-slow energy gives us change sensitivity, so steady loud passages stay graceful
  // while fresh motion in the music gets the stronger zoom and palette response.
  const novelty = Math.max(0, audio.fastEnergy - audio.slowEnergy);
  audio.noveltyHistory.push(novelty);
  if (audio.noveltyHistory.length > 48) {
    audio.noveltyHistory.splice(0, audio.noveltyHistory.length - 48);
  }

  const noveltyMean =
    audio.noveltyHistory.length > 0
      ? audio.noveltyHistory.reduce((sum, value) => sum + value, 0) / audio.noveltyHistory.length
      : novelty;
  const noveltyDeviation =
    audio.noveltyHistory.length > 1
      ? Math.sqrt(
          audio.noveltyHistory.reduce((sum, value) => sum + Math.pow(value - noveltyMean, 2), 0) / audio.noveltyHistory.length
        )
      : noveltyMean;
  const noveltyZScore = Math.max(0, (novelty - noveltyMean) / Math.max(noveltyDeviation, 0.014));
  const noveltyResponse = 1 - Math.exp(-2.4 * noveltyZScore);
  const surge = Math.max(0, feature - audio.previousFeature);
  const reactivity = clamp(0.5 + ((strength.value - 0.35) / 1) * 0.95, 0.5, 1.45);

  audio.previousFeature = feature;
  audio.novelty = noveltyResponse;
  audio.noveltySmoothed = damp(audio.noveltySmoothed, noveltyResponse, 4.6, deltaSeconds);
  audio.surge = damp(audio.surge, surge, 7.4, deltaSeconds);
  audio.ambient = damp(audio.ambient, clamp(0.16 + audio.slowEnergy * 0.52 + stream * 0.22, 0.16, 1), 2.1, deltaSeconds);
  audio.zoom = damp(
    audio.zoom,
    clamp(0.14 + audio.ambient * 0.16 + (audio.noveltySmoothed * 0.82 + audio.surge * 2.6) * reactivity, 0.12, 1.45),
    3.6,
    deltaSeconds
  );
  audio.bend = damp(
    audio.bend,
    clamp(0.18 + stream * 0.32 + (audio.noveltySmoothed * 0.72 + audio.surge * 1.9) * reactivity, 0.16, 1.3),
    3.1,
    deltaSeconds
  );
  audio.palette = damp(
    audio.palette,
    clamp(0.2 + stream * 0.44 + audio.noveltySmoothed * 0.6 * reactivity, 0.18, 1.25),
    2.3,
    deltaSeconds
  );
}

function updateTraversal(deltaSeconds: number) {
  const reactivity = clamp(0.5 + ((strength.value - 0.35) / 1) * 0.95, 0.5, 1.45);
  const baseSpeed = 0.94 + audio.ambient * 0.12;
  const speedTarget = baseSpeed + audio.zoom * 0.16 * reactivity;

  traversal.pathSpeed = damp(traversal.pathSpeed, speedTarget, 2.6, deltaSeconds);
  traversal.progress += (deltaSeconds / traversal.segmentDuration) * traversal.pathSpeed;
  traversal.bendPhase += deltaSeconds * (0.34 + audio.bend * 0.45);
  traversal.driftPhase += deltaSeconds * (0.22 + audio.ambient * 0.36);
  traversal.palettePhase = (traversal.palettePhase + deltaSeconds * (0.016 + audio.palette * 0.028)) % 1;

  while (traversal.progress >= 1) {
    advanceSegment();
  }

  const from = family.guidePoints[traversal.currentIndex];
  const to = family.guidePoints[traversal.nextIndex];
  const easedPath = smoothStep(traversal.progress);
  const zoomProgress = clamp(traversal.progress + audio.zoom * 0.08 * reactivity * (1 - traversal.progress), 0, 1);
  const easedZoom = smoothStep(zoomProgress);
  const directionX = to.center.x - from.center.x;
  const directionY = to.center.y - from.center.y;
  const directionLength = Math.hypot(directionX, directionY);
  const fallbackAngle = traversal.segmentSeed * 1.13;
  const unitX = directionLength > 0.000001 ? directionX / directionLength : Math.cos(fallbackAngle);
  const unitY = directionLength > 0.000001 ? directionY / directionLength : Math.sin(fallbackAngle);
  const normalX = -unitY;
  const normalY = unitX;
  const zoomDistance = Math.abs(Math.log(Math.max(from.scale, 0.000001) / Math.max(to.scale, 0.000001)));
  const segmentSpan = Math.max(directionLength, (from.scale + to.scale) * (0.62 + zoomDistance * 0.24));
  const bendLift =
    segmentSpan *
    ((from.bend + to.bend) * 0.5 + Math.sin(traversal.bendPhase + traversal.segmentSeed) * 0.06 * audio.bend * reactivity);
  const controlA = {
    x: from.center.x + unitX * segmentSpan * 0.34 + normalX * bendLift,
    y: from.center.y + unitY * segmentSpan * 0.34 + normalY * bendLift,
  };
  const controlB = {
    x: to.center.x - unitX * segmentSpan * 0.3 - normalX * bendLift * 0.86,
    y: to.center.y - unitY * segmentSpan * 0.3 - normalY * bendLift * 0.86,
  };
  const pathPoint = cubicBezierPoint(from.center, controlA, controlB, to.center, easedPath);
  const baseScale = Math.exp(lerp(Math.log(from.scale), Math.log(to.scale), easedZoom));
  const driftAmplitude = baseScale * (0.035 + audio.ambient * 0.022 + audio.bend * 0.018);
  const driftX = Math.cos(traversal.driftPhase + traversal.segmentSeed * 0.73) * driftAmplitude * 0.78;
  const driftY = Math.sin(traversal.driftPhase * 0.94 - traversal.segmentSeed * 0.41) * driftAmplitude * 0.55;
  const rotationTarget =
    lerp(from.rotation, to.rotation, easedPath) +
    Math.sin(traversal.bendPhase * 0.62 + traversal.segmentSeed) * (0.012 + audio.bend * 0.04);

  traversal.rotation = damp(traversal.rotation, rotationTarget, 2.5, deltaSeconds);
  traversal.camera = {
    center: {
      x: pathPoint.x + driftX,
      y: pathPoint.y + driftY,
    },
    scale: baseScale * (1 - audio.zoom * 0.04 * reactivity),
    rotation: traversal.rotation,
  };
}

function renderFractal() {
  if (!ensureContexts() || !renderState.displayContext || !renderState.offscreenCanvas || !renderState.offscreenContext || !renderState.imageData) {
    return;
  }

  const pixels = renderState.imageData.data;
  const width = renderState.renderWidth;
  const height = renderState.renderHeight;
  const aspectRatio = width / Math.max(height, 1);
  const cosRotation = Math.cos(traversal.camera.rotation);
  const sinRotation = Math.sin(traversal.camera.rotation);
  const maxIterations = family.getMaxIterations(traversal.camera.scale);
  const palettePhase = (traversal.palettePhase + family.guidePoints[traversal.currentIndex].hueOffset) % 1;
  const ambientLift = 0.05 + audio.ambient * 0.06;
  const paletteEnergy = 0.12 + audio.palette * 0.12;
  const sample = renderState.sample;

  for (let y = 0; y < height; y++) {
    const normalizedY = (y + 0.5) / height - 0.5;

    for (let x = 0; x < width; x++) {
      const normalizedX = (x + 0.5) / width - 0.5;
      const rotatedX = (normalizedX * aspectRatio * traversal.camera.scale) * cosRotation - (normalizedY * traversal.camera.scale) * sinRotation;
      const rotatedY = (normalizedX * aspectRatio * traversal.camera.scale) * sinRotation + (normalizedY * traversal.camera.scale) * cosRotation;

      family.sample(traversal.camera.center.x + rotatedX, traversal.camera.center.y + rotatedY, maxIterations, sample);

      const normalizedIteration = clamp(sample.smooth / maxIterations, 0, 1);
      const trapGlow = Math.exp(-sample.trap * (8.2 - audio.palette * 1.8));
      const paletteT = palettePhase + normalizedIteration * 0.82 + trapGlow * 0.16;
      const wave = Math.PI * 2;
      const redWave = 0.5 + 0.5 * Math.cos(wave * (paletteT + 0.02));
      const greenWave = 0.5 + 0.5 * Math.cos(wave * (paletteT + 0.21));
      const blueWave = 0.5 + 0.5 * Math.cos(wave * (paletteT + 0.47));
      const vignette = clamp(1.08 - (normalizedX * normalizedX + normalizedY * normalizedY) * 1.42, 0.68, 1.08);
      const pixelIndex = (y * width + x) * 4;

      if (!sample.escaped) {
        const interior = (0.018 + trapGlow * 0.12 + ambientLift * 0.8) * vignette;
        pixels[pixelIndex] = Math.min(255, interior * 26);
        pixels[pixelIndex + 1] = Math.min(255, interior * 36);
        pixels[pixelIndex + 2] = Math.min(255, interior * 58);
        pixels[pixelIndex + 3] = 255;
        continue;
      }

      const boundary = Math.pow(normalizedIteration, 1.16);
      const shimmer = 0.14 + paletteEnergy + trapGlow * 0.34;
      const brightness = (ambientLift + boundary * 0.66 + shimmer) * vignette;

      pixels[pixelIndex] = Math.min(255, (0.1 + redWave * 0.9) * brightness * 255);
      pixels[pixelIndex + 1] = Math.min(255, (0.08 + greenWave * 0.72) * brightness * 255);
      pixels[pixelIndex + 2] = Math.min(255, (0.18 + blueWave * 0.96) * brightness * 255);
      pixels[pixelIndex + 3] = 255;
    }
  }

  renderState.offscreenContext.putImageData(renderState.imageData, 0, 0);
  renderState.displayContext.clearRect(0, 0, renderState.displayWidth, renderState.displayHeight);
  renderState.displayContext.drawImage(renderState.offscreenCanvas, 0, 0, renderState.displayWidth, renderState.displayHeight);
}

function animate(now: number) {
  animationFrameId = window.requestAnimationFrame(animate);

  if (!visible.value || !canvas.value) {
    lastFrameTime = now;
    return;
  }

  updateRenderResolution();

  if (!lastFrameTime) {
    lastFrameTime = now;
  }

  const deltaSeconds = clamp((now - lastFrameTime) / 1000, 1 / 120, 0.08);
  lastFrameTime = now;

  updateAudioResponse(deltaSeconds);
  updateTraversal(deltaSeconds);

  if (now - lastRenderTime < renderIntervalMs) return;

  lastRenderTime = now;
  renderFractal();
}

watch(
  () => visible.value,
  (isVisible) => {
    if (!isVisible) {
      resetAudioState();
      lastFrameTime = 0;
      return;
    }

    resetTraversalState();
    resetAudioState();
    lastFrameTime = 0;
    lastRenderTime = 0;
  },
  { immediate: true }
);

watch(
  () => [viewport.width, viewport.height, canvas.value],
  () => {
    if (!visible.value) return;
    updateRenderResolution();
    renderFractal();
  }
);

watch(
  () => sources.source,
  () => {
    if (!visible.value) return;
    resetAudioState();
    lastFrameTime = 0;
  }
);

onMounted(() => {
  animationFrameId = window.requestAnimationFrame(animate);
});

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrameId);
});
</script>

<style lang="scss" scoped>
.traverse {
  @include position(fixed, 0 0 0 0, 2);
  overflow: hidden;
  pointer-events: none;
  background:
    radial-gradient(circle at 50% 50%, rgba(8, 11, 26, 0.06), rgba(2, 4, 12, 0.42) 100%),
    linear-gradient(180deg, rgba(4, 6, 12, 0.14), rgba(2, 4, 12, 0.34));
}

.canvas,
.wash,
.vignette {
  @include position(absolute, 0 0 0 0);
}

.canvas {
  width: 100%;
  height: 100%;
  display: block;
  filter: saturate(1.14) contrast(1.08) brightness(1.02);
  transform: scale(1.015);
}

.wash {
  opacity: 0.18;
  mix-blend-mode: screen;
}

.wash-a {
  background:
    radial-gradient(circle at 22% 28%, rgba(82, 194, 255, 0.2), transparent 34%),
    radial-gradient(circle at 72% 64%, rgba(255, 154, 104, 0.14), transparent 32%);
  animation: wash-a-drift 26s ease-in-out infinite;
}

.wash-b {
  background:
    radial-gradient(circle at 76% 22%, rgba(112, 152, 255, 0.14), transparent 32%),
    radial-gradient(circle at 36% 78%, rgba(116, 255, 216, 0.12), transparent 36%);
  animation: wash-b-drift 34s ease-in-out infinite reverse;
}

.vignette {
  background:
    radial-gradient(circle at 50% 50%, transparent 34%, rgba(4, 6, 14, 0.12) 68%, rgba(4, 6, 14, 0.52) 100%),
    linear-gradient(180deg, rgba(4, 6, 14, 0.18), transparent 24%, transparent 76%, rgba(4, 6, 14, 0.22));
}

@keyframes wash-a-drift {
  0% {
    transform: translate3d(-3%, -2%, 0) scale(1.02);
  }

  50% {
    transform: translate3d(3%, 2%, 0) scale(1.08);
  }

  100% {
    transform: translate3d(-3%, -2%, 0) scale(1.02);
  }
}

@keyframes wash-b-drift {
  0% {
    transform: translate3d(3%, -1%, 0) scale(1.04);
  }

  50% {
    transform: translate3d(-4%, 3%, 0) scale(1.1);
  }

  100% {
    transform: translate3d(3%, -1%, 0) scale(1.04);
  }
}
</style>
