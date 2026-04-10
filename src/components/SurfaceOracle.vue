<template>
  <Transition name="fade">
    <aside v-if="visible" class="surface-oracle">
      <canvas
        ref="canvas"
        class="canvas"
        aria-label="Surface Oracle interactive wavefield"
        @pointerdown="onPointerDown"
        @pointermove="onPointerMove"
        @pointerup="onPointerUp"
        @pointercancel="onPointerUp"
        @pointerleave="onPointerLeave"></canvas>
      <div class="wash wash-a"></div>
      <div class="wash wash-b"></div>
      <div class="vignette"></div>
    </aside>
  </Transition>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { AudioSource } from "@wearesage/shared";
import { HeightFieldSurface } from "../surface-oracle/height-field";
import type {
  SurfaceOracleClickMode,
  SurfaceOracleControls,
  SurfaceOracleDiagnosticsSnapshot,
  SurfaceOraclePointerSample,
  SurfaceOracleSimulationSnapshot,
} from "../surface-oracle/types";
import { useAudioFeatures } from "../stores/audio-features";
import { usePulse } from "../stores/pulse";
import { useSources } from "../stores/sources";
import { useSurfaceOracleStore } from "../stores/surface-oracle";
import { useVisualizerSettings } from "../stores/visualizer-settings";

const DIAGNOSTIC_INTERVAL_MS = 125;

const canvas = ref<HTMLCanvasElement | null>(null);
const settings = useVisualizerSettings();
const sources = useSources();
const pulse = usePulse();
const audioFeatures = useAudioFeatures();
const surfaceOracle = useSurfaceOracleStore();
const visible = computed(() => settings.visualizationMode === "surface-oracle");

const surface = new HeightFieldSurface();
const imageData = ref<ImageData | null>(null);
const lastFrameAt = ref<number | null>(null);
const animationFrame = ref<number | null>(null);
const lastDiagnosticsAt = ref(0);
const fps = ref(0);
const isPointerDown = ref(false);
const pointer = ref<SurfaceOraclePointerSample>({
  x: 0,
  y: 0,
  inside: false,
});
const lastDragInjection = ref<{ x: number; y: number } | null>(null);
const lastPulseEnvelope = ref(0);
const lastPulseTriggerAt = ref(0);
const lastNoveltyTriggerAt = ref(0);
const autoPhase = ref(0);
const dimensions = ref({
  width: 0,
  height: 0,
});

let offscreenCanvas: HTMLCanvasElement | null = null;
let offscreenContext: CanvasRenderingContext2D | null = null;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function lerp(min: number, max: number, value: number) {
  return min + (max - min) * value;
}

function clamp255(value: number) {
  return Math.max(0, Math.min(255, Math.round(value)));
}

function getBaseControls(): SurfaceOracleControls {
  return surfaceOracle.controls;
}

function getAudioReactiveControls(baseControls: SurfaceOracleControls) {
  const features = audioFeatures.features;
  const pulseConfidence = clamp(pulse.confidence, 0, 1);
  const pulseImpact = clamp(pulse.impact * pulseConfidence, 0, 1.4);
  const looseness = 1 - pulseConfidence;
  const stream = clamp(Number(sources.stream) || 0, 0, 1);
  const novelty = Math.max(features.novelty, features.spectralFlux);

  return {
    amplitude: clamp(baseControls.amplitude * (0.88 + features.energy * 0.28 + features.bass * 0.32 + pulseImpact * 0.54 + stream * 0.12), 0.15, 3),
    radius: clamp(baseControls.radius * (0.9 + features.bass * 0.66 + features.lowMid * 0.18 + stream * 0.08), 12, 220),
    damping: clamp(baseControls.damping + looseness * 0.006 - features.energy * 0.002, 0.005, 0.06),
    propagationSpeed: clamp(
      baseControls.propagationSpeed + features.energy * 0.045 + features.centroid * 0.018 + pulse.anticipation * pulseConfidence * 0.02,
      0.08,
      0.4
    ),
    viscosity: clamp(baseControls.viscosity + looseness * 0.03 + features.centroid * 0.045 - features.bass * 0.02, 0, 0.3),
    sourceFrequency: clamp(baseControls.sourceFrequency * (0.92 + features.centroid * 0.26 + features.high * 0.18), 0.15, 2.5),
    emitterStrength: clamp(baseControls.emitterStrength * (0.92 + pulseImpact * 0.26 + novelty * 0.22 + stream * 0.08), 0.1, 2.2),
  };
}

