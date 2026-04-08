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

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;

void main() {
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRAGMENT_SHADER_SOURCE = `
precision highp float;
precision highp int;

uniform vec2 uResolution;
uniform vec2 uCenter;
uniform float uScale;
uniform float uRotation;
uniform float uAspect;
uniform float uPalettePhase;
uniform float uAmbientLift;
uniform float uPaletteEnergy;
uniform float uStableAA;
uniform int uMaxIterations;

const int MAX_ITERATIONS = 720;
const float TAU = 6.28318530718;

struct FractalSample {
  float escaped;
  float smoothValue;
  float trap;
};

FractalSample sampleMandelbrot(vec2 c) {
  vec2 z = vec2(0.0);
  float trap = 1000000.0;
  float smoothValue = float(uMaxIterations);
  float escaped = 0.0;

  for (int i = 0; i < MAX_ITERATIONS; i++) {
    if (i >= uMaxIterations) {
      break;
    }

    z = vec2(z.x * z.x - z.y * z.y + c.x, 2.0 * z.x * z.y + c.y);
    float radiusSquared = dot(z, z);
    trap = min(trap, min(abs(z.x * z.y), abs(z.x) + abs(z.y) * 0.35));

    if (radiusSquared > 16.0) {
      float radius = sqrt(radiusSquared);
      smoothValue = float(i) + 1.0 - log2(max(log2(max(radius, 4.0)), 0.0001));
      escaped = 1.0;
      break;
    }
  }

  FractalSample result;
  result.escaped = escaped;
  result.smoothValue = smoothValue;
  result.trap = trap;
  return result;
}

vec3 colorize(FractalSample sample, vec2 uv) {
  float normalized = clamp(sample.smoothValue / float(uMaxIterations), 0.0, 1.0);
  float trapGlow = exp(-sample.trap * (8.8 - uPaletteEnergy * 2.2));
  float paletteT = uPalettePhase + normalized * 0.86 + trapGlow * 0.18;
  vec3 wave = 0.5 + 0.5 * cos(TAU * (paletteT + vec3(0.02, 0.22, 0.47)));
  float vignette = clamp(1.08 - dot(uv, uv) * 1.42, 0.68, 1.08);

  if (sample.escaped < 0.5) {
    float interior = (0.02 + trapGlow * 0.14 + uAmbientLift * 0.82) * vignette;
    return pow(vec3(interior * 0.11, interior * 0.16, interior * 0.27), vec3(0.96));
  }

  float boundary = pow(normalized, 1.18);
  float shimmer = 0.16 + uPaletteEnergy + trapGlow * 0.36;
  float brightness = (uAmbientLift + boundary * 0.68 + shimmer) * vignette;
  vec3 color = vec3(0.1 + wave.r * 0.9, 0.08 + wave.g * 0.72, 0.18 + wave.b * 0.96) * brightness;
  return pow(color, vec3(0.94));
}

vec3 samplePixel(vec2 fragCoord) {
  vec2 centered = fragCoord / uResolution - 0.5;
  vec2 paletteUv = vec2(centered.x, centered.y);
  centered.x *= uAspect;

  float cosRotation = cos(uRotation);
  float sinRotation = sin(uRotation);
  vec2 rotated = vec2(
    centered.x * cosRotation - centered.y * sinRotation,
    centered.x * sinRotation + centered.y * cosRotation
  ) * uScale;

  FractalSample sample = sampleMandelbrot(uCenter + rotated);
  return colorize(sample, paletteUv);
}

void main() {
  vec2 frag = gl_FragCoord.xy;
  vec3 color = 0.5 * (
    samplePixel(frag + vec2(-0.25, 0.25)) +
    samplePixel(frag + vec2(0.25, -0.25))
  );

  if (uStableAA > 0.01) {
    vec3 refined = 0.25 * (
      samplePixel(frag + vec2(-0.38, -0.12)) +
      samplePixel(frag + vec2(0.12, 0.38)) +
      samplePixel(frag + vec2(0.38, -0.28)) +
      samplePixel(frag + vec2(-0.12, 0.28))
    );
    color = mix(color, refined, uStableAA);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

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
  getMaxIterations: (scale: number, qualityBias?: number) => number;
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
  bendPhase: number;
  driftPhase: number;
  palettePhase: number;
  segmentSeed: number;
  desiredCamera: FractalViewport;
  camera: FractalViewport;
};

type InterestMetrics = {
  center: ComplexPoint;
  scale: number;
  score: number;
  boundaryDensity: number;
  variation: number;
  mixedness: number;
  trapDetail: number;
};

type InterestState = {
  focusTargetOffset: ComplexPoint;
  focusOffset: ComplexPoint;
  focusTargetScore: number;
  focusTargetHoldUntil: number;
  desiredZoomGovernor: number;
  zoomGovernor: number;
  desiredZoomPermission: number;
  zoomPermission: number;
  desiredCurrentScore: number;
  currentScore: number;
  desiredBestScore: number;
  bestScore: number;
  lowInterestTime: number;
  searchPhase: number;
  lastEvaluationAt: number;
};

type GLUniforms = {
  resolution: WebGLUniformLocation | null;
  center: WebGLUniformLocation | null;
  scale: WebGLUniformLocation | null;
  rotation: WebGLUniformLocation | null;
  aspect: WebGLUniformLocation | null;
  palettePhase: WebGLUniformLocation | null;
  ambientLift: WebGLUniformLocation | null;
  paletteEnergy: WebGLUniformLocation | null;
  stableAA: WebGLUniformLocation | null;
  maxIterations: WebGLUniformLocation | null;
};

type RenderState = {
  canvas: HTMLCanvasElement | null;
  gl: WebGLRenderingContext | null;
  program: WebGLProgram | null;
  buffer: WebGLBuffer | null;
  uniforms: GLUniforms | null;
  displayWidth: number;
  displayHeight: number;
  dpr: number;
  lastCamera: FractalViewport | null;
  motion: number;
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

function cubicBezierTangent(start: ComplexPoint, controlA: ComplexPoint, controlB: ComplexPoint, end: ComplexPoint, amount: number) {
  const inverse = 1 - amount;

  return {
    x:
      3 * inverse * inverse * (controlA.x - start.x) +
      6 * inverse * amount * (controlB.x - controlA.x) +
      3 * amount * amount * (end.x - controlB.x),
    y:
      3 * inverse * inverse * (controlA.y - start.y) +
      6 * inverse * amount * (controlB.y - controlA.y) +
      3 * amount * amount * (end.y - controlB.y),
  };
}

function angleDelta(a: number, b: number) {
  let delta = a - b;

  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;

  return delta;
}

function dampAngle(current: number, target: number, smoothing: number, deltaSeconds: number) {
  return current + angleDelta(target, current) * (1 - Math.exp(-smoothing * deltaSeconds));
}

function clampVectorMagnitude(point: ComplexPoint, maxMagnitude: number) {
  const magnitude = Math.hypot(point.x, point.y);

  if (magnitude <= maxMagnitude || magnitude === 0) {
    return point;
  }

  const scale = maxMagnitude / magnitude;
  return {
    x: point.x * scale,
    y: point.y * scale,
  };
}

function copyViewport(camera: FractalViewport): FractalViewport {
  return {
    center: {
      x: camera.center.x,
      y: camera.center.y,
    },
    scale: camera.scale,
    rotation: camera.rotation,
  };
}

function createMandelbrotFamily(): FractalFamily {
  // These guide points keep the macro-travel curated while the local interest scan
  // pulls the camera onto nearby boundary-rich structure.
  const guidePoints: FractalWaypoint[] = [
    { center: { x: -0.5, y: 0 }, scale: 2.35, bend: 0.12, rotation: -0.02, hueOffset: 0.02 },
    { center: { x: -0.785, y: 0.125 }, scale: 0.52, bend: 0.18, rotation: 0.03, hueOffset: 0.14 },
    { center: { x: -0.743643887, y: 0.131825904 }, scale: 0.16, bend: -0.16, rotation: 0.06, hueOffset: 0.24 },
    { center: { x: -0.744935, y: 0.13419 }, scale: 0.038, bend: 0.24, rotation: 0.09, hueOffset: 0.36 },
    { center: { x: -0.5, y: 0 }, scale: 1.38, bend: -0.06, rotation: -0.03, hueOffset: 0.48 },
    { center: { x: -1.25066, y: 0.02012 }, scale: 0.18, bend: 0.16, rotation: 0.04, hueOffset: 0.6 },
    { center: { x: -1.76878, y: 0.00174 }, scale: 0.34, bend: -0.18, rotation: -0.05, hueOffset: 0.68 },
    { center: { x: -0.5, y: 0 }, scale: 1.18, bend: 0.1, rotation: 0.01, hueOffset: 0.78 },
    { center: { x: -0.15894, y: 1.03419 }, scale: 0.24, bend: 0.18, rotation: 0.05, hueOffset: 0.86 },
    { center: { x: -0.7412, y: 0.1587 }, scale: 0.12, bend: -0.16, rotation: 0.08, hueOffset: 0.94 },
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
    getMaxIterations(scale: number, qualityBias = 0) {
      const zoomDepth = Math.max(0, Math.log2(2.35 / Math.max(scale, 0.000001)));
      return clamp(Math.round(170 + zoomDepth * 92 + qualityBias * 72), 170, 640);
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

function createTraversalState(fractalFamily: FractalFamily): TraversalState {
  const camera = fractalFamily.getStartViewport();
  return {
    currentIndex: 0,
    nextIndex: 1,
    progress: 0,
    segmentDuration: calculateSegmentDuration(fractalFamily.guidePoints[0], fractalFamily.guidePoints[1]),
    pathSpeed: 1,
    bendPhase: 0,
    driftPhase: 0,
    palettePhase: fractalFamily.guidePoints[0].hueOffset,
    segmentSeed: 0.37,
    desiredCamera: copyViewport(camera),
    camera,
  };
}

function createInterestState(): InterestState {
  return {
    focusTargetOffset: { x: 0, y: 0 },
    focusOffset: { x: 0, y: 0 },
    focusTargetScore: 0.8,
    focusTargetHoldUntil: 0,
    desiredZoomGovernor: 1,
    zoomGovernor: 1,
    desiredZoomPermission: 1,
    zoomPermission: 1,
    desiredCurrentScore: 0.8,
    currentScore: 0.8,
    desiredBestScore: 0.8,
    bestScore: 0.8,
    lowInterestTime: 0,
    searchPhase: 0.23,
    lastEvaluationAt: 0,
  };
}

const family = createMandelbrotFamily();
const renderState: RenderState = {
  canvas: null,
  gl: null,
  program: null,
  buffer: null,
  uniforms: null,
  displayWidth: 0,
  displayHeight: 0,
  dpr: 1,
  lastCamera: null,
  motion: 0,
};

const audio = createAudioState();
const traversal = createTraversalState(family);
const interest = createInterestState();
const reusableInterestSample: MutableFractalSample = {
  escaped: false,
  smooth: 0,
  trap: 0,
};

const renderIntervalMs = 1000 / 45;
let animationFrameId = 0;
let lastFrameTime = 0;
let lastRenderTime = 0;

const visible = computed(() => {
  return settings.visualizationMode === "fractal-traverse" && sources.source !== null && sources.source !== AudioSource.NONE;
});

const strength = computed(() => {
  return clamp(Number(settings.fractalTraverseStrength) || 0.84, 0.35, 1.35);
});

function calculateSegmentDuration(from: FractalWaypoint, to: FractalWaypoint) {
  // Blend spatial and zoom distance so transitions read as travel, not cuts.
  const spatialDistance = distance(from.center, to.center);
  const zoomDistance = Math.abs(Math.log(Math.max(from.scale, 0.000001) / Math.max(to.scale, 0.000001)));
  return clamp(9.2 + spatialDistance * 5.6 + zoomDistance * 4.1, 9.2, 22);
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

function resetInterestState() {
  interest.focusTargetOffset = { x: 0, y: 0 };
  interest.focusOffset = { x: 0, y: 0 };
  interest.focusTargetScore = 0.8;
  interest.focusTargetHoldUntil = 0;
  interest.desiredZoomGovernor = 1;
  interest.zoomGovernor = 1;
  interest.desiredZoomPermission = 1;
  interest.zoomPermission = 1;
  interest.desiredCurrentScore = 0.8;
  interest.currentScore = 0.8;
  interest.desiredBestScore = 0.8;
  interest.bestScore = 0.8;
  interest.lowInterestTime = 0;
  interest.searchPhase = 0.23;
  interest.lastEvaluationAt = 0;
}

function resetTraversalState() {
  const start = family.getStartViewport();
  traversal.currentIndex = 0;
  traversal.nextIndex = 1;
  traversal.progress = 0;
  traversal.segmentDuration = calculateSegmentDuration(family.guidePoints[0], family.guidePoints[1]);
  traversal.pathSpeed = 1;
  traversal.bendPhase = 0;
  traversal.driftPhase = 0;
  traversal.palettePhase = family.guidePoints[0].hueOffset;
  traversal.segmentSeed = 0.37;
  traversal.desiredCamera = copyViewport(start);
  traversal.camera = start;
  renderState.lastCamera = null;
  renderState.motion = 0;
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

function createShader(gl: WebGLRenderingContext, type: number, source: string) {
  const shader = gl.createShader(type);

  if (!shader) return null;

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    return shader;
  }

  console.warn("FractalTraverse shader compile failed:", gl.getShaderInfoLog(shader));
  gl.deleteShader(shader);
  return null;
}

function createProgram(gl: WebGLRenderingContext, vertexSource: string, fragmentSource: string) {
  const vertexShader = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragmentShader = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);

  if (!vertexShader || !fragmentShader) {
    if (vertexShader) gl.deleteShader(vertexShader);
    if (fragmentShader) gl.deleteShader(fragmentShader);
    return null;
  }

  const program = gl.createProgram();

  if (!program) {
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);
    return null;
  }

  gl.attachShader(program, vertexShader);
  gl.attachShader(program, fragmentShader);
  gl.linkProgram(program);
  gl.deleteShader(vertexShader);
  gl.deleteShader(fragmentShader);

  if (gl.getProgramParameter(program, gl.LINK_STATUS)) {
    return program;
  }

  console.warn("FractalTraverse program link failed:", gl.getProgramInfoLog(program));
  gl.deleteProgram(program);
  return null;
}

function destroyRenderer() {
  if (renderState.gl && renderState.buffer) {
    renderState.gl.deleteBuffer(renderState.buffer);
  }

  if (renderState.gl && renderState.program) {
    renderState.gl.deleteProgram(renderState.program);
  }

  renderState.canvas = null;
  renderState.gl = null;
  renderState.program = null;
  renderState.buffer = null;
  renderState.uniforms = null;
  renderState.displayWidth = 0;
  renderState.displayHeight = 0;
  renderState.dpr = 1;
  renderState.lastCamera = null;
  renderState.motion = 0;
}

function ensureRenderer() {
  if (!canvas.value) return false;

  if (renderState.canvas === canvas.value && renderState.gl && renderState.program && renderState.buffer && renderState.uniforms) {
    return true;
  }

  destroyRenderer();

  const gl =
    canvas.value.getContext("webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    }) ||
    canvas.value.getContext("experimental-webgl", {
      alpha: true,
      antialias: false,
      depth: false,
      stencil: false,
      premultipliedAlpha: true,
      preserveDrawingBuffer: false,
    });

  if (!gl) {
    console.warn("FractalTraverse could not create a WebGL context.");
    return false;
  }

  const context = gl as WebGLRenderingContext;
  const program = createProgram(context, VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);

  if (!program) {
    return false;
  }

  const buffer = context.createBuffer();
  if (!buffer) {
    context.deleteProgram(program);
    return false;
  }

  context.useProgram(program);
  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW);

  const positionLocation = context.getAttribLocation(program, "aPosition");
  if (positionLocation < 0) {
    context.deleteBuffer(buffer);
    context.deleteProgram(program);
    return false;
  }

  context.enableVertexAttribArray(positionLocation);
  context.vertexAttribPointer(positionLocation, 2, context.FLOAT, false, 0, 0);
  context.disable(context.DEPTH_TEST);
  context.disable(context.CULL_FACE);
  context.clearColor(0, 0, 0, 0);

  renderState.canvas = canvas.value;
  renderState.gl = context;
  renderState.program = program;
  renderState.buffer = buffer;
  renderState.uniforms = {
    resolution: context.getUniformLocation(program, "uResolution"),
    center: context.getUniformLocation(program, "uCenter"),
    scale: context.getUniformLocation(program, "uScale"),
    rotation: context.getUniformLocation(program, "uRotation"),
    aspect: context.getUniformLocation(program, "uAspect"),
    palettePhase: context.getUniformLocation(program, "uPalettePhase"),
    ambientLift: context.getUniformLocation(program, "uAmbientLift"),
    paletteEnergy: context.getUniformLocation(program, "uPaletteEnergy"),
    stableAA: context.getUniformLocation(program, "uStableAA"),
    maxIterations: context.getUniformLocation(program, "uMaxIterations"),
  };

  return true;
}

function updateRenderResolution() {
  if (!ensureRenderer() || !canvas.value || !renderState.gl) return;

  const width = Math.max(1, Math.round(viewport.width || window.innerWidth || 1));
  const height = Math.max(1, Math.round(viewport.height || window.innerHeight || 1));
  const dpr = Math.max(1, window.devicePixelRatio || 1);
  const displayWidth = Math.round(width * dpr);
  const displayHeight = Math.round(height * dpr);

  if (renderState.displayWidth === displayWidth && renderState.displayHeight === displayHeight && renderState.dpr === dpr) {
    return;
  }

  renderState.displayWidth = displayWidth;
  renderState.displayHeight = displayHeight;
  renderState.dpr = dpr;

  canvas.value.width = displayWidth;
  canvas.value.height = displayHeight;
  renderState.gl.viewport(0, 0, displayWidth, displayHeight);
}

function evaluateInterest(center: ComplexPoint, scale: number, aspectRatio: number): InterestMetrics {
  const columns = 6;
  const rows = 6;
  const escapedFlags: boolean[] = [];
  const values: number[] = [];
  const iterations = clamp(Math.round(62 + Math.max(0, Math.log2(2.35 / Math.max(scale, 0.000001))) * 20), 62, 144);
  const spanY = scale * 0.78;
  const spanX = spanY * Math.min(aspectRatio, 1.9) * 0.84;
  let valueSum = 0;
  let escapedCount = 0;
  let trapDetailSum = 0;

  for (let row = 0; row < rows; row++) {
    const rowT = rows === 1 ? 0 : row / (rows - 1);
    const offsetY = (rowT - 0.5) * spanY;

    for (let column = 0; column < columns; column++) {
      const columnT = columns === 1 ? 0 : column / (columns - 1);
      const offsetX = (columnT - 0.5) * spanX;

      family.sample(center.x + offsetX, center.y + offsetY, iterations, reusableInterestSample);

      const normalized = clamp(reusableInterestSample.smooth / iterations, 0, 1);
      const trapGlow = Math.exp(-reusableInterestSample.trap * 5.2);
      const fieldValue = reusableInterestSample.escaped ? normalized : 1 + trapGlow * 0.16;

      escapedFlags.push(reusableInterestSample.escaped);
      values.push(fieldValue);
      valueSum += fieldValue;
      trapDetailSum += trapGlow;

      if (reusableInterestSample.escaped) {
        escapedCount++;
      }
    }
  }

  const mean = valueSum / values.length;
  const escapedRatio = escapedCount / values.length;
  const trapDetail = trapDetailSum / values.length;
  let variance = 0;
  let edgeScore = 0;
  let edgeCount = 0;

  for (let index = 0; index < values.length; index++) {
    variance += Math.pow(values[index] - mean, 2);

    const column = index % columns;
    const row = Math.floor(index / columns);

    if (column < columns - 1) {
      const neighborIndex = index + 1;
      const difference = Math.abs(values[index] - values[neighborIndex]);
      edgeScore += (escapedFlags[index] !== escapedFlags[neighborIndex] ? 1 : 0) + clamp(difference * 2.2, 0, 1);
      edgeCount++;
    }

    if (row < rows - 1) {
      const neighborIndex = index + columns;
      const difference = Math.abs(values[index] - values[neighborIndex]);
      edgeScore += (escapedFlags[index] !== escapedFlags[neighborIndex] ? 1 : 0) + clamp(difference * 2.2, 0, 1);
      edgeCount++;
    }
  }

  variance /= values.length;

  const boundaryDensity = edgeCount > 0 ? edgeScore / (edgeCount * 1.9) : 0;
  const mixedness = 1 - clamp(Math.abs(escapedRatio - 0.5) * 2.2, 0, 1);

  // The score favors escape-time contrast plus escape/interior mixing, and explicitly
  // punishes uniform voids so we stop lingering in flat exterior or deep interior space.
  const uniformPenalty =
    clamp(0.08 - variance, 0, 0.08) * 6.2 +
    clamp(0.15 - boundaryDensity, 0, 0.15) * 4.4 +
    (escapedRatio < 0.06 || escapedRatio > 0.94 ? 0.34 : 0);
  const score = boundaryDensity * 1.45 + variance * 1.08 + mixedness * 0.58 + trapDetail * 0.34 - uniformPenalty * 1.22;

  return {
    center,
    scale,
    score,
    boundaryDensity,
    variation: variance,
    mixedness,
    trapDetail,
  };
}

function getCorrectionLimit(scale: number, lowInterestTime: number) {
  // Local interest guidance stays subordinate to the main bezier rail, even when rescuing
  // a dull region, so the camera reads as forward travel instead of sideways chasing.
  return scale * clamp(0.09 + lowInterestTime * 0.02, 0.09, 0.16);
}

function scanNearbyInterest(baseCenter: ComplexPoint, baseScale: number, aspectRatio: number) {
  const base = evaluateInterest(baseCenter, baseScale, aspectRatio);
  const lowInterest = base.score < 0.54 || interest.lowInterestTime > 0.3;
  const searchRadius = clamp(baseScale * (lowInterest ? 0.58 : 0.38), 0.014, 0.52);
  const scaleFactors = lowInterest ? [1.18, 1.06, 1, 0.94] : [1.06, 1, 0.94];
  const ringFactors = [0, 0.34, 0.62];
  let best = base;

  for (const ringFactor of ringFactors) {
    const radialDistance = searchRadius * ringFactor;
    const samplesOnRing = ringFactor === 0 ? 1 : 8;

    for (let step = 0; step < samplesOnRing; step++) {
      const angle = interest.searchPhase + (step / Math.max(1, samplesOnRing)) * Math.PI * 2;
      const offset = {
        x: Math.cos(angle) * radialDistance * Math.min(aspectRatio, 1.85),
        y: Math.sin(angle) * radialDistance,
      };

      for (const scaleFactor of scaleFactors) {
        const candidateCenter = {
          x: baseCenter.x + offset.x,
          y: baseCenter.y + offset.y,
        };
        const candidateScale = clamp(baseScale * scaleFactor, 0.02, 3.2);
        const metrics = evaluateInterest(candidateCenter, candidateScale, aspectRatio);
        const continuityPenalty =
          (ringFactor > 0 ? ringFactor * 0.08 : 0) +
          Math.abs(Math.log(candidateScale / baseScale)) * 0.08;
        const adjustedScore = metrics.score - continuityPenalty;

        if (adjustedScore > best.score) {
          best = {
            ...metrics,
            score: adjustedScore,
          };
        }
      }
    }
  }

  return { base, best };
}

function updateInterestGuidance(baseCenter: ComplexPoint, baseScale: number, deltaSeconds: number, now: number) {
  const aspectRatio = Math.max((viewport.width || window.innerWidth || 1) / Math.max(viewport.height || window.innerHeight || 1, 1), 0.6);
  const correctionLimit = getCorrectionLimit(baseScale, interest.lowInterestTime);

  if (!interest.lastEvaluationAt || now - interest.lastEvaluationAt >= 360) {
    const { base, best } = scanNearbyInterest(baseCenter, baseScale, aspectRatio);
    const hasFocusTarget = Math.hypot(interest.focusTargetOffset.x, interest.focusTargetOffset.y) > baseScale * 0.002;
    const currentTargetOffset = clampVectorMagnitude(interest.focusTargetOffset, correctionLimit);
    const currentTargetCenter = {
      x: baseCenter.x + currentTargetOffset.x,
      y: baseCenter.y + currentTargetOffset.y,
    };
    const currentTargetMetrics = hasFocusTarget ? evaluateInterest(currentTargetCenter, baseScale, aspectRatio) : base;
    const currentTargetPenalty =
      hasFocusTarget ? (Math.hypot(currentTargetOffset.x, currentTargetOffset.y) / Math.max(correctionLimit, 0.000001)) * 0.05 : 0;
    const currentTargetScore = hasFocusTarget ? currentTargetMetrics.score - currentTargetPenalty : base.score;
    const candidateOffset = clampVectorMagnitude(
      {
        x: best.center.x - baseCenter.x,
        y: best.center.y - baseCenter.y,
      },
      correctionLimit
    );
    const candidatePenalty = (Math.hypot(candidateOffset.x, candidateOffset.y) / Math.max(correctionLimit, 0.000001)) * 0.05;
    const candidateScore = best.score - candidatePenalty;
    const focusClearlyBad = currentTargetScore < 0.46 || (base.score < 0.42 && interest.lowInterestTime > 0.8);
    const dwellExpired = now >= interest.focusTargetHoldUntil;
    // The focus target is sticky on purpose: we only swap it out when a new local sample is
    // clearly better or when the current target has been boring for too long.
    const replacementMargin = focusClearlyBad ? 0.05 : dwellExpired ? 0.14 : 0.24;
    const shouldReplaceFocus =
      candidateScore > currentTargetScore + replacementMargin && (!hasFocusTarget || dwellExpired || focusClearlyBad);
    const shouldReleaseFocus =
      hasFocusTarget && dwellExpired && currentTargetScore < base.score - 0.08 && candidateScore <= currentTargetScore + 0.03;

    if (shouldReplaceFocus) {
      interest.focusTargetOffset = candidateOffset;
      interest.focusTargetScore = candidateScore;
      interest.focusTargetHoldUntil = now + (focusClearlyBad ? 700 : 1350);
    } else if (shouldReleaseFocus) {
      interest.focusTargetOffset = { x: 0, y: 0 };
      interest.focusTargetScore = base.score;
      interest.focusTargetHoldUntil = now + 900;
    }

    interest.desiredCurrentScore = base.score;
    interest.desiredBestScore = Math.max(candidateScore, currentTargetScore, base.score);
    interest.lastEvaluationAt = now;
    interest.searchPhase = (interest.searchPhase + 0.48 + audio.bend * 0.16) % (Math.PI * 2);

    const lowInterestPressure = clamp((0.56 - base.score) / 0.24, 0, 1);
    const betterScale = Math.max(1, best.scale / baseScale);

    // Zoom response is continuous now: low-interest regions gradually ease off zoom pressure
    // instead of flipping between allowed and blocked states on each rescan.
    interest.desiredZoomGovernor =
      lowInterestPressure > 0
        ? clamp(lerp(1, Math.max(1 + lowInterestPressure * 0.1, betterScale), 0.82), 1, 1.22)
        : 1;
    interest.desiredZoomPermission =
      lowInterestPressure > 0
        ? clamp(1 - lowInterestPressure * 0.7, 0.32, 1)
        : 1;
  }

  interest.currentScore = damp(interest.currentScore, interest.desiredCurrentScore, 2.1, deltaSeconds);
  interest.bestScore = damp(interest.bestScore, interest.desiredBestScore, 1.9, deltaSeconds);

  const lowInterestPressure = clamp((0.54 - interest.currentScore) / 0.22, 0, 1);
  if (lowInterestPressure > 0) {
    interest.lowInterestTime = clamp(interest.lowInterestTime + deltaSeconds * (0.42 + lowInterestPressure * 1.08), 0, 4.5);
  } else {
    interest.lowInterestTime = Math.max(0, interest.lowInterestTime - deltaSeconds * 0.95);
  }

  const correctionResponse = 0.9 + clamp(interest.lowInterestTime / 2.2, 0, 1) * 0.8;
  const zoomResponse = 1 + lowInterestPressure * 0.8;

  interest.focusOffset.x = damp(interest.focusOffset.x, interest.focusTargetOffset.x, correctionResponse, deltaSeconds);
  interest.focusOffset.y = damp(interest.focusOffset.y, interest.focusTargetOffset.y, correctionResponse, deltaSeconds);
  interest.zoomGovernor = damp(interest.zoomGovernor, interest.desiredZoomGovernor, zoomResponse, deltaSeconds);
  interest.zoomPermission = damp(interest.zoomPermission, interest.desiredZoomPermission, zoomResponse, deltaSeconds);
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

  // Fast-vs-slow energy keeps the motion alive in quiet passages while making relative
  // changes matter more than sustained loudness.
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

function updateTraversal(deltaSeconds: number, now: number) {
  const reactivity = clamp(0.5 + ((strength.value - 0.35) / 1) * 0.95, 0.5, 1.45);
  const baseSpeed = 0.92 + audio.ambient * 0.12;
  const lowInterestDrag = clamp(interest.lowInterestTime * 0.03, 0, 0.12);
  const speedTarget = clamp(baseSpeed + audio.zoom * 0.16 * reactivity - lowInterestDrag, 0.76, 1.28);

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
  const baseScale = Math.exp(lerp(Math.log(from.scale), Math.log(to.scale), smoothStep(clamp(traversal.progress, 0, 1))));

  updateInterestGuidance(pathPoint, baseScale, deltaSeconds, now);

  const driftAmplitude = baseScale * (0.022 + audio.ambient * 0.016 + audio.bend * 0.01);
  const driftX = Math.cos(traversal.driftPhase + traversal.segmentSeed * 0.73) * driftAmplitude * 0.78;
  const driftY = Math.sin(traversal.driftPhase * 0.94 - traversal.segmentSeed * 0.41) * driftAmplitude * 0.55;
  const tangent = cubicBezierTangent(from.center, controlA, controlB, to.center, easedPath);
  const tangentAhead = cubicBezierTangent(from.center, controlA, controlB, to.center, clamp(easedPath + 0.08, 0, 1));
  const tangentMagnitude = Math.max(Math.hypot(tangent.x, tangent.y), 0.000001);
  const tangentUnit = {
    x: tangent.x / tangentMagnitude,
    y: tangent.y / tangentMagnitude,
  };
  const tangentAngle = Math.atan2(tangentUnit.y, tangentUnit.x);
  const tangentAheadAngle = Math.atan2(tangentAhead.y, tangentAhead.x);
  const pathBank = clamp(tangentUnit.y * 0.16 + tangentUnit.x * 0.04, -0.18, 0.18);
  const curvatureBank = clamp(angleDelta(tangentAheadAngle, tangentAngle) * 2.4, -0.14, 0.14);
  const rotationTarget =
    lerp(from.rotation, to.rotation, easedPath) +
    pathBank +
    curvatureBank +
    Math.sin(traversal.bendPhase * 0.52 + traversal.segmentSeed) * (0.014 + audio.bend * 0.032);
  const audioZoomFactor = 1 - audio.zoom * 0.045 * reactivity * interest.zoomPermission;
  const correctionInfluence = clamp(0.68 + interest.lowInterestTime * 0.06, 0.68, 0.84);

  traversal.desiredCamera = {
    center: {
      x: pathPoint.x + interest.focusOffset.x * correctionInfluence + driftX,
      y: pathPoint.y + interest.focusOffset.y * correctionInfluence + driftY,
    },
    scale: clamp(baseScale * interest.zoomGovernor * audioZoomFactor, 0.02, 3.2),
    rotation: rotationTarget,
  };

  // The desired camera can move more assertively while the rendered camera eases after it.
  // That extra inertial layer is what makes the flight read as intentional instead of reactive.
  const centerResponse = 1.7 + audio.zoom * 0.18;
  const scaleResponse = 1.9 + audio.zoom * 0.22;
  const rotationResponse = 1.75 + Math.abs(curvatureBank) * 2.8;

  traversal.camera = {
    center: {
      x: damp(traversal.camera.center.x, traversal.desiredCamera.center.x, centerResponse, deltaSeconds),
      y: damp(traversal.camera.center.y, traversal.desiredCamera.center.y, centerResponse, deltaSeconds),
    },
    scale: damp(traversal.camera.scale, traversal.desiredCamera.scale, scaleResponse, deltaSeconds),
    rotation: dampAngle(traversal.camera.rotation, traversal.desiredCamera.rotation, rotationResponse, deltaSeconds),
  };
}

function renderFractal(deltaSeconds: number) {
  if (!ensureRenderer() || !renderState.gl || !renderState.program || !renderState.uniforms) {
    return;
  }

  const gl = renderState.gl;
  const uniforms = renderState.uniforms;
  const aspectRatio = renderState.displayWidth / Math.max(renderState.displayHeight, 1);
  const zoomDepth = Math.max(0, Math.log2(2.35 / Math.max(traversal.camera.scale, 0.000001)));
  const dprBias = Math.max(0, Math.sqrt(renderState.dpr) - 1);
  const centerMotion = renderState.lastCamera
    ? distance(renderState.lastCamera.center, traversal.camera.center) / Math.max(traversal.camera.scale, 0.000001)
    : 0;
  const zoomMotion = renderState.lastCamera
    ? Math.abs(Math.log(renderState.lastCamera.scale / traversal.camera.scale))
    : 0;
  const rotationMotion = renderState.lastCamera
    ? Math.abs(angleDelta(traversal.camera.rotation, renderState.lastCamera.rotation))
    : 0;
  const motionTarget = centerMotion + zoomMotion * 1.8 + rotationMotion * 0.55;

  renderState.motion = damp(renderState.motion, motionTarget, 10, deltaSeconds);

  const stableAA = clamp(1 - renderState.motion * 12, 0, 1);
  const maxIterations = family.getMaxIterations(traversal.camera.scale, clamp(stableAA + dprBias + zoomDepth * 0.08, 0, 1.4));

  gl.useProgram(renderState.program);
  gl.uniform2f(uniforms.resolution, renderState.displayWidth, renderState.displayHeight);
  gl.uniform2f(uniforms.center, traversal.camera.center.x, traversal.camera.center.y);
  gl.uniform1f(uniforms.scale, traversal.camera.scale);
  gl.uniform1f(uniforms.rotation, traversal.camera.rotation);
  gl.uniform1f(uniforms.aspect, aspectRatio);
  gl.uniform1f(uniforms.palettePhase, (traversal.palettePhase + family.guidePoints[traversal.currentIndex].hueOffset) % 1);
  gl.uniform1f(uniforms.ambientLift, 0.07 + audio.ambient * 0.08);
  gl.uniform1f(uniforms.paletteEnergy, 0.14 + audio.palette * 0.14);
  gl.uniform1f(uniforms.stableAA, stableAA);
  gl.uniform1i(uniforms.maxIterations, maxIterations);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  renderState.lastCamera = copyViewport(traversal.camera);
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
  updateTraversal(deltaSeconds, now);

  if (now - lastRenderTime < renderIntervalMs) return;

  lastRenderTime = now;
  renderFractal(deltaSeconds);
}

watch(
  () => visible.value,
  (isVisible) => {
    if (!isVisible) {
      resetAudioState();
      resetInterestState();
      lastFrameTime = 0;
      return;
    }

    resetTraversalState();
    resetInterestState();
    resetAudioState();
    lastFrameTime = 0;
    lastRenderTime = 0;
  },
  { immediate: true }
);

watch(
  () => canvas.value,
  (nextCanvas) => {
    if (!nextCanvas) {
      destroyRenderer();
      return;
    }

    if (!visible.value) return;

    ensureRenderer();
    updateRenderResolution();
    renderFractal(1 / 60);
  }
);

watch(
  () => [viewport.width, viewport.height],
  () => {
    if (!visible.value) return;
    updateRenderResolution();
    renderFractal(1 / 60);
  }
);

watch(
  () => sources.source,
  () => {
    if (!visible.value) return;
    resetAudioState();
    resetInterestState();
    lastFrameTime = 0;
  }
);

onMounted(() => {
  animationFrameId = window.requestAnimationFrame(animate);
});

onBeforeUnmount(() => {
  window.cancelAnimationFrame(animationFrameId);
  destroyRenderer();
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