function injectImpulse(x: number, y: number, amplitudeScale = 1, radiusScale = 1) {
  const controls = getBaseControls();
  surface.injectAtPixel(x, y, {
    amplitude: controls.amplitude * amplitudeScale,
    radius: controls.radius * radiusScale,
  });
}

function updateDiagnostics() {
  const snapshot: SurfaceOracleDiagnosticsSnapshot = {
    fps: fps.value,
    gridWidth: surface.getCols(),
    gridHeight: surface.getRows(),
    cellSize: surface.getCellSize(),
    pointer: pointer.value,
    emitterCount: surface.getEmitterCount(),
  };

  surfaceOracle.updateDiagnostics(snapshot);
}

function drawBackdrop(
  ctx: CanvasRenderingContext2D,
  width: number,
  height: number,
  cellSize: number
) {
  const features = audioFeatures.features;
  const pulseConfidence = clamp(pulse.confidence, 0, 1);
  const stream = clamp(Number(sources.stream) || 0, 0, 1);
  const hue = 196 + features.centroid * 26 - features.bandImbalance * 10 + pulseConfidence * 8;
  const bloomAlpha = 0.1 + features.energy * 0.12 + pulseConfidence * 0.08 + stream * 0.04;

  const sky = ctx.createLinearGradient(0, 0, 0, height);
  sky.addColorStop(0, `hsla(${hue}, 56%, 11%, 1)`);
  sky.addColorStop(0.58, `hsla(${hue - 10}, 44%, 6%, 1)`);
  sky.addColorStop(1, `hsla(${hue - 20}, 38%, 3%, 1)`);

  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, width, height);

  const bloom = ctx.createRadialGradient(width * 0.5, height * 0.42, 0, width * 0.5, height * 0.42, width * 0.58);
  bloom.addColorStop(0, `hsla(${hue + 4}, 84%, 68%, ${bloomAlpha.toFixed(3)})`);
  bloom.addColorStop(1, `hsla(${hue + 8}, 84%, 68%, 0)`);
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, width, height);

  const step = Math.max(cellSize * 10, 48);
  ctx.save();
  ctx.strokeStyle = `hsla(${hue + 6}, 88%, 78%, ${0.032 + features.energy * 0.026})`;
  ctx.lineWidth = 1;

  for (let x = step; x < width; x += step) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, height);
    ctx.stroke();
  }

  for (let y = step; y < height; y += step) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(width, y);
    ctx.stroke();
  }

  ctx.strokeStyle = `hsla(${hue + 12}, 92%, 84%, ${0.06 + pulseConfidence * 0.06})`;
  ctx.beginPath();
  ctx.moveTo(width * 0.5, 0);
  ctx.lineTo(width * 0.5, height);
  ctx.moveTo(0, height * 0.5);
  ctx.lineTo(width, height * 0.5);
  ctx.stroke();
  ctx.restore();
}

function paintHeightField(
  targetContext: CanvasRenderingContext2D,
  targetImageData: ImageData,
  snapshot: SurfaceOracleSimulationSnapshot
) {
  const features = audioFeatures.features;
  const pulseGlow = clamp(pulse.impact * pulse.confidence + pulse.anticipation * pulse.confidence * 0.4, 0, 1.4);
  const data = targetImageData.data;
  const { height, cols, rows } = snapshot;
  const warmth = features.bass * 0.28 + features.energy * 0.22;
  const highShimmer = features.high * 0.24 + features.air * 0.18;

  for (let y = 0; y < rows; y += 1) {
    const rowOffset = y * cols;

    for (let x = 0; x < cols; x += 1) {
      const index = rowOffset + x;
      const west = x > 0 ? height[index - 1] : height[index];
      const east = x + 1 < cols ? height[index + 1] : height[index];
      const north = y > 0 ? height[index - cols] : height[index];
      const south = y + 1 < rows ? height[index + cols] : height[index];
      const current = height[index];

      const slope = Math.abs(east - west) + Math.abs(south - north);
      const curvature = Math.abs((west + east + north + south) * 0.25 - current);
      const crest = Math.max(0, current);
      const trough = Math.max(0, -current);
      const bandEnergy = Math.min(1.7, slope * 0.62 + curvature * 1.72 + Math.abs(current) * 0.28);
      const luminance = 0.14 + Math.pow(0.1 + bandEnergy, 0.76);
      const edgeGlow = Math.min(1.3, Math.pow(Math.min(1.5, slope * 0.92 + curvature * 1.3), 0.86));

      const pixel = index * 4;
      data[pixel] = clamp255(10 + luminance * 56 + edgeGlow * 18 + crest * 24 + warmth * 40 + trough * 8);
      data[pixel + 1] = clamp255(22 + luminance * 106 + edgeGlow * 28 + crest * 34 + pulseGlow * 20);
      data[pixel + 2] = clamp255(46 + luminance * 148 + edgeGlow * 48 + crest * 42 + highShimmer * 36 + pulseGlow * 16);
      data[pixel + 3] = clamp255(154 + luminance * 90 + edgeGlow * 18 + pulseGlow * 10);
    }
  }

  targetContext.putImageData(targetImageData, 0, 0);
}

function drawReticle(
  ctx: CanvasRenderingContext2D,
  pointerSample: SurfaceOraclePointerSample,
  radius: number,
  clickMode: SurfaceOracleClickMode
) {
  if (!pointerSample.inside) return;

  const displayRadius = Math.max(18, radius * 0.55);
  const stroke = clickMode === "emitter" ? "rgba(255, 214, 180, 0.5)" : "rgba(196, 243, 255, 0.42)";

  ctx.save();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1.15;
  ctx.beginPath();
  ctx.arc(pointerSample.x, pointerSample.y, displayRadius, 0, Math.PI * 2);
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(pointerSample.x - displayRadius - 10, pointerSample.y);
  ctx.lineTo(pointerSample.x - displayRadius + 2, pointerSample.y);
  ctx.moveTo(pointerSample.x + displayRadius - 2, pointerSample.y);
  ctx.lineTo(pointerSample.x + displayRadius + 10, pointerSample.y);
  ctx.moveTo(pointerSample.x, pointerSample.y - displayRadius - 10);
  ctx.lineTo(pointerSample.x, pointerSample.y - displayRadius + 2);
  ctx.moveTo(pointerSample.x, pointerSample.y + displayRadius - 2);
  ctx.lineTo(pointerSample.x, pointerSample.y + displayRadius + 10);
  ctx.stroke();
  ctx.restore();
}

function drawEmitters(
  ctx: CanvasRenderingContext2D,
  emitters: readonly { x: number; y: number }[],
  timeSeconds: number,
  frequency: number
) {
  if (emitters.length === 0) return;

  const pulseAmount = 0.5 + 0.5 * Math.sin(timeSeconds * frequency * Math.PI * 2);
  const features = audioFeatures.features;

  ctx.save();

  for (const emitter of emitters) {
    const pulseRadius = 7 + pulseAmount * 9 + features.energy * 3;
    ctx.strokeStyle = `rgba(113, 214, 255, ${0.48 + pulseAmount * 0.22})`;
    ctx.fillStyle = "rgba(202, 244, 255, 0.92)";
    ctx.lineWidth = 1.35;

    ctx.beginPath();
    ctx.arc(emitter.x, emitter.y, pulseRadius, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(emitter.x, emitter.y, 3.25, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.restore();
}

function toCanvasCoordinates(event: PointerEvent) {
  const element = canvas.value;
  if (!element) return { x: 0, y: 0 };

  const rect = element.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
  };
}

function handleAudioInteractions(time: number, deltaSeconds: number, controls: SurfaceOracleControls) {
  if (sources.source === null || sources.source === AudioSource.NONE) {
    lastPulseEnvelope.value = 0;
    return;
  }

  const { width, height } = dimensions.value;
  if (!width || !height) return;

  const features = audioFeatures.features;
  const stability = clamp(pulse.confidence, 0, 1);
  const looseness = 1 - stability;
  const pulseEnvelope = clamp(pulse.impact * (0.54 + stability * 0.46), 0, 1.4);
  const novelty = clamp(Math.max(features.novelty, features.spectralFlux), 0, 1);
  const centerX = width * 0.5;
  const centerY = height * 0.5;

  autoPhase.value += deltaSeconds * (0.38 + features.energy * 0.94 + features.centroid * 0.48 + looseness * 0.28);
  const orbitRadius = Math.min(width, height) * (0.06 + looseness * 0.1 + features.centroid * 0.05);
  const orbitX = centerX + Math.cos(autoPhase.value + features.bandImbalance * 0.8) * orbitRadius;
  const orbitY = centerY + Math.sin(autoPhase.value * 1.18 + features.air * 0.4) * orbitRadius * (0.62 + looseness * 0.4);

  if (pulseEnvelope > 0.56 && lastPulseEnvelope.value <= 0.34 && time - lastPulseTriggerAt.value > 180) {
    lastPulseTriggerAt.value = time;
    surface.injectAtPixel(orbitX, orbitY, {
      amplitude: controls.amplitude * (0.6 + features.bass * 0.74 + pulseEnvelope * 0.7),
      radius: controls.radius * (0.88 + features.bass * 0.62 + features.energy * 0.16),
    });

    if (features.energy > 0.44 || pulse.anticipation * stability > 0.42) {
      surface.injectAtPixel(centerX - (orbitX - centerX) * 0.4, centerY - (orbitY - centerY) * 0.4, {
        amplitude: controls.amplitude * (0.24 + features.lowMid * 0.34 + pulseEnvelope * 0.18),
        radius: controls.radius * 0.72,
      });
    }
  }

  const noveltyCooldownMs = lerp(980, 260, novelty);
  if (novelty > 0.62 && time - lastNoveltyTriggerAt.value > noveltyCooldownMs) {
    lastNoveltyTriggerAt.value = time;

    const spread = Math.min(width, height) * (0.12 + looseness * 0.18 + features.bandImbalance * 0.04);
    const splashAngle = autoPhase.value * 1.7 + novelty * Math.PI + features.high * 0.45;
    const splashX = clamp(centerX + Math.cos(splashAngle) * spread + Math.sin(autoPhase.value * 0.76) * spread * 0.18, 24, width - 24);
    const splashY = clamp(centerY + Math.sin(splashAngle * 1.14) * spread * 0.7, 24, height - 24);

    surface.injectAtPixel(splashX, splashY, {
      amplitude: controls.amplitude * (0.22 + novelty * 0.52 + features.high * 0.16),
      radius: controls.radius * (0.56 + features.lowMid * 0.26 + looseness * 0.18),
    });
  }

  lastPulseEnvelope.value = pulseEnvelope;
}

function renderFrame(time: number) {
  const element = canvas.value;
  if (!element || !offscreenCanvas || !offscreenContext) {
    animationFrame.value = window.requestAnimationFrame(renderFrame);
    return;
  }

  const context = element.getContext("2d");
  if (!context) {
    animationFrame.value = window.requestAnimationFrame(renderFrame);
    return;
  }

  const previousTime = lastFrameAt.value ?? time;
  const deltaSeconds = Math.min((time - previousTime) / 1000, 0.05);
  lastFrameAt.value = time;

  if (!visible.value) {
    animationFrame.value = window.requestAnimationFrame(renderFrame);
    return;
  }

  const instantaneousFps = deltaSeconds > 0 ? 1 / deltaSeconds : 0;
  fps.value = fps.value === 0 ? instantaneousFps : fps.value * 0.88 + instantaneousFps * 0.12;

  audioFeatures.update(deltaSeconds || 1 / 60);

  const controls = getAudioReactiveControls(getBaseControls());
  if (!surfaceOracle.paused) {
    handleAudioInteractions(time, deltaSeconds || 1 / 60, controls);
    surface.step(deltaSeconds || 1 / 60, controls);
  }

  const { width, height } = dimensions.value;
  const snapshot = surface.getSnapshot();

  if (imageData.value) {
    drawBackdrop(context, width, height, snapshot.cellSize);
    paintHeightField(offscreenContext, imageData.value, snapshot);

    context.save();
    context.globalCompositeOperation = "screen";
    context.globalAlpha = 0.98;
    context.imageSmoothingEnabled = true;
    context.drawImage(offscreenCanvas, 0, 0, width, height);
    context.restore();

    drawEmitters(context, snapshot.emitters, snapshot.timeSeconds, controls.sourceFrequency);
    drawReticle(context, pointer.value, controls.radius, surfaceOracle.clickMode);
  }

  if (time - lastDiagnosticsAt.value > DIAGNOSTIC_INTERVAL_MS) {
    lastDiagnosticsAt.value = time;
    updateDiagnostics();
  }

  animationFrame.value = window.requestAnimationFrame(renderFrame);
}

function resizeCanvas() {
  const element = canvas.value;
  if (!element || !offscreenCanvas || !offscreenContext) return;

  const width = window.innerWidth;
  const height = window.innerHeight;
  const dpr = window.devicePixelRatio || 1;

  dimensions.value = { width, height };
  element.width = Math.floor(width * dpr);
  element.height = Math.floor(height * dpr);
  element.style.width = `${width}px`;
  element.style.height = `${height}px`;

  const context = element.getContext("2d");
  if (context) {
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  surface.resize(width, height);
  offscreenCanvas.width = surface.getCols();
  offscreenCanvas.height = surface.getRows();
  imageData.value = offscreenContext.createImageData(offscreenCanvas.width, offscreenCanvas.height);
  updateDiagnostics();
}

function onPointerDown(event: PointerEvent) {
  const point = toCanvasCoordinates(event);
  pointer.value = { ...point, inside: true };

  if (surfaceOracle.clickMode === "emitter") {
    isPointerDown.value = false;
    lastDragInjection.value = null;
    surface.toggleEmitterAtPixel(point.x, point.y, Math.max(18, getBaseControls().radius * 0.35));
    updateDiagnostics();
    return;
  }

  isPointerDown.value = true;
  lastDragInjection.value = point;

  const target = event.currentTarget as HTMLCanvasElement;
  target.setPointerCapture(event.pointerId);
  injectImpulse(point.x, point.y, 1, 1);
}

function onPointerMove(event: PointerEvent) {
  const point = toCanvasCoordinates(event);
  pointer.value = { ...point, inside: true };

  if (surfaceOracle.clickMode === "emitter" || !isPointerDown.value) {
    return;
  }

  const previous = lastDragInjection.value;
  const minimumDistance = Math.max(10, getBaseControls().radius * 0.28);

  if (!previous) {
    lastDragInjection.value = point;
    injectImpulse(point.x, point.y, 0.4, 0.92);
    return;
  }

  const distance = Math.hypot(point.x - previous.x, point.y - previous.y);
  if (distance >= minimumDistance) {
    lastDragInjection.value = point;
    injectImpulse(point.x, point.y, 0.4, 0.92);
  }
}

function onPointerUp(event: PointerEvent) {
  isPointerDown.value = false;
  lastDragInjection.value = null;
  pointer.value = {
    ...toCanvasCoordinates(event),
    inside: true,
  };

  const target = event.currentTarget as HTMLCanvasElement;
  if (target.hasPointerCapture(event.pointerId)) {
    target.releasePointerCapture(event.pointerId);
  }
}

function onPointerLeave() {
  isPointerDown.value = false;
  lastDragInjection.value = null;
  pointer.value = { ...pointer.value, inside: false };
}

watch(
  () => surfaceOracle.resetToken,
  () => {
    surface.reset({ clearEmitters: true });
    updateDiagnostics();
  }
);

watch(visible, nextVisible => {
  if (!nextVisible) return;
  lastFrameAt.value = null;
  resizeCanvas();
});

onMounted(() => {
  offscreenCanvas = document.createElement("canvas");
  offscreenContext = offscreenCanvas.getContext("2d");

  if (!offscreenContext) return;

  resizeCanvas();
  animationFrame.value = window.requestAnimationFrame(renderFrame);
  window.addEventListener("resize", resizeCanvas);
});

onBeforeUnmount(() => {
  window.removeEventListener("resize", resizeCanvas);

  if (animationFrame.value !== null) {
    window.cancelAnimationFrame(animationFrame.value);
  }
});
</script>

<style lang="scss" scoped>
.surface-oracle {
  @include position(fixed, 0 0 null null, 0);
  @include size(100%);
  overflow: hidden;
  pointer-events: none;
}

.canvas,
.wash,
.vignette {
  @include position(absolute, 0 0 null null);
  @include size(100%);
}

.canvas {
  pointer-events: auto;
  touch-action: none;
}

.wash {
  pointer-events: none;
  mix-blend-mode: screen;
  opacity: 0.55;
}

.wash-a {
  background:
    radial-gradient(circle at 18% 18%, rgba(113, 214, 255, 0.11), transparent 34%),
    radial-gradient(circle at 82% 28%, rgba(255, 216, 171, 0.08), transparent 30%);
}

.wash-b {
  background:
    radial-gradient(circle at 50% 72%, rgba(164, 236, 255, 0.08), transparent 38%),
    linear-gradient(180deg, transparent, rgba(3, 8, 16, 0.26));
}

.vignette {
  pointer-events: none;
  background:
    radial-gradient(circle at center, transparent 48%, rgba(2, 5, 9, 0.18) 78%, rgba(0, 0, 0, 0.42) 100%);
}
</style>
