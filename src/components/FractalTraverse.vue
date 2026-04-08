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
import { useViewport } from "@wearesage/vue";
import { useAudioFeatures } from "../stores/audio-features";
import { usePulse } from "../stores/pulse";
import { useSources } from "../stores/sources";
import { type FractalTraverseLayoutMode, useVisualizerSettings } from "../stores/visualizer-settings";

const VERTEX_SHADER_SOURCE = `
attribute vec2 aPosition;
varying vec2 vUv;

void main() {
  vUv = aPosition * 0.5 + 0.5;
  gl_Position = vec4(aPosition, 0.0, 1.0);
}
`;

const FRACTAL_FRAGMENT_SHADER_SOURCE = `
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
uniform float uStructurePower;
uniform float uTrapMix;
uniform float uTrapScale;
uniform float uPaletteBias;
uniform float uVoidFade;
uniform float uVoidCollapse;
uniform float uLayoutMode;
uniform float uSliceCount;
uniform float uPizzaWarp;
uniform float uPizzaSpin;
uniform float uPizzaMorph;
uniform float uSymmetryGroup;
uniform float uSymmetryMode;
uniform float uSymmetryStrength;
uniform vec2 uCoinTilt;
uniform float uCoinSpin;
uniform float uCoinPrecession;
uniform float uCoinFlip;
uniform float uCoinDepth;
uniform float uCoinRadius;
uniform vec2 uCoinOffset;
uniform vec3 uCoinSpinAxis;
uniform float uCoinShimmer;
uniform float uPizzaBackdropRotation;
uniform float uPizzaBackdropTorsion;

const int MAX_ITERATIONS = 768;
const float PI = 3.14159265359;
const float TAU = 6.28318530718;

struct FractalSample {
  float escaped;
  float smoothValue;
  float trap;
};

struct CoinProjection {
  vec2 discUv;
  float radius;
  float valid;
  float discMask;
  float edgeFacing;
  float frontFacing;
};

vec2 complexPowReal(vec2 z, float power) {
  float radiusSquared = dot(z, z);

  if (radiusSquared < 0.00000001) {
    return vec2(0.0);
  }

  float radius = sqrt(radiusSquared);
  float angle = atan(z.y, z.x);
  float poweredRadius = pow(radius, power);
  float poweredAngle = angle * power;
  return vec2(cos(poweredAngle), sin(poweredAngle)) * poweredRadius;
}

vec2 rotate2d(vec2 point, float angle) {
  float cosine = cos(angle);
  float sine = sin(angle);
  return vec2(
    point.x * cosine - point.y * sine,
    point.x * sine + point.y * cosine
  );
}

vec3 rotateX3d(vec3 point, float angle) {
  float cosine = cos(angle);
  float sine = sin(angle);
  return vec3(
    point.x,
    point.y * cosine - point.z * sine,
    point.y * sine + point.z * cosine
  );
}

vec3 rotateY3d(vec3 point, float angle) {
  float cosine = cos(angle);
  float sine = sin(angle);
  return vec3(
    point.x * cosine + point.z * sine,
    point.y,
    -point.x * sine + point.z * cosine
  );
}

vec3 rotateZ3d(vec3 point, float angle) {
  float cosine = cos(angle);
  float sine = sin(angle);
  return vec3(
    point.x * cosine - point.y * sine,
    point.x * sine + point.y * cosine,
    point.z
  );
}

vec3 rotateAroundAxis3d(vec3 point, vec3 axis, float angle) {
  vec3 unitAxis = normalize(axis + vec3(0.0, 0.0, 0.0001));
  float cosine = cos(angle);
  float sine = sin(angle);
  return point * cosine + cross(unitAxis, point) * sine + unitAxis * dot(unitAxis, point) * (1.0 - cosine);
}

vec3 safeCoinPerpendicular(vec3 axis) {
  vec3 fallback = abs(axis.z) > 0.82 ? vec3(0.0, 1.0, 0.0) : vec3(0.0, 0.0, 1.0);
  return normalize(cross(axis, fallback));
}

vec3 applyCoinRotation(vec3 point) {
  vec3 spinAxis = normalize(uCoinSpinAxis + vec3(0.0, 0.0, 0.0001));
  vec3 flipAxis = safeCoinPerpendicular(spinAxis);
  vec3 wobbleAxis = normalize(cross(flipAxis, spinAxis));
  vec3 rotated = rotateAroundAxis3d(point, spinAxis, uCoinSpin);
  rotated = rotateAroundAxis3d(rotated, flipAxis, uCoinFlip * 0.42 + uCoinTilt.x * 0.34);
  return rotateAroundAxis3d(rotated, wobbleAxis, uCoinTilt.y * 0.3);
}

float positiveMod(float value, float modulus) {
  return mod(mod(value, modulus) + modulus, modulus);
}

vec2 discUvFromFrag(vec2 fragCoord) {
  float safeRadius = max(min(uResolution.x, uResolution.y) * 0.5, 0.0001);
  return (fragCoord - uResolution * 0.5) / safeRadius;
}

void pizzaSymmetryDataFromDiscUv(
  vec2 discUv,
  out float radius,
  out float sliceIndex,
  out float canonicalAngle,
  out float seamDistance,
  out float sliceAngle,
  out float slicePhase
) {
  radius = length(discUv);
  float order = max(3.0, floor(uSliceCount + 0.5));
  float modeIndex = max(1.0, floor(uSymmetryMode + 0.5));
  sliceAngle = TAU / order;
  float wrappedAngle = positiveMod(atan(discUv.y, discUv.x) + PI + uPizzaSpin * 0.14, TAU);
  sliceIndex = floor(wrappedAngle / sliceAngle);
  float reducedAngle = wrappedAngle - sliceIndex * sliceAngle;
  float centeredAngle = reducedAngle - sliceAngle * 0.5;
  seamDistance = min(reducedAngle, sliceAngle - reducedAngle) / max(sliceAngle * 0.5, 0.0001);
  canonicalAngle = uSymmetryGroup > 0.5 ? abs(centeredAngle) : centeredAngle;
  slicePhase = TAU * modeIndex * sliceIndex / order;
}

void pizzaSymmetryData(
  vec2 fragCoord,
  out vec2 discUv,
  out float radius,
  out float sliceIndex,
  out float canonicalAngle,
  out float seamDistance,
  out float sliceAngle,
  out float slicePhase
) {
  discUv = discUvFromFrag(fragCoord);
  pizzaSymmetryDataFromDiscUv(discUv, radius, sliceIndex, canonicalAngle, seamDistance, sliceAngle, slicePhase);
}

FractalSample sampleMutatingMandelbrot(vec2 c) {
  vec2 z = vec2(0.0);
  float trap = 1000000.0;
  float smoothValue = float(uMaxIterations);
  float escaped = 0.0;
  float structurePower = max(uStructurePower, 1.01);

  for (int i = 0; i < MAX_ITERATIONS; i++) {
    if (i >= uMaxIterations) {
      break;
    }

    z = complexPowReal(z, structurePower) + c;
    float radiusSquared = dot(z, z);
    float crossTrap = abs(z.x * z.y) * mix(1.08, 0.84, uTrapMix);
    float stripeTrap = abs(z.x) + abs(z.y) * mix(0.24, 0.58, uTrapMix);
    float ringTrap = abs(length(z) - (0.38 + uTrapMix * 0.42));
    trap = min(trap, min(mix(crossTrap, stripeTrap, uTrapMix), ringTrap * (0.84 + uTrapMix * 0.36)) * uTrapScale);

    if (radiusSquared > 16.0) {
      float radius = sqrt(radiusSquared);
      smoothValue = float(i) + 1.0 - log(max(log(max(radius, 1.0001)), 0.0001)) / log(structurePower);
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

vec3 colorize(FractalSample sample, vec2 uv, float paletteOffset) {
  float pizzaMix = clamp(uLayoutMode, 0.0, 1.0);
  float normalized = clamp(sample.smoothValue / float(uMaxIterations), 0.0, 1.0);
  float trapGlow = exp(-sample.trap * (8.2 - uPaletteEnergy * 1.9));
  float localPaletteWave = uv.x * 0.035 + uv.y * 0.025;
  float paletteT =
    uPalettePhase +
    uPaletteBias +
    paletteOffset +
    localPaletteWave +
    normalized * (0.84 + uTrapMix * 0.06) +
    trapGlow * (0.14 + uTrapMix * 0.06);
  vec3 wave = 0.5 + 0.5 * cos(TAU * (paletteT + vec3(0.02, 0.22, 0.47)));
  float vignette = clamp(1.08 - dot(uv, uv) * 1.42, 0.68, 1.08);
  vec3 color;

  if (sample.escaped < 0.5) {
    float interior = (0.02 + trapGlow * (0.12 + uTrapMix * 0.06) + uAmbientLift * mix(0.82, 1.24, pizzaMix)) * vignette;
    vec3 interiorBase = pow(vec3(interior * 0.11, interior * 0.16, interior * 0.27), vec3(0.96));
    vec3 interiorGlow = wave * interior * (0.05 + pizzaMix * 0.16);
    color = interiorBase + interiorGlow;
  } else {
    float boundary = pow(normalized, 1.18);
    float shimmer = 0.16 + uPaletteEnergy + trapGlow * (0.28 + uTrapMix * 0.14);
    float brightness = (uAmbientLift + boundary * 0.68 + shimmer) * vignette * (1.0 + pizzaMix * 0.12);
    color = vec3(0.1 + wave.r * 0.9, 0.08 + wave.g * 0.72, 0.18 + wave.b * 0.96) * brightness;
    color = pow(color, vec3(0.94));
  }

  float grayscale = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec3 desaturated = mix(color, vec3(grayscale), clamp(uVoidFade * 0.76, 0.0, 1.0));
  float radial = length(uv * vec2(1.0, 1.08));
  float collapseEdge = mix(1.18, 0.28, clamp(uVoidCollapse, 0.0, 1.0));
  float collapseMask = smoothstep(collapseEdge, 1.22, radial);
  float voidMask = clamp(uVoidFade * mix(0.52, 1.0, collapseMask), 0.0, 1.0);

  return mix(desaturated * (1.0 - uVoidFade * 0.54), vec3(0.003, 0.005, 0.009), voidMask);
}

vec3 boostSaturation(vec3 color, float amount) {
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  return mix(vec3(luma), color, amount);
}

float pizzaContinuationMix(float radius) {
  return smoothstep(0.96, 1.22, radius);
}

FractalSample samplePizzaField(vec2 discUv, float continuationMix, out vec2 paletteUv, out float paletteOffset) {
  float radius;
  float sliceIndex;
  float canonicalAngle;
  float seamDistance;
  float sliceAngle;
  float slicePhase;
  pizzaSymmetryDataFromDiscUv(discUv, radius, sliceIndex, canonicalAngle, seamDistance, sliceAngle, slicePhase);

  float seamBias = 1.0 - seamDistance;
  float halfSlice = max(sliceAngle * 0.5, 0.0001);
  float phaseCos = cos(slicePhase);
  float phaseSin = sin(slicePhase);
  float haloMix = smoothstep(0.86, 1.02, radius) * (1.0 - smoothstep(1.22, 1.52, radius));
  float recurrenceBand =
    0.5 +
    0.5 *
    sin((radius - 1.0) * (4.8 + uPizzaWarp * 2.1) - uPizzaMorph * 0.3 + slicePhase * (1.0 + phaseCos * 0.12));
  float radiusInversion = clamp(0.98 / max(radius, 0.0001), 0.18, 1.02);
  float continuationRadius = clamp(
    mix(radiusInversion, 0.58 + recurrenceBand * 0.18, 0.32 + haloMix * 0.14),
    0.18,
    1.02
  );
  float continuationTwist =
    continuationMix *
    ((radius - 1.0) * (0.34 + uPizzaWarp * 0.16) + log(1.0 + max(radius - 1.0, 0.0) * 2.0) * (0.28 + uSymmetryStrength * 0.16));
  float mappedRadius = mix(radius, continuationRadius, continuationMix);
  float mappedAngle = canonicalAngle + continuationTwist;
  float wedgeCoord = mappedAngle / halfSlice;
  vec2 radialDirection = radius > 0.0001 ? discUv / radius : vec2(0.0, 1.0);
  vec2 mappedDiscUv = radialDirection * mappedRadius;
  float discWarpEnvelope = smoothstep(0.06, 0.3, radius) * (1.0 - smoothstep(0.82, 1.0, radius));
  float exteriorWarpEnvelope = continuationMix * (1.0 - smoothstep(1.18, 2.02, radius));
  float warpEnvelope = max(discWarpEnvelope, exteriorWarpEnvelope);
  float radialWarp =
    sin(mappedRadius * (7.2 + phaseCos * 1.1) - uPizzaMorph * (1.08 + phaseSin * 0.12) + slicePhase) *
    (0.05 + uPizzaWarp * (0.09 + uSymmetryStrength * 0.035)) *
    warpEnvelope;
  float angularWarp =
    sin(wedgeCoord * (4.5 + phaseSin * 0.7) + uPizzaMorph * 0.82 + slicePhase * 0.78) *
    (0.06 + uPizzaWarp * (0.1 + uSymmetryStrength * 0.035)) *
    warpEnvelope;

  // The outer field still comes from the same canonical wedge; only the radial remap
  // and twist change as pixels move beyond the disc.
  vec2 wedgeUv = vec2(
    wedgeCoord * (0.92 + uSymmetryStrength * 0.14 + phaseCos * 0.04 + continuationMix * 0.1) + angularWarp,
    (mappedRadius - 0.45) * (1.42 + phaseSin * 0.12 + continuationMix * 0.12) + radialWarp
  );
  wedgeUv = rotate2d(
    wedgeUv * (0.9 + uSymmetryStrength * 0.12 + phaseCos * 0.06) +
    vec2(phaseCos, phaseSin) * (0.024 + uSymmetryStrength * 0.024 + continuationMix * 0.018) +
    mappedDiscUv * (0.032 + uPizzaWarp * 0.026 + continuationMix * 0.02),
    phaseSin * (0.18 + uSymmetryStrength * 0.14) + phaseCos * uPizzaMorph * 0.032 + continuationMix * 0.12
  );

  float sampleSpan = uScale * (0.86 + uPizzaWarp * 0.14 + uSymmetryStrength * 0.1) * mix(1.0, 0.74, continuationMix);
  paletteUv = mix(mappedDiscUv, wedgeUv * 0.46, 0.4 + continuationMix * 0.14);
  paletteOffset =
    (phaseCos * 0.045 + phaseSin * 0.022) * uSymmetryStrength +
    seamBias * 0.024 +
    mappedRadius * 0.02 +
    continuationMix * (0.024 + recurrenceBand * 0.018) +
    mix(wedgeCoord * 0.006, wedgeCoord * 0.012, step(0.5, uSymmetryGroup));
  return sampleMutatingMandelbrot(uCenter + rotate2d(wedgeUv, uRotation + uPizzaSpin * 0.07) * sampleSpan);
}

FractalSample sampleAtFrag(vec2 fragCoord, out vec2 paletteUv, out float paletteOffset) {
  vec2 centered = fragCoord / uResolution - 0.5;
  paletteUv = vec2(centered.x, centered.y);
  paletteOffset = 0.0;

  if (uLayoutMode > 0.5 && uLayoutMode < 1.5) {
    vec2 discUv = discUvFromFrag(fragCoord);
    float continuationMix = pizzaContinuationMix(length(discUv));
    return samplePizzaField(discUv, continuationMix, paletteUv, paletteOffset);
  }

  centered.x *= uAspect;
  return sampleMutatingMandelbrot(uCenter + rotate2d(centered, uRotation) * uScale);
}

vec3 shadeAtFrag(vec2 fragCoord) {
  vec2 paletteUv;
  float paletteOffset;
  FractalSample sample = sampleAtFrag(fragCoord, paletteUv, paletteOffset);
  return colorize(sample, paletteUv, paletteOffset);
}

float normalizedSmooth(FractalSample sample) {
  return clamp(sample.smoothValue / float(uMaxIterations), 0.0, 1.0);
}

float sampleBoundaryMetric(vec2 fragCoord, FractalSample centerSample) {
  vec2 ignoredUv;
  float ignoredOffset;
  FractalSample probeX = sampleAtFrag(fragCoord + vec2(0.9, 0.0), ignoredUv, ignoredOffset);
  FractalSample probeY = sampleAtFrag(fragCoord + vec2(0.0, 0.9), ignoredUv, ignoredOffset);
  float centerSmooth = normalizedSmooth(centerSample);
  float smoothGradient = abs(centerSmooth - normalizedSmooth(probeX)) + abs(centerSmooth - normalizedSmooth(probeY));
  float escapeGradient = abs(centerSample.escaped - probeX.escaped) + abs(centerSample.escaped - probeY.escaped);
  float centerTrap = log(1.0 + centerSample.trap);
  float trapGradient = abs(centerTrap - log(1.0 + probeX.trap)) + abs(centerTrap - log(1.0 + probeY.trap));

  return clamp(smoothGradient * 1.7 + escapeGradient * 0.45 + trapGradient * 0.9, 0.0, 1.0);
}

vec3 applyPizzaComposition(vec3 color, vec2 fragCoord) {
  vec2 discUv;
  float radius;
  float sliceIndex;
  float canonicalAngle;
  float seamDistance;
  float sliceAngle;
  float slicePhase;
  pizzaSymmetryData(fragCoord, discUv, radius, sliceIndex, canonicalAngle, seamDistance, sliceAngle, slicePhase);

  float halfSlice = max(sliceAngle * 0.5, 0.0001);
  float wedgeCoord = canonicalAngle / halfSlice;
  float discMask = 1.0 - smoothstep(0.88, 0.97, radius);
  float haloMask = smoothstep(0.84, 0.98, radius) * (1.0 - smoothstep(1.16, 1.42, radius));
  float outerFieldMask = smoothstep(1.0, 1.32, radius) * (1.0 - smoothstep(1.98, 2.26, radius));
  float seamShadow = (1.0 - smoothstep(0.04, 0.2, seamDistance)) * smoothstep(0.1, 0.92, radius);
  float seamGlow = (1.0 - smoothstep(0.0, 0.1, seamDistance)) * smoothstep(0.16, 0.92, radius);
  float hubMask = 1.0 - smoothstep(0.045, 0.17, radius);
  float hubRing = smoothstep(0.08, 0.11, radius) * (1.0 - smoothstep(0.15, 0.19, radius));
  float rim = smoothstep(0.76, 0.9, radius) * (1.0 - smoothstep(0.94, 1.02, radius));
  float exteriorReach = 1.0 - smoothstep(1.92, 2.28, radius);
  vec3 background = vec3(0.005, 0.007, 0.012);
  vec3 seamColor = vec3(0.024, 0.018, 0.03) + vec3(0.08, 0.055, 0.04) * (0.22 + uPaletteEnergy * 0.16);
  vec3 crustGlow = vec3(0.16, 0.11, 0.08) * (0.06 + uPaletteEnergy * 0.05);
  vec3 hubGlow = vec3(0.11, 0.1, 0.13) * (0.08 + uAmbientLift * 0.12);
  float exteriorPhase = canonicalAngle * 5.6 + radius * (3.2 + uPizzaWarp * 1.6) - uPizzaMorph * 0.24 + slicePhase;
  float mirrorBloom = 0.5 + 0.5 * cos(exteriorPhase);
  float sliceBloom = pow(clamp(1.0 - abs(wedgeCoord), 0.0, 1.0), 1.5);
  float radialBands = 0.5 + 0.5 * cos((radius - 0.96) * (7.2 + uPizzaWarp * 2.0) - uPizzaMorph * 0.34 + slicePhase);
  float exteriorSymmetry = sliceBloom * (0.56 + radialBands * 0.44);
  float exteriorLuma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  float spokeFan = pow(clamp(1.0 - seamDistance, 0.0, 1.0), 1.7);
  vec3 exteriorBase = mix(vec3(exteriorLuma * (0.34 + uAmbientLift * 0.14)), color, 0.64);
  exteriorBase = boostSaturation(exteriorBase, 0.96 + exteriorSymmetry * 0.16);
  vec3 haloColor =
    exteriorBase * (0.76 + uAmbientLift * 0.24 + uPaletteEnergy * 0.12 + exteriorSymmetry * 0.12) +
    seamColor * (0.08 + mirrorBloom * 0.06 + spokeFan * 0.04) +
    crustGlow * exteriorSymmetry * 0.12;
  vec3 outerColor =
    mix(vec3(exteriorLuma), exteriorBase, 0.54) * (0.34 + uAmbientLift * 0.12 + uPaletteEnergy * 0.08 + radialBands * 0.08);
  outerColor += seamColor * sliceBloom * (0.03 + mirrorBloom * 0.02);
  outerColor += crustGlow * (0.02 + radialBands * 0.04);
  outerColor = boostSaturation(outerColor, 0.82 + mirrorBloom * 0.08);

  vec3 discColor = color;

  discColor *= 1.0 - seamShadow * 0.14;
  discColor = mix(discColor, seamColor, seamGlow * 0.12);
  discColor += crustGlow * rim;
  discColor = mix(discColor, background, hubMask * 0.58);
  discColor += hubGlow * hubRing;

  // Three radial zones keep the disc as the anchor while the same wedge symmetry
  // spills outward into a softer halo and outer field.
  vec3 exterior = background;
  exterior = mix(exterior, haloColor, haloMask * 0.78);
  exterior = mix(exterior, outerColor, outerFieldMask * exteriorReach * 0.92);

  return mix(exterior, discColor, discMask);
}

CoinProjection projectCoinDisc(vec2 fragCoord) {
  CoinProjection projection;
  projection.discUv = vec2(0.0);
  projection.radius = 10.0;
  projection.valid = 0.0;
  projection.discMask = 0.0;
  projection.edgeFacing = 0.0;
  projection.frontFacing = 1.0;

  vec2 screen = (fragCoord - uResolution * 0.5) / max(uResolution.y, 0.0001);
  float cameraDistance = 2.35;
  vec3 rayOrigin = vec3(0.0, 0.0, cameraDistance);
  vec3 imagePoint = vec3(screen, 0.0);
  vec3 rayDirection = normalize(imagePoint - rayOrigin);
  vec3 tangent = applyCoinRotation(vec3(1.0, 0.0, 0.0));
  vec3 bitangent = applyCoinRotation(vec3(0.0, 1.0, 0.0));
  vec3 normal = applyCoinRotation(vec3(0.0, 0.0, 1.0));
  vec3 planeCenter = vec3(uCoinOffset, -uCoinDepth);
  float denominator = dot(rayDirection, normal);

  if (abs(denominator) < 0.0001) {
    return projection;
  }

  float rayDistance = dot(planeCenter - rayOrigin, normal) / denominator;

  if (rayDistance <= 0.0) {
    return projection;
  }

  vec3 hit = rayOrigin + rayDirection * rayDistance;
  vec3 relative = hit - planeCenter;
  vec2 discUv = vec2(dot(relative, tangent), dot(relative, bitangent)) / max(uCoinRadius, 0.0001);
  vec3 viewDirection = normalize(rayOrigin - hit);
  float facing = clamp(abs(dot(normal, viewDirection)), 0.0, 1.0);
  float edgeFacing = 1.0 - facing;
  float edgeSoftness = mix(0.018, 0.045, edgeFacing);

  projection.discUv = discUv;
  projection.radius = length(discUv);
  projection.valid = 1.0;
  projection.discMask = 1.0 - smoothstep(1.0 - edgeSoftness, 1.0 + edgeSoftness, projection.radius);
  projection.edgeFacing = edgeFacing;
  projection.frontFacing = step(0.0, dot(normal, viewDirection));

  return projection;
}

vec3 applyCoinComposition(vec3 color, CoinProjection projection) {
  float radius;
  float sliceIndex;
  float canonicalAngle;
  float seamDistance;
  float sliceAngle;
  float slicePhase;
  pizzaSymmetryDataFromDiscUv(projection.discUv, radius, sliceIndex, canonicalAngle, seamDistance, sliceAngle, slicePhase);

  float halfSlice = max(sliceAngle * 0.5, 0.0001);
  float wedgeCoord = canonicalAngle / halfSlice;
  float seamShadow = (1.0 - smoothstep(0.04, 0.18, seamDistance)) * smoothstep(0.12, 0.96, radius);
  float seamGlow = (1.0 - smoothstep(0.0, 0.12, seamDistance)) * smoothstep(0.16, 0.98, radius);
  float hubMask = 1.0 - smoothstep(0.05, 0.18, radius);
  float hubRing = smoothstep(0.08, 0.12, radius) * (1.0 - smoothstep(0.15, 0.21, radius));
  float rim = smoothstep(0.82, 0.94, radius) * (1.0 - smoothstep(0.97, 1.01, radius));
  float backFace = 1.0 - projection.frontFacing;
  float sheenPhase = slicePhase + radius * (8.4 + uPizzaWarp * 1.8) - uPizzaMorph * 0.18 + uCoinSpin * 0.22;
  float rimSweep = 0.5 + 0.5 * cos(sheenPhase + wedgeCoord * 1.6);
  float discGradient = 0.84 + (0.5 + 0.5 * projection.discUv.y) * 0.1 + (0.5 + 0.5 * projection.discUv.x) * 0.04;
  float discLuma;
  vec3 background = vec3(0.005, 0.007, 0.012);
  vec3 seamColor = vec3(0.028, 0.022, 0.038) + vec3(0.08, 0.055, 0.04) * (0.18 + uPaletteEnergy * 0.12);
  vec3 rimColor =
    vec3(0.34, 0.25, 0.18) * (0.36 + projection.edgeFacing * 0.34) +
    vec3(0.92, 0.78, 0.58) * (0.04 + uCoinShimmer * 0.18 + rimSweep * 0.08);
  vec3 hubGlow = vec3(0.11, 0.12, 0.16) * (0.08 + uAmbientLift * 0.12 + projection.frontFacing * 0.06);
  vec3 discColor = boostSaturation(color, 0.98 + uCoinShimmer * 0.08);

  discColor *= discGradient * mix(0.82, 1.04, projection.frontFacing);
  discColor *= 1.0 - seamShadow * 0.16;
  discColor = mix(discColor, seamColor, seamGlow * (0.08 + projection.edgeFacing * 0.06));
  discColor += rimColor * rim;
  discColor = mix(discColor, background, hubMask * 0.62);
  discColor += hubGlow * hubRing;
  discLuma = dot(discColor, vec3(0.2126, 0.7152, 0.0722));
  discColor = mix(discColor, vec3(discLuma * 0.8, discLuma * 0.84, discLuma * 0.94), backFace * (0.14 + projection.edgeFacing * 0.08));

  return discColor;
}

vec2 backdropDiscUvFromFrag(vec2 fragCoord) {
  vec2 backdropUv = discUvFromFrag(fragCoord) - uCoinOffset * 0.28;
  float radius = length(backdropUv);
  float outerTwist = smoothstep(0.32, 2.35, radius);
  backdropUv = rotate2d(backdropUv, uPizzaBackdropRotation);

  float torsion =
    uPizzaBackdropTorsion * mix(0.08, 1.18, outerTwist) +
    (uCoinTilt.x * backdropUv.y - uCoinTilt.y * backdropUv.x) * (0.04 + outerTwist * 0.08) +
    sin(radius * (2.8 + uPizzaWarp * 0.8) - uPizzaBackdropRotation * 1.24 + uCoinPrecession * 0.9) * (0.022 + outerTwist * 0.024 + uCoinShimmer * 0.016);
  backdropUv = rotate2d(backdropUv, torsion);
  backdropUv *= 0.92 + uCoinDepth * 0.04;
  backdropUv +=
    vec2(
      cos(uPizzaBackdropRotation * 0.74 + uCoinPrecession * 0.36),
      sin(uPizzaBackdropRotation * 0.58 - uCoinFlip * 0.18)
    ) *
    (0.016 + abs(uPizzaBackdropTorsion) * 0.012 + outerTwist * 0.008 + uCoinShimmer * 0.008);

  return backdropUv;
}

vec3 applyPizzaBackdropComposition(vec3 color, vec2 discUv) {
  float radius;
  float sliceIndex;
  float canonicalAngle;
  float seamDistance;
  float sliceAngle;
  float slicePhase;
  pizzaSymmetryDataFromDiscUv(discUv, radius, sliceIndex, canonicalAngle, seamDistance, sliceAngle, slicePhase);

  float halfSlice = max(sliceAngle * 0.5, 0.0001);
  float wedgeCoord = canonicalAngle / halfSlice;
  float coreMask = 1.0 - smoothstep(0.78, 1.08, radius);
  float haloMask = smoothstep(0.68, 1.06, radius) * (1.0 - smoothstep(1.7, 2.18, radius));
  float outerFieldMask = 1.0 - smoothstep(2.25, 2.95, radius);
  float seamVeil = (1.0 - smoothstep(0.05, 0.22, seamDistance)) * smoothstep(0.18, 2.2, radius);
  float bandPhase =
    canonicalAngle * 5.2 +
    radius * (3.0 + uPizzaWarp * 1.5) -
    uPizzaMorph * 0.22 +
    slicePhase +
    uPizzaBackdropRotation * 0.42;
  float mirrorBloom = 0.5 + 0.5 * cos(bandPhase);
  float sliceBloom = pow(clamp(1.0 - abs(wedgeCoord), 0.0, 1.0), 1.35);
  float radialBands =
    0.5 +
    0.5 *
    cos((radius - 0.72) * (4.6 + uPizzaWarp * 1.4) - uPizzaMorph * 0.18 + slicePhase - uPizzaBackdropTorsion * 0.8);
  float fieldSymmetry = sliceBloom * (0.48 + radialBands * 0.52);
  float luma = dot(color, vec3(0.2126, 0.7152, 0.0722));
  vec3 background = vec3(0.006, 0.008, 0.014);
  vec3 seamColor = vec3(0.026, 0.02, 0.034) + vec3(0.08, 0.055, 0.04) * (0.16 + uPaletteEnergy * 0.08);
  vec3 ambientColor = mix(vec3(luma * (0.22 + uAmbientLift * 0.1)), color, 0.42);
  vec3 coreColor;
  vec3 haloColor;
  vec3 outerColor;
  vec3 field;

  ambientColor = boostSaturation(ambientColor, 0.74 + fieldSymmetry * 0.08);
  coreColor = ambientColor * (0.24 + uAmbientLift * 0.08 + radialBands * 0.05);
  coreColor += seamColor * seamVeil * 0.02;
  haloColor = ambientColor * (0.36 + uAmbientLift * 0.14 + fieldSymmetry * 0.08 + radialBands * 0.04);
  haloColor += seamColor * (0.04 + mirrorBloom * 0.03 + sliceBloom * 0.02);
  outerColor = mix(vec3(luma * 0.18), ambientColor, 0.38) * (0.22 + radialBands * 0.08 + uAmbientLift * 0.08);
  outerColor += seamColor * sliceBloom * (0.02 + mirrorBloom * 0.015);

  field = background;
  field = mix(field, outerColor, outerFieldMask * 0.96);
  field = mix(field, haloColor, haloMask * 0.54);
  field = mix(field, coreColor, coreMask * 0.32);
  field += ambientColor * seamVeil * (0.018 + fieldSymmetry * 0.014);

  return field;
}

vec3 shadeCoinBackdropAtFrag(vec2 fragCoord) {
  vec2 backdropUv = backdropDiscUvFromFrag(fragCoord);
  float radius = length(backdropUv);
  float continuationMix =
    clamp(pizzaContinuationMix(radius) * 0.88 + smoothstep(1.34, 2.32, radius) * 0.12, 0.0, 1.0);
  vec2 paletteUv;
  float paletteOffset;
  FractalSample sample = samplePizzaField(backdropUv, continuationMix, paletteUv, paletteOffset);
  float motionLag =
    sin(uPizzaBackdropRotation * 0.62 - uPizzaBackdropTorsion * 0.8 + uCoinPrecession * 0.18) * 0.012 +
    uPizzaBackdropTorsion * 0.01;
  vec3 baseColor = colorize(sample, paletteUv * 0.86 + backdropUv * 0.08, paletteOffset + motionLag);
  return applyPizzaBackdropComposition(baseColor, backdropUv);
}

vec3 sampleCoinDiscColorAtFrag(vec2 fragCoord) {
  CoinProjection projection = projectCoinDisc(fragCoord);

  if (projection.valid < 0.5 || projection.discMask <= 0.0001) {
    return vec3(0.004, 0.006, 0.011);
  }

  vec2 paletteUv;
  float paletteOffset;
  FractalSample sample = samplePizzaField(projection.discUv, 0.0, paletteUv, paletteOffset);
  return applyCoinComposition(colorize(sample, paletteUv, paletteOffset), projection);
}

vec3 shadeCoinAtFrag(vec2 fragCoord) {
  CoinProjection projection = projectCoinDisc(fragCoord);
  vec3 color = shadeCoinBackdropAtFrag(fragCoord);
  float coinInfluence = 1.0 - smoothstep(1.18 + projection.edgeFacing * 0.18, 1.36 + projection.edgeFacing * 0.28, projection.radius);
  float contactShadow = coinInfluence * (1.0 - smoothstep(0.92, 1.18 + projection.edgeFacing * 0.18, projection.radius));

  color *= 1.0 - contactShadow * (0.05 + projection.edgeFacing * 0.05);

  if (projection.discMask > 0.0001) {
    vec3 discColor = sampleCoinDiscColorAtFrag(fragCoord);

    if (uStableAA > 0.01) {
      vec3 paired = 0.5 * (
        sampleCoinDiscColorAtFrag(fragCoord + vec2(-0.24, 0.24)) +
        sampleCoinDiscColorAtFrag(fragCoord + vec2(0.24, -0.24))
      );
      discColor = mix(discColor, paired, clamp((0.16 + uStableAA * 0.2) * projection.discMask, 0.0, 0.44));
    }

    color = mix(color, discColor, projection.discMask);
  }

  float rimSweep = 0.5 + 0.5 * cos(projection.discUv.y * 7.0 - projection.discUv.x * 4.0 + uPizzaMorph * 0.22 + uCoinSpin * 0.36);
  float outerRim =
    smoothstep(1.0, 1.04 + projection.edgeFacing * 0.05, projection.radius) *
    (1.0 - smoothstep(1.1 + projection.edgeFacing * 0.12, 1.24 + projection.edgeFacing * 0.24, projection.radius));
  float innerRim =
    smoothstep(0.82, 0.98, projection.radius) *
    (1.0 - smoothstep(0.99, 1.04, projection.radius));
  float edgeDarken = smoothstep(0.86, 1.0, projection.radius) * mix(0.04, 0.2, projection.edgeFacing);
  vec3 rimColor =
    vec3(0.2, 0.16, 0.12) * (0.24 + projection.edgeFacing * 0.42) +
    vec3(0.95, 0.82, 0.6) * (0.04 + uCoinShimmer * 0.2 + rimSweep * 0.08);
  vec3 outerGlowColor =
    vec3(0.22, 0.17, 0.14) * (0.12 + projection.edgeFacing * 0.24) +
    vec3(0.88, 0.76, 0.58) * (0.02 + uCoinShimmer * 0.12);

  color = mix(color, color * 0.82, edgeDarken * projection.discMask);
  color += rimColor * innerRim * (0.08 + projection.edgeFacing * 0.18) * coinInfluence;
  color += outerGlowColor * outerRim * (0.08 + projection.edgeFacing * 0.24 + uCoinShimmer * 0.1) * coinInfluence;

  return color;
}

void main() {
  vec2 frag = gl_FragCoord.xy;

  if (uLayoutMode > 1.5) {
    gl_FragColor = vec4(shadeCoinAtFrag(frag), 1.0);
    return;
  }

  vec2 paletteUv;
  float paletteOffset;
  FractalSample centerSample = sampleAtFrag(frag, paletteUv, paletteOffset);
  vec3 color = colorize(centerSample, paletteUv, paletteOffset);

  if (uStableAA > 0.01) {
    vec3 paired = 0.5 * (
      shadeAtFrag(frag + vec2(-0.28, 0.28)) +
      shadeAtFrag(frag + vec2(0.28, -0.28))
    );
    color = mix(color, paired, 0.24 + uStableAA * 0.26);

    float edgeMetric = sampleBoundaryMetric(frag, centerSample);
    float boundaryWeight = clamp(edgeMetric * uStableAA * 1.1, 0.0, 1.0);

    if (boundaryWeight > 0.06) {
      vec3 refined = 0.25 * (
        shadeAtFrag(frag + vec2(-0.38, -0.12)) +
        shadeAtFrag(frag + vec2(0.12, 0.38)) +
        shadeAtFrag(frag + vec2(0.38, -0.28)) +
        shadeAtFrag(frag + vec2(-0.12, 0.28))
      );
      color = mix(color, refined, clamp(boundaryWeight * (0.52 + uStableAA * 0.28), 0.0, 0.88));
    }
  }

  if (uLayoutMode > 0.5) {
    color = applyPizzaComposition(color, frag);
  }

  gl_FragColor = vec4(color, 1.0);
}
`;

const COMPOSITE_FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uCurrentTexture;
uniform sampler2D uHistoryTexture;
uniform vec2 uCurrentTexelSize;
uniform vec2 uCurrentCenter;
uniform float uCurrentScale;
uniform float uCurrentRotation;
uniform float uCurrentAspect;
uniform vec2 uPreviousCenter;
uniform float uPreviousScale;
uniform float uPreviousRotation;
uniform float uPreviousAspect;
uniform float uHistoryBlend;

vec2 viewToComplex(vec2 uv, vec2 center, float scale, float rotation, float aspect) {
  vec2 centered = uv - 0.5;
  centered.x *= aspect;
  float cosRotation = cos(rotation);
  float sinRotation = sin(rotation);
  vec2 rotated = vec2(
    centered.x * cosRotation - centered.y * sinRotation,
    centered.x * sinRotation + centered.y * cosRotation
  ) * scale;
  return center + rotated;
}

vec2 complexToUv(vec2 point, vec2 center, float scale, float rotation, float aspect) {
  vec2 delta = (point - center) / max(scale, 0.000001);
  float cosRotation = cos(rotation);
  float sinRotation = sin(rotation);
  vec2 unrotated = vec2(
    delta.x * cosRotation + delta.y * sinRotation,
    -delta.x * sinRotation + delta.y * cosRotation
  );
  unrotated.x /= max(aspect, 0.000001);
  return unrotated + 0.5;
}

void main() {
  vec3 current = texture2D(uCurrentTexture, vUv).rgb;
  vec2 worldPoint = viewToComplex(vUv, uCurrentCenter, uCurrentScale, uCurrentRotation, uCurrentAspect);
  vec2 previousUv = complexToUv(worldPoint, uPreviousCenter, uPreviousScale, uPreviousRotation, uPreviousAspect);
  vec2 clampedUv = clamp(previousUv, 0.0, 1.0);
  float valid =
    step(0.0, previousUv.x) *
    step(0.0, previousUv.y) *
    step(previousUv.x, 1.0) *
    step(previousUv.y, 1.0);
  vec3 history = texture2D(uHistoryTexture, clampedUv).rgb;

  // Clamp reprojected history into the local current neighborhood to cut ghost trails.
  vec2 texel = uCurrentTexelSize * 1.25;
  vec3 sampleXPos = texture2D(uCurrentTexture, clamp(vUv + vec2(texel.x, 0.0), 0.0, 1.0)).rgb;
  vec3 sampleXNeg = texture2D(uCurrentTexture, clamp(vUv - vec2(texel.x, 0.0), 0.0, 1.0)).rgb;
  vec3 sampleYPos = texture2D(uCurrentTexture, clamp(vUv + vec2(0.0, texel.y), 0.0, 1.0)).rgb;
  vec3 sampleYNeg = texture2D(uCurrentTexture, clamp(vUv - vec2(0.0, texel.y), 0.0, 1.0)).rgb;
  vec3 neighborhoodMin = min(current, min(min(sampleXPos, sampleXNeg), min(sampleYPos, sampleYNeg)));
  vec3 neighborhoodMax = max(current, max(max(sampleXPos, sampleXNeg), max(sampleYPos, sampleYNeg)));
  vec3 clampedHistory = clamp(history, neighborhoodMin - 0.045, neighborhoodMax + 0.045);

  float historyDelta = length(clampedHistory - current);
  float colorConfidence = 1.0 - smoothstep(0.05, 0.3, historyDelta);
  float blend = uHistoryBlend * valid * colorConfidence;

  gl_FragColor = vec4(mix(current, clampedHistory, blend), 1.0);
}
`;

const PRESENT_FRAGMENT_SHADER_SOURCE = `
precision highp float;

varying vec2 vUv;

uniform sampler2D uSourceTexture;

void main() {
  gl_FragColor = texture2D(uSourceTexture, vUv);
}
`;

type ComplexPoint = {
  x: number;
  y: number;
};
type Vector3 = {
  x: number;
  y: number;
  z: number;
};

type FractalViewport = {
  center: ComplexPoint;
  scale: number;
  rotation: number;
};

type FractalPoi = {
  id: string;
  center: ComplexPoint;
  scale: number;
  bend: number;
  rotation: number;
  bank: number;
  hueOffset: number;
  localRadius: number;
  railPull: number;
  linger: number;
  interestBias: number;
  outbound: string[];
};

type MutableFractalSample = {
  escaped: boolean;
  smooth: number;
  trap: number;
};

type FractalFamily = {
  id: string;
  pointsOfInterest: FractalPoi[];
  getPoiIndexById: (id: string) => number;
  getStartViewport: () => FractalViewport;
  getMaxIterations: (scale: number, qualityBias?: number) => number;
  sample: (
    pointX: number,
    pointY: number,
    maxIterations: number,
    out: MutableFractalSample,
    parameters?: FractalParameters
  ) => void;
};

type AudioResponseState = {
  bassDrive: number;
  midDrive: number;
  highDrive: number;
  spectralFlux: number;
  noveltySmoothed: number;
  energy: number;
  temperature: number;
  surge: number;
  ambient: number;
  zoom: number;
  bend: number;
  palette: number;
};

type TraversalMode = "explore" | "dissolve" | "transit" | "reveal";
type VoidTransitionStyle = "fade" | "zoom" | "turn";
type PizzaSymmetryGroup = "cyclic" | "dihedral";
type CoinMotionPhase = "idle" | "launch" | "flip" | "settle";
type PizzaFieldMotionState = {
  rotation: number;
  angularVelocity: number;
  targetVelocity: number;
  backdropLagRotation: number;
  backdropTorsion: number;
  backdropTorsionVelocity: number;
  settle: number;
  lastKickSignal: number;
};
type PizzaSymmetryState = {
  group: PizzaSymmetryGroup;
  order: number;
  modeIndex: number;
  strength: number;
};

type CoinMotionState = {
  phase: CoinMotionPhase;
  phaseElapsed: number;
  phaseDuration: number;
  tiltX: number;
  tiltY: number;
  targetTiltX: number;
  targetTiltY: number;
  spin: number;
  spinVelocity: number;
  precession: number;
  wobble: number;
  wobblePhase: number;
  flip: number;
  flipVelocity: number;
  lift: number;
  offsetX: number;
  offsetY: number;
  shimmer: number;
  settle: number;
  impulseCooldown: number;
  lastTriggerSignal: number;
};

type TraversalState = {
  currentIndex: number;
  nextIndex: number;
  previousIndex: number;
  recentPoiIndices: number[];
  progress: number;
  segmentDuration: number;
  pathSpeed: number;
  bendPhase: number;
  driftPhase: number;
  palettePhase: number;
  segmentSeed: number;
  segmentEscape: number;
  desiredCamera: FractalViewport;
  camera: FractalViewport;
  mode: TraversalMode;
  modeElapsed: number;
  modeDuration: number;
  transitionCooldownUntil: number;
  transitionTargetIndex: number;
  transitionTargetNextIndex: number;
  transitionStyle: VoidTransitionStyle;
  voidMix: number;
  voidCollapse: number;
  transitionScaleMultiplier: number;
  transitionRotationOffset: number;
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

type FractalParameters = {
  power: number;
  trapMix: number;
  trapScale: number;
  paletteBias: number;
};

type FractalPreset = FractalParameters & {
  id: string;
  intensity: number;
};

type FractalMutationState = {
  anchorPresetIndex: number;
  variantPresetIndex: number;
  recentVariantIndices: number[];
  cyclePhase: number;
  restTimeRemaining: number;
  desiredDepth: number;
  depth: number;
  desiredSpeed: number;
  speed: number;
  parameters: FractalParameters;
};

type FractalUniforms = {
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
  structurePower: WebGLUniformLocation | null;
  trapMix: WebGLUniformLocation | null;
  trapScale: WebGLUniformLocation | null;
  paletteBias: WebGLUniformLocation | null;
  voidFade: WebGLUniformLocation | null;
  voidCollapse: WebGLUniformLocation | null;
  layoutMode: WebGLUniformLocation | null;
  sliceCount: WebGLUniformLocation | null;
  pizzaWarp: WebGLUniformLocation | null;
  pizzaSpin: WebGLUniformLocation | null;
  pizzaMorph: WebGLUniformLocation | null;
  symmetryGroup: WebGLUniformLocation | null;
  symmetryMode: WebGLUniformLocation | null;
  symmetryStrength: WebGLUniformLocation | null;
  coinTilt: WebGLUniformLocation | null;
  coinSpin: WebGLUniformLocation | null;
  coinPrecession: WebGLUniformLocation | null;
  coinFlip: WebGLUniformLocation | null;
  coinDepth: WebGLUniformLocation | null;
  coinRadius: WebGLUniformLocation | null;
  coinOffset: WebGLUniformLocation | null;
  coinSpinAxis: WebGLUniformLocation | null;
  coinShimmer: WebGLUniformLocation | null;
  pizzaBackdropRotation: WebGLUniformLocation | null;
  pizzaBackdropTorsion: WebGLUniformLocation | null;
};

type CompositeUniforms = {
  currentTexture: WebGLUniformLocation | null;
  historyTexture: WebGLUniformLocation | null;
  currentTexelSize: WebGLUniformLocation | null;
  currentCenter: WebGLUniformLocation | null;
  currentScale: WebGLUniformLocation | null;
  currentRotation: WebGLUniformLocation | null;
  currentAspect: WebGLUniformLocation | null;
  previousCenter: WebGLUniformLocation | null;
  previousScale: WebGLUniformLocation | null;
  previousRotation: WebGLUniformLocation | null;
  previousAspect: WebGLUniformLocation | null;
  historyBlend: WebGLUniformLocation | null;
};

type PresentUniforms = {
  sourceTexture: WebGLUniformLocation | null;
};

type RenderTarget = {
  framebuffer: WebGLFramebuffer | null;
  texture: WebGLTexture | null;
  width: number;
  height: number;
};

type RenderState = {
  canvas: HTMLCanvasElement | null;
  gl: WebGLRenderingContext | null;
  fractalProgram: WebGLProgram | null;
  compositeProgram: WebGLProgram | null;
  presentProgram: WebGLProgram | null;
  buffer: WebGLBuffer | null;
  fractalUniforms: FractalUniforms | null;
  compositeUniforms: CompositeUniforms | null;
  presentUniforms: PresentUniforms | null;
  currentTarget: RenderTarget;
  historyTargets: [RenderTarget, RenderTarget];
  historyReadIndex: number;
  historyValid: boolean;
  displayWidth: number;
  displayHeight: number;
  dpr: number;
  lastCamera: FractalViewport | null;
  historyCamera: FractalViewport | null;
  historyFractalParameters: FractalParameters | null;
  motion: number;
  refinement: number;
};

const canvas = ref<HTMLCanvasElement | null>(null);
const viewport = useViewport();
const sources = useSources();
const settings = useVisualizerSettings();
const audioFeatures = useAudioFeatures();
const pulse = usePulse();
const TAU = Math.PI * 2;

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start: number, end: number, amount: number) {
  return start + (end - start) * amount;
}

function normalizeVector3(vector: Vector3): Vector3 {
  const length = Math.hypot(vector.x, vector.y, vector.z);

  if (length <= 0.000001) {
    return { x: 0, y: 0, z: 1 };
  }

  return {
    x: vector.x / length,
    y: vector.y / length,
    z: vector.z / length,
  };
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

function wrapAngle(angle: number) {
  let wrapped = angle % TAU;

  if (wrapped > Math.PI) wrapped -= TAU;
  if (wrapped < -Math.PI) wrapped += TAU;

  return wrapped;
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

function copyFractalParameters(parameters: FractalParameters): FractalParameters {
  return {
    power: parameters.power,
    trapMix: parameters.trapMix,
    trapScale: parameters.trapScale,
    paletteBias: parameters.paletteBias,
  };
}

function lerpFractalParameters(from: FractalParameters, to: FractalParameters, amount: number): FractalParameters {
  return {
    power: lerp(from.power, to.power, amount),
    trapMix: lerp(from.trapMix, to.trapMix, amount),
    trapScale: lerp(from.trapScale, to.trapScale, amount),
    paletteBias: lerp(from.paletteBias, to.paletteBias, amount),
  };
}

function createRenderTargetState(): RenderTarget {
  return {
    framebuffer: null,
    texture: null,
    width: 0,
    height: 0,
  };
}

const VOID_TRANSITION_CONFIG = {
  // These thresholds keep void transitions rare: they only start after the framing
  // search has been genuinely stuck in a flat region for a while.
  triggerLowInterestTime: 1.9,
  triggerCurrentScore: 0.43,
  triggerBestScore: 0.52,
  initialGuardMs: 11_000,
  cooldownMs: {
    min: 22_000,
    max: 32_000,
  },
  dissolveDuration: {
    min: 1.3,
    max: 2.1,
  },
  transitDuration: {
    min: 0.42,
    max: 0.68,
  },
  revealDuration: {
    min: 1.9,
    max: 2.8,
  },
} as const;

function getNowMs() {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

// Anchor preset plus a few curated variants so v1 mutation stays cinematic instead of chaotic.
const FRACTAL_PRESETS: FractalPreset[] = [
  {
    id: "anchor",
    power: 2,
    trapMix: 0.28,
    trapScale: 1,
    paletteBias: 0,
    intensity: 0,
  },
  {
    id: "petal",
    power: 2.22,
    trapMix: 0.44,
    trapScale: 0.94,
    paletteBias: 0.035,
    intensity: 0.34,
  },
  {
    id: "flare",
    power: 2.56,
    trapMix: 0.62,
    trapScale: 0.88,
    paletteBias: 0.08,
    intensity: 0.62,
  },
  {
    id: "crown",
    power: 2.94,
    trapMix: 0.82,
    trapScale: 0.8,
    paletteBias: 0.14,
    intensity: 0.9,
  },
];

function createMandelbrotFamily(): FractalFamily {
  // The traversal now rides a small hand-picked POI network. Local scanning can
  // polish framing near each stop, but the macro flight stays on these rails.
  const pointsOfInterest: FractalPoi[] = [
    {
      id: "origin",
      center: { x: -0.5, y: 0 },
      scale: 2.35,
      bend: 0.1,
      rotation: -0.02,
      bank: -0.02,
      hueOffset: 0.02,
      localRadius: 0.08,
      railPull: 0.9,
      linger: 1.04,
      interestBias: 0.08,
      outbound: ["seahorse-valley", "antenna-root", "north-ridge"],
    },
    {
      id: "seahorse-valley",
      center: { x: -0.785, y: 0.125 },
      scale: 0.52,
      bend: 0.18,
      rotation: 0.03,
      bank: 0.04,
      hueOffset: 0.14,
      localRadius: 0.11,
      railPull: 0.83,
      linger: 1,
      interestBias: 0.14,
      outbound: ["seahorse-detail", "spiral-shelf", "origin"],
    },
    {
      id: "seahorse-detail",
      center: { x: -0.743643887, y: 0.131825904 },
      scale: 0.16,
      bend: -0.14,
      rotation: 0.06,
      bank: 0.07,
      hueOffset: 0.24,
      localRadius: 0.13,
      railPull: 0.8,
      linger: 1.08,
      interestBias: 0.2,
      outbound: ["mini-broccoli", "spiral-shelf", "seahorse-valley"],
    },
    {
      id: "mini-broccoli",
      center: { x: -0.744935, y: 0.13419 },
      scale: 0.038,
      bend: 0.22,
      rotation: 0.09,
      bank: 0.1,
      hueOffset: 0.36,
      localRadius: 0.15,
      railPull: 0.78,
      linger: 1.16,
      interestBias: 0.26,
      outbound: ["seahorse-detail", "spiral-shelf", "origin"],
    },
    {
      id: "antenna-root",
      center: { x: -1.25066, y: 0.02012 },
      scale: 0.18,
      bend: 0.15,
      rotation: 0.04,
      bank: 0.03,
      hueOffset: 0.6,
      localRadius: 0.11,
      railPull: 0.84,
      linger: 1,
      interestBias: 0.16,
      outbound: ["left-claw", "origin", "spiral-shelf"],
    },
    {
      id: "left-claw",
      center: { x: -1.76878, y: 0.00174 },
      scale: 0.34,
      bend: -0.18,
      rotation: -0.05,
      bank: -0.06,
      hueOffset: 0.68,
      localRadius: 0.1,
      railPull: 0.87,
      linger: 0.96,
      interestBias: 0.1,
      outbound: ["antenna-root", "origin"],
    },
    {
      id: "north-ridge",
      center: { x: -0.15894, y: 1.03419 },
      scale: 0.24,
      bend: 0.18,
      rotation: 0.05,
      bank: 0.05,
      hueOffset: 0.86,
      localRadius: 0.12,
      railPull: 0.82,
      linger: 1.02,
      interestBias: 0.14,
      outbound: ["origin", "spiral-shelf", "seahorse-valley"],
    },
    {
      id: "spiral-shelf",
      center: { x: -0.7412, y: 0.1587 },
      scale: 0.12,
      bend: -0.16,
      rotation: 0.08,
      bank: 0.08,
      hueOffset: 0.94,
      localRadius: 0.14,
      railPull: 0.79,
      linger: 1.06,
      interestBias: 0.2,
      outbound: ["seahorse-valley", "north-ridge", "origin", "antenna-root"],
    },
  ];
  const poiIndexById = new Map(pointsOfInterest.map((poi, index) => [poi.id, index]));

  return {
    id: "mandelbrot",
    pointsOfInterest,
    getPoiIndexById(id: string) {
      return poiIndexById.get(id) ?? 0;
    },
    getStartViewport() {
      const first = pointsOfInterest[0];
      return {
        center: { x: first.center.x, y: first.center.y },
        scale: first.scale,
        rotation: first.rotation,
      };
    },
    getMaxIterations(scale: number, qualityBias = 0) {
      const zoomDepth = Math.max(0, Math.log2(2.35 / Math.max(scale, 0.000001)));
      return clamp(Math.round(170 + zoomDepth * 92 + qualityBias * 72), 170, 720);
    },
    sample(pointX: number, pointY: number, maxIterations: number, out: MutableFractalSample, parameters?: FractalParameters) {
      const structurePower = Math.max(parameters?.power ?? 2, 1.01);
      const trapMix = clamp(parameters?.trapMix ?? 0.28, 0, 1);
      const trapScale = Math.max(parameters?.trapScale ?? 1, 0.0001);
      let zx = 0;
      let zy = 0;
      let zxSquared = 0;
      let zySquared = 0;
      let trap = Number.POSITIVE_INFINITY;
      let iteration = 0;

      for (; iteration < maxIterations && zxSquared + zySquared <= 16; iteration++) {
        const radiusSquared = zxSquared + zySquared;
        let nextX = 0;
        let nextY = 0;

        if (radiusSquared > 0.00000001) {
          const radius = Math.sqrt(radiusSquared);
          const angle = Math.atan2(zy, zx);
          const poweredRadius = Math.pow(radius, structurePower);
          const poweredAngle = angle * structurePower;
          nextX = Math.cos(poweredAngle) * poweredRadius;
          nextY = Math.sin(poweredAngle) * poweredRadius;
        }

        zy = nextY + pointY;
        zx = nextX + pointX;
        zxSquared = zx * zx;
        zySquared = zy * zy;
        const crossTrap = Math.abs(zx * zy) * lerp(1.08, 0.84, trapMix);
        const stripeTrap = Math.abs(zx) + Math.abs(zy) * lerp(0.24, 0.58, trapMix);
        const ringTrap = Math.abs(Math.hypot(zx, zy) - (0.38 + trapMix * 0.42));
        trap = Math.min(trap, Math.min(lerp(crossTrap, stripeTrap, trapMix), ringTrap * (0.84 + trapMix * 0.36)) * trapScale);
      }

      if (iteration >= maxIterations) {
        out.escaped = false;
        out.smooth = maxIterations;
        out.trap = trap;
        return;
      }

      const radius = Math.sqrt(zxSquared + zySquared);
      out.escaped = true;
      out.smooth = iteration + 1 - Math.log(Math.max(Math.log(Math.max(radius, 1.0001)), 0.0001)) / Math.log(structurePower);
      out.trap = trap;
    },
  };
}

function createAudioState(): AudioResponseState {
  return {
    bassDrive: 0,
    midDrive: 0,
    highDrive: 0,
    spectralFlux: 0,
    noveltySmoothed: 0,
    energy: 0,
    temperature: 0.5,
    surge: 0,
    ambient: 0.16,
    zoom: 0.12,
    bend: 0.2,
    palette: 0.18,
  };
}

function createTraversalState(fractalFamily: FractalFamily): TraversalState {
  const camera = fractalFamily.getStartViewport();
  const startPoi = fractalFamily.pointsOfInterest[0];
  const nextIndex = fractalFamily.getPoiIndexById(startPoi.outbound[0] ?? startPoi.id);
  const now = getNowMs();
  return {
    currentIndex: 0,
    nextIndex,
    previousIndex: 0,
    recentPoiIndices: [0],
    progress: 0,
    segmentDuration: calculateSegmentDuration(fractalFamily.pointsOfInterest[0], fractalFamily.pointsOfInterest[nextIndex]),
    pathSpeed: 1,
    bendPhase: 0,
    driftPhase: 0,
    palettePhase: fractalFamily.pointsOfInterest[0].hueOffset,
    segmentSeed: 0.37,
    segmentEscape: 0,
    desiredCamera: copyViewport(camera),
    camera,
    mode: "explore",
    modeElapsed: 0,
    modeDuration: 0,
    transitionCooldownUntil: now + VOID_TRANSITION_CONFIG.initialGuardMs,
    transitionTargetIndex: nextIndex,
    transitionTargetNextIndex: nextIndex,
    transitionStyle: "fade",
    voidMix: 0,
    voidCollapse: 0,
    transitionScaleMultiplier: 1,
    transitionRotationOffset: 0,
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

function createFractalMutationState(): FractalMutationState {
  return {
    anchorPresetIndex: 0,
    variantPresetIndex: 1,
    recentVariantIndices: [1],
    cyclePhase: 0,
    restTimeRemaining: 0.18,
    desiredDepth: 0.22,
    depth: 0.22,
    desiredSpeed: 0.2,
    speed: 0.2,
    parameters: copyFractalParameters(FRACTAL_PRESETS[0]),
  };
}

function createCoinMotionState(): CoinMotionState {
  return {
    phase: "idle",
    phaseElapsed: 0,
    phaseDuration: 1,
    tiltX: 0.18,
    tiltY: -0.24,
    targetTiltX: 0.18,
    targetTiltY: -0.24,
    spin: 0,
    spinVelocity: 0.42,
    precession: 0.08,
    wobble: 0.08,
    wobblePhase: 0,
    flip: 0,
    flipVelocity: 0,
    lift: 0.06,
    offsetX: 0,
    offsetY: -0.02,
    shimmer: 0.18,
    settle: 1,
    impulseCooldown: 0.12,
    lastTriggerSignal: 0,
  };
}

function createPizzaFieldMotionState(): PizzaFieldMotionState {
  return {
    rotation: 0,
    angularVelocity: 0.18,
    targetVelocity: 0.18,
    backdropLagRotation: 0,
    backdropTorsion: 0,
    backdropTorsionVelocity: 0,
    settle: 1,
    lastKickSignal: 0,
  };
}

const family = createMandelbrotFamily();
const renderState: RenderState = {
  canvas: null,
  gl: null,
  fractalProgram: null,
  compositeProgram: null,
  presentProgram: null,
  buffer: null,
  fractalUniforms: null,
  compositeUniforms: null,
  presentUniforms: null,
  currentTarget: createRenderTargetState(),
  historyTargets: [createRenderTargetState(), createRenderTargetState()],
  historyReadIndex: 0,
  historyValid: false,
  displayWidth: 0,
  displayHeight: 0,
  dpr: 1,
  lastCamera: null,
  historyCamera: null,
  historyFractalParameters: null,
  motion: 0,
  refinement: 0,
};

const audio = createAudioState();
const traversal = createTraversalState(family);
const interest = createInterestState();
const fractalMutation = createFractalMutationState();
const coinMotion = createCoinMotionState();
const pizzaFieldMotion = createPizzaFieldMotionState();
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

const fractalLayoutMode = computed<FractalTraverseLayoutMode>(() => {
  return settings.fractalTraverseLayoutMode ?? "full-frame";
});

const isPizzaLayout = computed(() => {
  return fractalLayoutMode.value === "pizza-kaleido" || fractalLayoutMode.value === "pizza-coin";
});

const isCoinLayout = computed(() => {
  return fractalLayoutMode.value === "pizza-coin";
});

const pizzaSliceCount = computed(() => {
  return clamp(Math.round(Number(settings.fractalTraverseSliceCount) || 8), 6, 12);
});

function getPizzaSymmetryState(): PizzaSymmetryState {
  const order = pizzaSliceCount.value;
  const maxModeIndex = Math.max(1, Math.floor(order * 0.5) - 1);

  return {
    group: "dihedral",
    order,
    modeIndex: clamp(2, 1, maxModeIndex),
    // Strength lets audio lean on the symmetry warp without breaking the group structure.
    strength: clamp(0.74 + audio.highDrive * 0.08 + audio.spectralFlux * 0.12, 0.68, 0.94),
  };
}

function calculateSegmentDuration(from: FractalPoi, to: FractalPoi) {
  // Blend spatial and zoom distance so transitions read as travel, not cuts.
  const spatialDistance = distance(from.center, to.center);
  const zoomDistance = Math.abs(Math.log(Math.max(from.scale, 0.000001) / Math.max(to.scale, 0.000001)));
  const lingerBias = lerp(from.linger, to.linger, 0.5);
  return clamp((8.9 + spatialDistance * 5.2 + zoomDistance * 3.9) * lingerBias, 8.8, 22.5);
}

function resetTemporalState() {
  renderState.lastCamera = null;
  renderState.historyCamera = null;
  renderState.historyFractalParameters = null;
  renderState.historyValid = false;
  renderState.historyReadIndex = 0;
  renderState.motion = 0;
  renderState.refinement = 0;
}

function resetAudioState() {
  audio.bassDrive = 0;
  audio.midDrive = 0;
  audio.highDrive = 0;
  audio.spectralFlux = 0;
  audio.noveltySmoothed = 0;
  audio.energy = 0;
  audio.temperature = 0.5;
  audio.surge = 0;
  audio.ambient = 0.16;
  audio.zoom = 0.12;
  audio.bend = 0.2;
  audio.palette = 0.18;
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

function resetFractalMutationState() {
  fractalMutation.anchorPresetIndex = 0;
  fractalMutation.variantPresetIndex = 1;
  fractalMutation.recentVariantIndices = [1];
  fractalMutation.cyclePhase = 0;
  fractalMutation.restTimeRemaining = 0.18;
  fractalMutation.desiredDepth = 0.22;
  fractalMutation.depth = 0.22;
  fractalMutation.desiredSpeed = 0.2;
  fractalMutation.speed = 0.2;
  fractalMutation.parameters = copyFractalParameters(FRACTAL_PRESETS[0]);
}

function resetCoinMotionState() {
  Object.assign(coinMotion, createCoinMotionState());
}

function resetPizzaFieldMotionState() {
  Object.assign(pizzaFieldMotion, createPizzaFieldMotionState());
}

function resetTraversalState() {
  const start = family.getStartViewport();
  const firstPoi = family.pointsOfInterest[0];
  const nextIndex = family.getPoiIndexById(firstPoi.outbound[0] ?? firstPoi.id);
  const now = getNowMs();
  traversal.currentIndex = 0;
  traversal.nextIndex = nextIndex;
  traversal.previousIndex = 0;
  traversal.recentPoiIndices = [0];
  traversal.progress = 0;
  traversal.segmentDuration = calculateSegmentDuration(family.pointsOfInterest[0], family.pointsOfInterest[nextIndex]);
  traversal.pathSpeed = 1;
  traversal.bendPhase = 0;
  traversal.driftPhase = 0;
  traversal.palettePhase = family.pointsOfInterest[0].hueOffset;
  traversal.segmentSeed = 0.37;
  traversal.segmentEscape = 0;
  traversal.desiredCamera = copyViewport(start);
  traversal.camera = start;
  traversal.mode = "explore";
  traversal.modeElapsed = 0;
  traversal.modeDuration = 0;
  traversal.transitionCooldownUntil = now + VOID_TRANSITION_CONFIG.initialGuardMs;
  traversal.transitionTargetIndex = nextIndex;
  traversal.transitionTargetNextIndex = nextIndex;
  traversal.transitionStyle = "fade";
  traversal.voidMix = 0;
  traversal.voidCollapse = 0;
  traversal.transitionScaleMultiplier = 1;
  traversal.transitionRotationOffset = 0;
  resetTemporalState();
}

function setTraversalMode(mode: TraversalMode, duration: number) {
  traversal.mode = mode;
  traversal.modeElapsed = 0;
  traversal.modeDuration = duration;
}

function createPoiViewport(poi: FractalPoi, scaleMultiplier = 1, rotationOffset = 0): FractalViewport {
  return {
    center: {
      x: poi.center.x,
      y: poi.center.y,
    },
    scale: clamp(poi.scale * scaleMultiplier, 0.02, 3.2),
    rotation: poi.rotation + poi.bank * 0.35 + rotationOffset,
  };
}

function chooseVoidTransitionStyle(): VoidTransitionStyle {
  const excitement = clamp(audio.spectralFlux * 0.68 + audio.noveltySmoothed * 0.32, 0, 1);

  if (excitement > 0.7) return "turn";
  if (audio.bassDrive > audio.highDrive + 0.08) return "zoom";
  return "fade";
}

function pickVoidTransitionTarget(aspectRatio: number) {
  const currentPoi = family.pointsOfInterest[traversal.currentIndex];
  const adventurousness = clamp(audio.spectralFlux * 0.48 + audio.noveltySmoothed * 0.32 + audio.bassDrive * 0.2, 0, 1);
  let bestIndex = traversal.nextIndex;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let candidateIndex = 0; candidateIndex < family.pointsOfInterest.length; candidateIndex++) {
    if (candidateIndex === traversal.currentIndex) continue;

    const candidatePoi = family.pointsOfInterest[candidateIndex];
    const metrics = evaluateInterest(candidatePoi.center, clamp(candidatePoi.scale * 1.04, 0.02, 3.2), aspectRatio);
    const spatialJump = clamp(Math.log1p(distance(currentPoi.center, candidatePoi.center) * 4.2) / 2.3, 0, 1);
    const zoomJump = clamp(
      Math.abs(Math.log(Math.max(currentPoi.scale, 0.000001) / Math.max(candidatePoi.scale, 0.000001))) / 3.2,
      0,
      1
    );
    const bendContrast = clamp(Math.abs(candidatePoi.bend - currentPoi.bend) * 2.2, 0, 1);
    const revisitIndex = traversal.recentPoiIndices.lastIndexOf(candidateIndex);
    const revisitPenalty =
      revisitIndex >= 0 ? clamp(0.34 - (traversal.recentPoiIndices.length - 1 - revisitIndex) * 0.08, 0.08, 0.34) : 0;
    const branchPenalty = currentPoi.outbound.includes(candidatePoi.id) ? 0.06 : 0;
    const authoredJumpBonus = adventurousness * clamp(zoomJump * 0.14 + bendContrast * 0.1, 0, 0.2);
    const score =
      metrics.score * 0.74 +
      candidatePoi.interestBias +
      spatialJump * 0.24 +
      zoomJump * 0.12 +
      authoredJumpBonus -
      revisitPenalty -
      branchPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = candidateIndex;
    }
  }

  const previousIndex = traversal.currentIndex;
  const targetNextIndex = pickNextPoiIndex(bestIndex, previousIndex, aspectRatio);
  return {
    targetIndex: bestIndex,
    targetNextIndex,
  };
}

function enterTransitRetarget(now: number, aspectRatio: number) {
  const sourceIndex = traversal.currentIndex;
  const targetIndex = traversal.transitionTargetIndex;
  const targetPoi = family.pointsOfInterest[targetIndex];
  const targetNextIndex =
    traversal.transitionTargetNextIndex !== targetIndex
      ? traversal.transitionTargetNextIndex
      : pickNextPoiIndex(targetIndex, sourceIndex, aspectRatio);
  const arrivalScaleMultiplier =
    traversal.transitionStyle === "zoom" ? 1.68 : traversal.transitionStyle === "turn" ? 1.28 : 1.14;
  const arrivalRotationOffset =
    traversal.transitionStyle === "turn"
      ? clamp((audio.temperature - 0.5) * 0.44 + (targetPoi.bank >= 0 ? 0.12 : -0.12), -0.28, 0.28)
      : 0;
  const arrivalCamera = createPoiViewport(targetPoi, arrivalScaleMultiplier, arrivalRotationOffset);

  traversal.previousIndex = sourceIndex;
  traversal.currentIndex = targetIndex;
  traversal.nextIndex = targetNextIndex;
  traversal.recentPoiIndices = [...traversal.recentPoiIndices, targetIndex].slice(-4);
  traversal.progress = 0;
  traversal.segmentDuration = calculateSegmentDuration(targetPoi, family.pointsOfInterest[targetNextIndex]);
  traversal.pathSpeed = 0.78;
  traversal.segmentEscape = 0;
  traversal.segmentSeed += 2.61803398875;
  traversal.palettePhase = targetPoi.hueOffset;
  traversal.bendPhase += 0.52;
  traversal.driftPhase += 0.3;
  traversal.transitionScaleMultiplier = arrivalScaleMultiplier;
  traversal.transitionRotationOffset = arrivalRotationOffset;
  traversal.desiredCamera = copyViewport(arrivalCamera);
  traversal.camera = arrivalCamera;

  interest.focusTargetOffset = { x: 0, y: 0 };
  interest.focusOffset = { x: 0, y: 0 };
  interest.focusTargetScore = 0.76;
  interest.focusTargetHoldUntil = now + 1500;
  interest.desiredZoomGovernor = 1;
  interest.zoomGovernor = 1;
  interest.desiredZoomPermission = 1;
  interest.zoomPermission = 1;
  interest.desiredCurrentScore = 0.76;
  interest.currentScore = 0.76;
  interest.desiredBestScore = 0.82;
  interest.bestScore = 0.82;
  interest.lowInterestTime = 0;
  interest.searchPhase = targetPoi.hueOffset * Math.PI * 2;
  interest.lastEvaluationAt = 0;

  resetTemporalState();

  const transitDuration = lerp(
    VOID_TRANSITION_CONFIG.transitDuration.max,
    VOID_TRANSITION_CONFIG.transitDuration.min,
    clamp(audio.noveltySmoothed * 0.5 + audio.spectralFlux * 0.3, 0, 1)
  );
  setTraversalMode("transit", transitDuration);
}

function beginVoidTransition(now: number, aspectRatio: number) {
  const { targetIndex, targetNextIndex } = pickVoidTransitionTarget(aspectRatio);
  const transitionEnergy = clamp(audio.noveltySmoothed * 0.55 + audio.spectralFlux * 0.45, 0, 1);

  traversal.transitionTargetIndex = targetIndex;
  traversal.transitionTargetNextIndex = targetNextIndex;
  traversal.transitionStyle = chooseVoidTransitionStyle();
  traversal.transitionCooldownUntil = now + lerp(VOID_TRANSITION_CONFIG.cooldownMs.max, VOID_TRANSITION_CONFIG.cooldownMs.min, transitionEnergy);

  const dissolveDuration = lerp(
    VOID_TRANSITION_CONFIG.dissolveDuration.max,
    VOID_TRANSITION_CONFIG.dissolveDuration.min,
    transitionEnergy
  );
  setTraversalMode("dissolve", dissolveDuration);
}

function updateTraversalMode(deltaSeconds: number, now: number, aspectRatio: number) {
  if (traversal.modeDuration > 0) {
    traversal.modeElapsed = Math.min(traversal.modeElapsed + deltaSeconds, traversal.modeDuration);
  }

  switch (traversal.mode) {
    case "explore": {
      traversal.voidMix = damp(traversal.voidMix, 0, 4.6, deltaSeconds);
      traversal.voidCollapse = damp(traversal.voidCollapse, 0, 4.2, deltaSeconds);
      traversal.transitionScaleMultiplier = damp(traversal.transitionScaleMultiplier, 1, 2.6, deltaSeconds);
      traversal.transitionRotationOffset = damp(traversal.transitionRotationOffset, 0, 2.2, deltaSeconds);

      const shouldTransition =
        !isPizzaLayout.value &&
        now >= traversal.transitionCooldownUntil &&
        traversal.progress > 0.16 &&
        interest.lowInterestTime >= VOID_TRANSITION_CONFIG.triggerLowInterestTime &&
        interest.currentScore <= VOID_TRANSITION_CONFIG.triggerCurrentScore &&
        interest.bestScore <= VOID_TRANSITION_CONFIG.triggerBestScore;

      if (shouldTransition) {
        beginVoidTransition(now, aspectRatio);
      }
      break;
    }
    case "dissolve": {
      const dissolveProgress = smoothStep(clamp(traversal.modeElapsed / Math.max(traversal.modeDuration, 0.000001), 0, 1));
      const collapseTarget = traversal.transitionStyle === "zoom" ? 0.62 : traversal.transitionStyle === "turn" ? 0.74 : 0.82;
      const rotationTarget = traversal.transitionStyle === "turn" ? (audio.temperature - 0.5) * 0.08 : 0;

      traversal.voidMix = damp(traversal.voidMix, 0.72 + dissolveProgress * 0.18, 3.8, deltaSeconds);
      traversal.voidCollapse = damp(traversal.voidCollapse, collapseTarget * dissolveProgress, 3.4, deltaSeconds);
      traversal.transitionScaleMultiplier = damp(traversal.transitionScaleMultiplier, 1 - dissolveProgress * 0.08, 2.6, deltaSeconds);
      traversal.transitionRotationOffset = damp(traversal.transitionRotationOffset, rotationTarget, 2, deltaSeconds);

      if (traversal.modeElapsed >= traversal.modeDuration) {
        enterTransitRetarget(now, aspectRatio);
      }
      break;
    }
    case "transit": {
      const collapseTarget = traversal.transitionStyle === "zoom" ? 0.68 : 0.8;

      traversal.voidMix = damp(traversal.voidMix, 1, 7.2, deltaSeconds);
      traversal.voidCollapse = damp(traversal.voidCollapse, collapseTarget, 6.2, deltaSeconds);

      if (traversal.modeElapsed >= traversal.modeDuration) {
        const revealDuration = lerp(
          VOID_TRANSITION_CONFIG.revealDuration.max,
          VOID_TRANSITION_CONFIG.revealDuration.min,
          clamp(audio.highDrive * 0.35 + audio.noveltySmoothed * 0.25, 0, 1)
        );
        setTraversalMode("reveal", revealDuration);
      }
      break;
    }
    case "reveal": {
      const revealProgress = smoothStep(clamp(traversal.modeElapsed / Math.max(traversal.modeDuration, 0.000001), 0, 1));
      const darkness = 1 - revealProgress;
      const collapseTarget = traversal.transitionStyle === "zoom" ? 0.42 : 0.52;

      traversal.voidMix = damp(traversal.voidMix, darkness * 0.92, 4.2, deltaSeconds);
      traversal.voidCollapse = damp(traversal.voidCollapse, darkness * collapseTarget, 4.1, deltaSeconds);
      traversal.transitionScaleMultiplier = damp(traversal.transitionScaleMultiplier, 1, 1.45 + revealProgress * 1.2, deltaSeconds);
      traversal.transitionRotationOffset = damp(traversal.transitionRotationOffset, 0, 1.35 + revealProgress * 1.4, deltaSeconds);

      if (traversal.modeElapsed >= traversal.modeDuration) {
        traversal.voidMix = 0;
        traversal.voidCollapse = 0;
        traversal.transitionScaleMultiplier = 1;
        traversal.transitionRotationOffset = 0;
        setTraversalMode("explore", 0);
      }
      break;
    }
  }
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
  gl.bindAttribLocation(program, 0, "aPosition");
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

function destroyRenderTarget(gl: WebGLRenderingContext, target: RenderTarget) {
  if (target.texture) {
    gl.deleteTexture(target.texture);
  }

  if (target.framebuffer) {
    gl.deleteFramebuffer(target.framebuffer);
  }

  target.texture = null;
  target.framebuffer = null;
  target.width = 0;
  target.height = 0;
}

function ensureRenderTarget(gl: WebGLRenderingContext, target: RenderTarget, width: number, height: number, filter: number) {
  if (target.texture && target.framebuffer && target.width === width && target.height === height) {
    return true;
  }

  destroyRenderTarget(gl, target);

  const texture = gl.createTexture();
  const framebuffer = gl.createFramebuffer();

  if (!texture || !framebuffer) {
    if (texture) gl.deleteTexture(texture);
    if (framebuffer) gl.deleteFramebuffer(framebuffer);
    return false;
  }

  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

  if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.deleteFramebuffer(framebuffer);
    gl.deleteTexture(texture);
    return false;
  }

  target.texture = texture;
  target.framebuffer = framebuffer;
  target.width = width;
  target.height = height;

  gl.viewport(0, 0, width, height);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.bindTexture(gl.TEXTURE_2D, null);
  return true;
}

function destroyRenderer() {
  if (renderState.gl) {
    destroyRenderTarget(renderState.gl, renderState.currentTarget);
    destroyRenderTarget(renderState.gl, renderState.historyTargets[0]);
    destroyRenderTarget(renderState.gl, renderState.historyTargets[1]);

    if (renderState.buffer) {
      renderState.gl.deleteBuffer(renderState.buffer);
    }

    if (renderState.fractalProgram) {
      renderState.gl.deleteProgram(renderState.fractalProgram);
    }

    if (renderState.compositeProgram) {
      renderState.gl.deleteProgram(renderState.compositeProgram);
    }

    if (renderState.presentProgram) {
      renderState.gl.deleteProgram(renderState.presentProgram);
    }
  }

  renderState.canvas = null;
  renderState.gl = null;
  renderState.fractalProgram = null;
  renderState.compositeProgram = null;
  renderState.presentProgram = null;
  renderState.buffer = null;
  renderState.fractalUniforms = null;
  renderState.compositeUniforms = null;
  renderState.presentUniforms = null;
  renderState.displayWidth = 0;
  renderState.displayHeight = 0;
  renderState.dpr = 1;
  resetTemporalState();
}

function ensureRenderer() {
  if (!canvas.value) return false;

  if (
    renderState.canvas === canvas.value &&
    renderState.gl &&
    renderState.fractalProgram &&
    renderState.compositeProgram &&
    renderState.presentProgram &&
    renderState.buffer &&
    renderState.fractalUniforms &&
    renderState.compositeUniforms &&
    renderState.presentUniforms
  ) {
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
  const fractalProgram = createProgram(context, VERTEX_SHADER_SOURCE, FRACTAL_FRAGMENT_SHADER_SOURCE);
  const compositeProgram = createProgram(context, VERTEX_SHADER_SOURCE, COMPOSITE_FRAGMENT_SHADER_SOURCE);
  const presentProgram = createProgram(context, VERTEX_SHADER_SOURCE, PRESENT_FRAGMENT_SHADER_SOURCE);

  if (!fractalProgram || !compositeProgram || !presentProgram) {
    if (fractalProgram) context.deleteProgram(fractalProgram);
    if (compositeProgram) context.deleteProgram(compositeProgram);
    if (presentProgram) context.deleteProgram(presentProgram);
    return false;
  }

  const buffer = context.createBuffer();
  if (!buffer) {
    context.deleteProgram(fractalProgram);
    context.deleteProgram(compositeProgram);
    context.deleteProgram(presentProgram);
    return false;
  }

  context.bindBuffer(context.ARRAY_BUFFER, buffer);
  context.bufferData(context.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), context.STATIC_DRAW);
  context.enableVertexAttribArray(0);
  context.vertexAttribPointer(0, 2, context.FLOAT, false, 0, 0);
  context.disable(context.DEPTH_TEST);
  context.disable(context.CULL_FACE);
  context.disable(context.BLEND);
  context.clearColor(0, 0, 0, 0);

  renderState.canvas = canvas.value;
  renderState.gl = context;
  renderState.fractalProgram = fractalProgram;
  renderState.compositeProgram = compositeProgram;
  renderState.presentProgram = presentProgram;
  renderState.buffer = buffer;
  renderState.fractalUniforms = {
    resolution: context.getUniformLocation(fractalProgram, "uResolution"),
    center: context.getUniformLocation(fractalProgram, "uCenter"),
    scale: context.getUniformLocation(fractalProgram, "uScale"),
    rotation: context.getUniformLocation(fractalProgram, "uRotation"),
    aspect: context.getUniformLocation(fractalProgram, "uAspect"),
    palettePhase: context.getUniformLocation(fractalProgram, "uPalettePhase"),
    ambientLift: context.getUniformLocation(fractalProgram, "uAmbientLift"),
    paletteEnergy: context.getUniformLocation(fractalProgram, "uPaletteEnergy"),
    stableAA: context.getUniformLocation(fractalProgram, "uStableAA"),
    maxIterations: context.getUniformLocation(fractalProgram, "uMaxIterations"),
    structurePower: context.getUniformLocation(fractalProgram, "uStructurePower"),
    trapMix: context.getUniformLocation(fractalProgram, "uTrapMix"),
    trapScale: context.getUniformLocation(fractalProgram, "uTrapScale"),
    paletteBias: context.getUniformLocation(fractalProgram, "uPaletteBias"),
    voidFade: context.getUniformLocation(fractalProgram, "uVoidFade"),
    voidCollapse: context.getUniformLocation(fractalProgram, "uVoidCollapse"),
    layoutMode: context.getUniformLocation(fractalProgram, "uLayoutMode"),
    sliceCount: context.getUniformLocation(fractalProgram, "uSliceCount"),
    pizzaWarp: context.getUniformLocation(fractalProgram, "uPizzaWarp"),
    pizzaSpin: context.getUniformLocation(fractalProgram, "uPizzaSpin"),
    pizzaMorph: context.getUniformLocation(fractalProgram, "uPizzaMorph"),
    symmetryGroup: context.getUniformLocation(fractalProgram, "uSymmetryGroup"),
    symmetryMode: context.getUniformLocation(fractalProgram, "uSymmetryMode"),
    symmetryStrength: context.getUniformLocation(fractalProgram, "uSymmetryStrength"),
    coinTilt: context.getUniformLocation(fractalProgram, "uCoinTilt"),
    coinSpin: context.getUniformLocation(fractalProgram, "uCoinSpin"),
    coinPrecession: context.getUniformLocation(fractalProgram, "uCoinPrecession"),
    coinFlip: context.getUniformLocation(fractalProgram, "uCoinFlip"),
    coinDepth: context.getUniformLocation(fractalProgram, "uCoinDepth"),
    coinRadius: context.getUniformLocation(fractalProgram, "uCoinRadius"),
    coinOffset: context.getUniformLocation(fractalProgram, "uCoinOffset"),
    coinSpinAxis: context.getUniformLocation(fractalProgram, "uCoinSpinAxis"),
    coinShimmer: context.getUniformLocation(fractalProgram, "uCoinShimmer"),
    pizzaBackdropRotation: context.getUniformLocation(fractalProgram, "uPizzaBackdropRotation"),
    pizzaBackdropTorsion: context.getUniformLocation(fractalProgram, "uPizzaBackdropTorsion"),
  };
  renderState.compositeUniforms = {
    currentTexture: context.getUniformLocation(compositeProgram, "uCurrentTexture"),
    historyTexture: context.getUniformLocation(compositeProgram, "uHistoryTexture"),
    currentTexelSize: context.getUniformLocation(compositeProgram, "uCurrentTexelSize"),
    currentCenter: context.getUniformLocation(compositeProgram, "uCurrentCenter"),
    currentScale: context.getUniformLocation(compositeProgram, "uCurrentScale"),
    currentRotation: context.getUniformLocation(compositeProgram, "uCurrentRotation"),
    currentAspect: context.getUniformLocation(compositeProgram, "uCurrentAspect"),
    previousCenter: context.getUniformLocation(compositeProgram, "uPreviousCenter"),
    previousScale: context.getUniformLocation(compositeProgram, "uPreviousScale"),
    previousRotation: context.getUniformLocation(compositeProgram, "uPreviousRotation"),
    previousAspect: context.getUniformLocation(compositeProgram, "uPreviousAspect"),
    historyBlend: context.getUniformLocation(compositeProgram, "uHistoryBlend"),
  };
  renderState.presentUniforms = {
    sourceTexture: context.getUniformLocation(presentProgram, "uSourceTexture"),
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
  resetTemporalState();
  renderState.gl.bindFramebuffer(renderState.gl.FRAMEBUFFER, null);
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
    const rowT = row / (rows - 1);
    const offsetY = (rowT - 0.5) * spanY;

    for (let column = 0; column < columns; column++) {
      const columnT = column / (columns - 1);
      const offsetX = (columnT - 0.5) * spanX;

      family.sample(center.x + offsetX, center.y + offsetY, iterations, reusableInterestSample, fractalMutation.parameters);

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

function getViewportAspectRatio() {
  return Math.max((viewport.width || window.innerWidth || 1) / Math.max(viewport.height || window.innerHeight || 1, 1), 0.6);
}

function clampOffsetToRailEnvelope(
  offset: ComplexPoint,
  tangentUnit: ComplexPoint,
  normalUnit: ComplexPoint,
  tangentLimit: number,
  normalLimit: number
) {
  const tangentAmount = clamp(offset.x * tangentUnit.x + offset.y * tangentUnit.y, -tangentLimit, tangentLimit);
  const normalAmount = clamp(offset.x * normalUnit.x + offset.y * normalUnit.y, -normalLimit, normalLimit);

  return {
    x: tangentUnit.x * tangentAmount + normalUnit.x * normalAmount,
    y: tangentUnit.y * tangentAmount + normalUnit.y * normalAmount,
  };
}

function getRailOffsetPenalty(
  offset: ComplexPoint,
  tangentUnit: ComplexPoint,
  normalUnit: ComplexPoint,
  tangentLimit: number,
  normalLimit: number
) {
  const tangentAmount = offset.x * tangentUnit.x + offset.y * tangentUnit.y;
  const normalAmount = offset.x * normalUnit.x + offset.y * normalUnit.y;

  return (
    (Math.abs(tangentAmount) / Math.max(tangentLimit, 0.000001)) * 0.035 +
    (Math.abs(normalAmount) / Math.max(normalLimit, 0.000001)) * 0.07
  );
}

function pickNextPoiIndex(currentIndex: number, previousIndex: number, aspectRatio: number) {
  const currentPoi = family.pointsOfInterest[currentIndex];
  const outboundIds =
    currentPoi.outbound.length > 0
      ? currentPoi.outbound
      : family.pointsOfInterest.filter((_, index) => index !== currentIndex).map((poi) => poi.id);
  const outboundIndices = outboundIds.map((id) => family.getPoiIndexById(id));
  const audioAdventure = clamp(audio.noveltySmoothed * 0.38 + audio.spectralFlux * 0.82 + audio.surge * 0.22, 0, 1);
  let bestIndex = outboundIndices[0] ?? currentIndex;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (const candidateIndex of outboundIndices) {
    if (candidateIndex === currentIndex) continue;

    const candidatePoi = family.pointsOfInterest[candidateIndex];
    const metrics = evaluateInterest(candidatePoi.center, clamp(candidatePoi.scale * 1.04, 0.02, 3.2), aspectRatio);
    const zoomDistance = Math.abs(Math.log(Math.max(currentPoi.scale, 0.000001) / Math.max(candidatePoi.scale, 0.000001)));
    const revisitIndex = traversal.recentPoiIndices.lastIndexOf(candidateIndex);
    const revisitPenalty =
      revisitIndex >= 0 ? clamp(0.26 - (traversal.recentPoiIndices.length - 1 - revisitIndex) * 0.06, 0.08, 0.26) : 0;
    const backtrackPenalty = candidateIndex === previousIndex ? 0.16 : 0;
    const smoothTravelPenalty = clamp(zoomDistance * 0.09, 0, 0.18);
    const audioAdventureBonus = audioAdventure * clamp(zoomDistance * 0.08 + Math.abs(candidatePoi.bend - currentPoi.bend) * 0.1, 0, 0.16);
    const score = metrics.score + candidatePoi.interestBias + audioAdventureBonus - revisitPenalty - backtrackPenalty - smoothTravelPenalty;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = candidateIndex;
    }
  }

  return bestIndex;
}

function advanceSegment(aspectRatio: number) {
  traversal.previousIndex = traversal.currentIndex;
  traversal.currentIndex = traversal.nextIndex;
  traversal.progress -= 1;
  traversal.segmentEscape = 0;
  traversal.recentPoiIndices = [...traversal.recentPoiIndices, traversal.currentIndex].slice(-4);
  traversal.nextIndex = pickNextPoiIndex(traversal.currentIndex, traversal.previousIndex, aspectRatio);
  traversal.segmentDuration = calculateSegmentDuration(
    family.pointsOfInterest[traversal.currentIndex],
    family.pointsOfInterest[traversal.nextIndex]
  );
  traversal.segmentSeed += 1.61803398875;
}

function scanNearbyInterest(
  baseCenter: ComplexPoint,
  baseScale: number,
  aspectRatio: number,
  tangentUnit: ComplexPoint,
  normalUnit: ComplexPoint,
  tangentLimit: number,
  normalLimit: number
) {
  const base = evaluateInterest(baseCenter, baseScale, aspectRatio);
  const lowInterest = base.score < 0.58 || interest.lowInterestTime > 0.25;
  const tangentSearch = tangentLimit * (lowInterest ? 1.06 : 0.84);
  const normalSearch = normalLimit * (lowInterest ? 1.06 : 0.8);
  const scaleFactors = lowInterest ? [1.1, 1.02, 0.97] : [1.04, 1, 0.98];
  const ringFactors = [0, 0.46, 0.82];
  let best = base;

  for (const ringFactor of ringFactors) {
    const samplesOnRing = ringFactor === 0 ? 1 : 6;

    for (let step = 0; step < samplesOnRing; step++) {
      const angle = interest.searchPhase + (step / Math.max(1, samplesOnRing)) * Math.PI * 2;
      const offset = {
        x: tangentUnit.x * Math.cos(angle) * tangentSearch * ringFactor + normalUnit.x * Math.sin(angle) * normalSearch * ringFactor,
        y: tangentUnit.y * Math.cos(angle) * tangentSearch * ringFactor + normalUnit.y * Math.sin(angle) * normalSearch * ringFactor,
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
          Math.abs(Math.log(candidateScale / baseScale)) * 0.1;
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

function pickNextFractalVariant(previousIndex: number) {
  const targetIntensity = clamp(
    0.22 + audio.noveltySmoothed * 0.36 + audio.spectralFlux * 0.48 + audio.bassDrive * 0.18 + audio.highDrive * 0.12,
    0.22,
    0.94
  );
  let bestIndex = 1;
  let bestScore = Number.NEGATIVE_INFINITY;

  for (let index = 1; index < FRACTAL_PRESETS.length; index++) {
    const preset = FRACTAL_PRESETS[index];
    const revisitIndex = fractalMutation.recentVariantIndices.lastIndexOf(index);
    const revisitPenalty =
      revisitIndex >= 0 ? clamp(0.22 - (fractalMutation.recentVariantIndices.length - 1 - revisitIndex) * 0.08, 0.06, 0.22) : 0;
    const repeatPenalty = index === previousIndex ? 0.12 : 0;
    const intensityFit = 1 - Math.abs(preset.intensity - targetIntensity);
    const wobble = Math.sin((traversal.segmentSeed + index * 0.71) * 1.37) * 0.03;
    const score = intensityFit * 1.18 - revisitPenalty - repeatPenalty + wobble;

    if (score > bestScore) {
      bestScore = score;
      bestIndex = index;
    }
  }

  return bestIndex;
}

function updateFractalMutation(deltaSeconds: number) {
  const mutationExcitement = clamp(audio.noveltySmoothed * 0.34 + audio.spectralFlux * 0.82 + audio.highDrive * 0.16, 0, 1);
  const ambientDepth = 0.18 + audio.ambient * 0.08;

  // Mutation stays alive during quiet sections, then leans deeper and faster on stronger novelty.
  fractalMutation.desiredDepth = clamp(ambientDepth + mutationExcitement * 0.34, 0.18, 0.74);
  fractalMutation.desiredSpeed = clamp(0.19 + audio.ambient * 0.06 + mutationExcitement * 0.34, 0.18, 0.62);

  fractalMutation.depth = damp(fractalMutation.depth, fractalMutation.desiredDepth, 1.1, deltaSeconds);
  fractalMutation.speed = damp(fractalMutation.speed, fractalMutation.desiredSpeed, 1.6, deltaSeconds);

  if (fractalMutation.restTimeRemaining > 0) {
    fractalMutation.restTimeRemaining = Math.max(0, fractalMutation.restTimeRemaining - deltaSeconds);
  } else {
    fractalMutation.cyclePhase += deltaSeconds * fractalMutation.speed;

    if (fractalMutation.cyclePhase >= Math.PI * 2) {
      fractalMutation.cyclePhase -= Math.PI * 2;
      fractalMutation.restTimeRemaining = clamp(0.34 - mutationExcitement * 0.18, 0.12, 0.34);
      fractalMutation.variantPresetIndex = pickNextFractalVariant(fractalMutation.variantPresetIndex);
      fractalMutation.recentVariantIndices = [...fractalMutation.recentVariantIndices, fractalMutation.variantPresetIndex].slice(-3);
    }
  }

  const anchorPreset = FRACTAL_PRESETS[fractalMutation.anchorPresetIndex];
  const variantPreset = FRACTAL_PRESETS[fractalMutation.variantPresetIndex];
  const cycleEnvelope = fractalMutation.restTimeRemaining > 0 ? 0 : 0.5 - 0.5 * Math.cos(fractalMutation.cyclePhase);
  const morphAmount = smoothStep(cycleEnvelope) * fractalMutation.depth;
  fractalMutation.parameters = lerpFractalParameters(anchorPreset, variantPreset, morphAmount);
}

function updateInterestGuidance(
  baseCenter: ComplexPoint,
  baseScale: number,
  deltaSeconds: number,
  now: number,
  tangentUnit: ComplexPoint,
  normalUnit: ComplexPoint,
  tangentLimit: number,
  normalLimit: number
) {
  const aspectRatio = getViewportAspectRatio();

  if (!interest.lastEvaluationAt || now - interest.lastEvaluationAt >= 420) {
    const { base, best } = scanNearbyInterest(baseCenter, baseScale, aspectRatio, tangentUnit, normalUnit, tangentLimit, normalLimit);
    const hasFocusTarget = Math.hypot(interest.focusTargetOffset.x, interest.focusTargetOffset.y) > baseScale * 0.0015;
    const currentTargetOffset = clampOffsetToRailEnvelope(interest.focusTargetOffset, tangentUnit, normalUnit, tangentLimit, normalLimit);
    const currentTargetCenter = {
      x: baseCenter.x + currentTargetOffset.x,
      y: baseCenter.y + currentTargetOffset.y,
    };
    const currentTargetMetrics = hasFocusTarget ? evaluateInterest(currentTargetCenter, baseScale, aspectRatio) : base;
    const currentTargetPenalty = hasFocusTarget
      ? getRailOffsetPenalty(currentTargetOffset, tangentUnit, normalUnit, tangentLimit, normalLimit)
      : 0;
    const currentTargetScore = hasFocusTarget ? currentTargetMetrics.score - currentTargetPenalty : base.score;
    const candidateOffset = clampOffsetToRailEnvelope(
      {
        x: best.center.x - baseCenter.x,
        y: best.center.y - baseCenter.y,
      },
      tangentUnit,
      normalUnit,
      tangentLimit,
      normalLimit
    );
    const candidatePenalty = getRailOffsetPenalty(candidateOffset, tangentUnit, normalUnit, tangentLimit, normalLimit);
    const candidateScore = best.score - candidatePenalty;
    const focusClearlyBad = currentTargetScore < 0.5 || (base.score < 0.46 && interest.lowInterestTime > 0.9);
    const dwellExpired = now >= interest.focusTargetHoldUntil;
    // The focus target is sticky on purpose: we only swap it out when a new local sample is
    // clearly better or when the current target has been boring for too long.
    const replacementMargin = !hasFocusTarget ? 0.06 : focusClearlyBad ? 0.1 : dwellExpired ? 0.2 : 0.32;
    const shouldReplaceFocus =
      candidateScore > currentTargetScore + replacementMargin && (!hasFocusTarget || dwellExpired || focusClearlyBad);
    const shouldReleaseFocus =
      hasFocusTarget && dwellExpired && currentTargetScore < base.score - 0.06 && candidateScore <= currentTargetScore + 0.05;

    if (shouldReplaceFocus) {
      interest.focusTargetOffset = candidateOffset;
      interest.focusTargetScore = candidateScore;
      interest.focusTargetHoldUntil = now + (focusClearlyBad ? 1100 : 1900);
    } else if (shouldReleaseFocus) {
      interest.focusTargetOffset = { x: 0, y: 0 };
      interest.focusTargetScore = base.score;
      interest.focusTargetHoldUntil = now + 1200;
    }

    interest.desiredCurrentScore = base.score;
    interest.desiredBestScore = Math.max(candidateScore, currentTargetScore, base.score);
    interest.lastEvaluationAt = now;
    interest.searchPhase = (interest.searchPhase + 0.34 + audio.bend * 0.06 + audio.spectralFlux * 0.08) % (Math.PI * 2);

    const lowInterestPressure = clamp((0.58 - base.score) / 0.26, 0, 1);
    const betterScale = Math.max(1, best.scale / baseScale);

    // Zoom response is continuous now: low-interest regions gradually ease off zoom pressure
    // instead of flipping between allowed and blocked states on each rescan.
    interest.desiredZoomGovernor =
      lowInterestPressure > 0
        ? clamp(lerp(1, Math.max(1 + lowInterestPressure * 0.07, betterScale), 0.7), 1, 1.18)
        : 1;
    interest.desiredZoomPermission =
      lowInterestPressure > 0
        ? clamp(1 - lowInterestPressure * 0.58, 0.4, 1)
        : 1;
  }

  interest.currentScore = damp(interest.currentScore, interest.desiredCurrentScore, 1.9, deltaSeconds);
  interest.bestScore = damp(interest.bestScore, interest.desiredBestScore, 1.7, deltaSeconds);

  const lowInterestPressure = clamp((0.56 - interest.currentScore) / 0.2, 0, 1);
  if (lowInterestPressure > 0) {
    interest.lowInterestTime = clamp(interest.lowInterestTime + deltaSeconds * (0.34 + lowInterestPressure * 0.98), 0, 4.5);
  } else {
    interest.lowInterestTime = Math.max(0, interest.lowInterestTime - deltaSeconds * 0.82);
  }

  const correctionResponse = 0.72 + clamp(interest.lowInterestTime / 2.2, 0, 1) * 0.64;
  const zoomResponse = 0.88 + lowInterestPressure * 0.58;

  interest.focusOffset.x = damp(interest.focusOffset.x, interest.focusTargetOffset.x, correctionResponse, deltaSeconds);
  interest.focusOffset.y = damp(interest.focusOffset.y, interest.focusTargetOffset.y, correctionResponse, deltaSeconds);
  interest.zoomGovernor = damp(interest.zoomGovernor, interest.desiredZoomGovernor, zoomResponse, deltaSeconds);
  interest.zoomPermission = damp(interest.zoomPermission, interest.desiredZoomPermission, zoomResponse, deltaSeconds);
}

function updateAudioResponse(deltaSeconds: number) {
  const stream = clamp(Number(sources.stream) || 0, 0, 1);
  const spectral = audioFeatures.update(deltaSeconds);
  const pulseConfidence = pulse.confidence;
  const pulseImpact = pulse.impact * pulseConfidence;
  const pulseAnticipation = pulse.anticipation * pulseConfidence;
  const reactivity = clamp(0.5 + ((strength.value - 0.35) / 1) * 0.95, 0.5, 1.45);
  const bassDriveTarget = clamp(spectral.bass * 0.78 + spectral.lowMid * 0.22, 0, 1);
  const midDriveTarget = clamp(spectral.mid * 0.74 + spectral.lowMid * 0.26, 0, 1);
  const highDriveTarget = clamp(spectral.high * 0.7 + spectral.air * 0.3, 0, 1);
  const fluxExcitement = clamp(spectral.spectralFlux * 0.84 + spectral.novelty * 0.22, 0, 1);
  const temperatureTarget = clamp(spectral.centroid + spectral.bandImbalance * 0.12, 0, 1);

  audio.bassDrive = damp(audio.bassDrive, bassDriveTarget, 4.8, deltaSeconds);
  audio.midDrive = damp(audio.midDrive, midDriveTarget, 4.8, deltaSeconds);
  audio.highDrive = damp(audio.highDrive, highDriveTarget, 5.2, deltaSeconds);
  audio.spectralFlux = damp(audio.spectralFlux, spectral.spectralFlux, 5.8, deltaSeconds);
  audio.energy = damp(audio.energy, spectral.energy, 4.2, deltaSeconds);
  audio.noveltySmoothed = damp(audio.noveltySmoothed, spectral.novelty, 4.6, deltaSeconds);
  audio.temperature = damp(audio.temperature, temperatureTarget, 2.4, deltaSeconds);
  audio.surge = damp(audio.surge, fluxExcitement, 7.1, deltaSeconds);
  audio.ambient = damp(audio.ambient, clamp(0.16 + audio.energy * 0.56 + stream * 0.18 + pulseAnticipation * 0.05, 0.16, 1), 2.1, deltaSeconds);
  audio.zoom = damp(
    audio.zoom,
    clamp(
      0.13 +
        audio.ambient * 0.14 +
        audio.bassDrive * 0.24 +
        pulseImpact * 0.14 +
        pulseAnticipation * 0.08 +
        (audio.noveltySmoothed * 0.22 + audio.spectralFlux * 0.6) * reactivity,
      0.12,
      1.45
    ),
    3.5,
    deltaSeconds
  );
  audio.bend = damp(
    audio.bend,
    clamp(
      0.18 +
        stream * 0.18 +
        audio.midDrive * 0.4 +
        pulseAnticipation * 0.12 +
        pulseImpact * 0.04 +
        (audio.noveltySmoothed * 0.14 + audio.spectralFlux * 0.22) * reactivity,
      0.16,
      1.3
    ),
    3.1,
    deltaSeconds
  );
  audio.palette = damp(
    audio.palette,
    clamp(
      0.2 +
        stream * 0.18 +
        audio.highDrive * 0.48 +
        audio.temperature * 0.14 +
        pulseImpact * 0.08 +
        pulseAnticipation * 0.05 +
        audio.spectralFlux * 0.14 * reactivity,
      0.18,
      1.25
    ),
    2.3,
    deltaSeconds
  );
}

function updateCoinMotion(deltaSeconds: number, now: number) {
  const pulseConfidence = pulse.confidence;
  const pulseImpact = pulse.impact * pulseConfidence;
  const pulseAnticipation = pulse.anticipation * pulseConfidence;
  const reactivity = clamp(0.58 + ((strength.value - 0.35) / 1) * 0.92, 0.58, 1.5);
  const launchKick = clamp(pulseImpact * 0.82 + audio.bassDrive * 0.36 + audio.surge * 0.22, 0, 1.4);
  const flipSignal = clamp(
    pulseImpact * 0.78 + audio.noveltySmoothed * 0.52 + audio.spectralFlux * 0.44 + audio.highDrive * 0.14,
    0,
    1.6
  );
  const triggerSignal = clamp(launchKick * 0.64 + flipSignal * 0.36, 0, 1.8);
  const triggerRise = Math.max(0, triggerSignal - coinMotion.lastTriggerSignal);
  const phasePunch =
    coinMotion.phase === "flip" ? 1 : coinMotion.phase === "launch" ? 0.58 : coinMotion.phase === "settle" ? 0.26 : 0;
  const launchDirectionX =
    Math.sin(now * 0.0013 + traversal.segmentSeed * TAU * 0.8 + traversal.palettePhase * TAU * 0.5) >= 0 ? 1 : -1;
  const launchDirectionY =
    Math.cos(now * 0.0011 + traversal.segmentSeed * TAU * 0.6 + traversal.driftPhase * 0.7) >= 0 ? 1 : -1;

  coinMotion.phaseElapsed += deltaSeconds;
  coinMotion.impulseCooldown = Math.max(0, coinMotion.impulseCooldown - deltaSeconds);
  coinMotion.lastTriggerSignal = triggerSignal;

  const shouldTriggerFlip =
    coinMotion.impulseCooldown <= 0 &&
    triggerRise > 0.11 &&
    launchKick > 0.44 &&
    (flipSignal > 0.78 || audio.surge > 0.62);
  const shouldTriggerLaunch = coinMotion.impulseCooldown <= 0 && triggerRise > 0.09 && launchKick > 0.42;

  if (shouldTriggerFlip) {
    coinMotion.phase = "flip";
    coinMotion.phaseElapsed = 0;
    coinMotion.phaseDuration = lerp(0.92, 1.58, clamp(flipSignal * 0.7 + audio.bassDrive * 0.3, 0, 1));
    coinMotion.impulseCooldown = lerp(0.38, 0.82, clamp(flipSignal * 0.76 + launchKick * 0.24, 0, 1));
    coinMotion.targetTiltX = clamp(
      coinMotion.targetTiltX + launchDirectionX * (0.26 + launchKick * 0.34 + pulseAnticipation * 0.18),
      -1.05,
      1.05
    );
    coinMotion.targetTiltY = clamp(
      coinMotion.targetTiltY + launchDirectionY * (0.32 + audio.midDrive * 0.22 + audio.noveltySmoothed * 0.16),
      -1.18,
      1.18
    );
    coinMotion.spinVelocity += launchDirectionY * (1.8 + audio.highDrive * 1.4 + flipSignal * 2.6) * reactivity;
    coinMotion.flipVelocity += launchDirectionX * (3.2 + flipSignal * 4.8) * reactivity;
    coinMotion.wobble = clamp(coinMotion.wobble + 0.22 + audio.midDrive * 0.16 + audio.noveltySmoothed * 0.12, 0.08, 0.92);
    coinMotion.lift = clamp(Math.max(coinMotion.lift, 0.18 + launchKick * 0.26), 0, 0.78);
  } else if (shouldTriggerLaunch) {
    coinMotion.phase = "launch";
    coinMotion.phaseElapsed = 0;
    coinMotion.phaseDuration = lerp(0.48, 0.94, clamp(launchKick * 0.74 + pulseAnticipation * 0.26, 0, 1));
    coinMotion.impulseCooldown = lerp(0.24, 0.58, clamp(launchKick, 0, 1));
    coinMotion.targetTiltX = clamp(
      coinMotion.targetTiltX + launchDirectionX * (0.14 + launchKick * 0.18 + pulseAnticipation * 0.16),
      -0.9,
      0.9
    );
    coinMotion.targetTiltY = clamp(
      coinMotion.targetTiltY + launchDirectionY * (0.18 + audio.midDrive * 0.12 + pulseImpact * 0.18),
      -0.98,
      0.98
    );
    coinMotion.spinVelocity += launchDirectionY * (0.92 + audio.highDrive * 0.62 + launchKick * 1.2) * reactivity;
    coinMotion.flipVelocity += launchDirectionX * (0.88 + launchKick * 1.6 + audio.noveltySmoothed * 1.1) * reactivity;
    coinMotion.wobble = clamp(coinMotion.wobble + 0.1 + audio.midDrive * 0.08, 0.06, 0.72);
    coinMotion.lift = clamp(Math.max(coinMotion.lift, 0.1 + launchKick * 0.18), 0, 0.62);
  }

  if (coinMotion.phase === "launch" && coinMotion.phaseElapsed >= coinMotion.phaseDuration) {
    coinMotion.phase = Math.abs(coinMotion.flipVelocity) > 2.6 ? "flip" : "settle";
    coinMotion.phaseElapsed = 0;
    coinMotion.phaseDuration = coinMotion.phase === "flip" ? 0.82 : 1.4 + coinMotion.wobble * 0.6;
  } else if (coinMotion.phase === "flip" && coinMotion.phaseElapsed >= coinMotion.phaseDuration) {
    coinMotion.phase = "settle";
    coinMotion.phaseElapsed = 0;
    coinMotion.phaseDuration = 1.4 + coinMotion.wobble * 0.8;
  } else if (
    coinMotion.phase === "settle" &&
    coinMotion.phaseElapsed >= coinMotion.phaseDuration &&
    coinMotion.wobble < 0.12 &&
    Math.abs(coinMotion.flipVelocity) < 0.35
  ) {
    coinMotion.phase = "idle";
    coinMotion.phaseElapsed = 0;
    coinMotion.phaseDuration = 1;
  }

  const idleDriftTime = now * 0.001;
  const idleTiltX =
    0.16 +
    Math.sin(idleDriftTime * 0.74 + traversal.driftPhase * 0.82) * (0.07 + audio.midDrive * 0.03) -
    pulseAnticipation * 0.14;
  const idleTiltY =
    -0.18 +
    Math.cos(idleDriftTime * 0.58 + traversal.bendPhase * 0.76) * (0.16 + audio.highDrive * 0.04) +
    pulseAnticipation * 0.09;
  const preLeanX = -pulseAnticipation * (0.08 + audio.bassDrive * 0.1);
  const preLeanY = pulseAnticipation * (0.04 + audio.midDrive * 0.06);
  const targetResponse = coinMotion.phase === "idle" ? 1.5 : coinMotion.phase === "settle" ? 1.1 : 0.84;

  coinMotion.targetTiltX = damp(coinMotion.targetTiltX, idleTiltX + preLeanX, targetResponse, deltaSeconds);
  coinMotion.targetTiltY = damp(coinMotion.targetTiltY, idleTiltY + preLeanY, targetResponse, deltaSeconds);

  const wobbleTarget = clamp(
    0.04 + audio.midDrive * 0.14 + audio.spectralFlux * 0.08 + pulseAnticipation * 0.06 + phasePunch * 0.24,
    0.04,
    0.88
  );
  const wobbleResponse = coinMotion.phase === "flip" ? 1.2 : coinMotion.phase === "settle" ? 1.9 : 1.4;
  coinMotion.wobble = damp(coinMotion.wobble, wobbleTarget, wobbleResponse, deltaSeconds);
  coinMotion.wobblePhase =
    (coinMotion.wobblePhase +
      deltaSeconds * (0.48 + audio.midDrive * 1.5 + audio.noveltySmoothed * 0.4 + coinMotion.wobble * 1.3)) %
    TAU;
  coinMotion.precession = wrapAngle(
    coinMotion.precession +
      deltaSeconds * (0.22 + audio.midDrive * 0.72 + audio.spectralFlux * 0.2 + coinMotion.wobble * 0.85 + phasePunch * 0.46)
  );

  const wobbleX = Math.sin(coinMotion.wobblePhase) * coinMotion.wobble * (0.18 + audio.midDrive * 0.1);
  const wobbleY = Math.cos(coinMotion.wobblePhase * 0.92 + 0.6) * coinMotion.wobble * (0.24 + audio.midDrive * 0.12);
  const tiltResponse = coinMotion.phase === "flip" ? 4.4 : coinMotion.phase === "launch" ? 3.2 : coinMotion.phase === "settle" ? 2.1 : 1.8;

  coinMotion.tiltX = damp(coinMotion.tiltX, clamp(coinMotion.targetTiltX + wobbleX, -1.45, 1.45), tiltResponse, deltaSeconds);
  coinMotion.tiltY = damp(coinMotion.tiltY, clamp(coinMotion.targetTiltY + wobbleY, -1.48, 1.48), tiltResponse, deltaSeconds);

  const spinSign = coinMotion.spinVelocity >= 0 ? 1 : -1;
  const spinBase = (0.34 + audio.energy * 0.54 + audio.highDrive * 0.18 + pulseImpact * 0.12) * reactivity;
  const spinTarget = spinSign * (spinBase + phasePunch * 1.2 + pulseImpact * 0.42);
  const spinResponse = coinMotion.phase === "flip" ? 1.8 : coinMotion.phase === "settle" ? 2.4 : 1.2;

  coinMotion.spinVelocity = damp(coinMotion.spinVelocity, spinTarget, spinResponse, deltaSeconds);
  coinMotion.spin = wrapAngle(coinMotion.spin + coinMotion.spinVelocity * deltaSeconds);

  const flipDamping = coinMotion.phase === "flip" ? 0.82 : coinMotion.phase === "launch" ? 1.4 : coinMotion.phase === "settle" ? 2.8 : 4.2;
  coinMotion.flip += coinMotion.flipVelocity * deltaSeconds;
  coinMotion.flipVelocity *= Math.exp(-flipDamping * deltaSeconds);
  coinMotion.flip = wrapAngle(coinMotion.flip);

  if (coinMotion.phase === "idle") {
    coinMotion.flip = dampAngle(coinMotion.flip, 0, 3.6, deltaSeconds);
  }

  const liftTarget = clamp(0.04 + audio.bassDrive * 0.12 + pulseImpact * 0.18 + phasePunch * 0.16, 0.04, 0.74);
  const liftResponse = coinMotion.phase === "flip" ? 3.8 : coinMotion.phase === "launch" ? 3.1 : 2;
  coinMotion.lift = damp(coinMotion.lift, liftTarget, liftResponse, deltaSeconds);

  const offsetXTarget = clamp(Math.sin(coinMotion.precession) * coinMotion.tiltY * 0.04 - pulseAnticipation * 0.028, -0.12, 0.12);
  const offsetYTarget = clamp(
    -0.02 - coinMotion.lift * 0.09 + Math.cos(coinMotion.precession * 0.7) * coinMotion.tiltX * 0.03 - pulseAnticipation * 0.02,
    -0.16,
    0.08
  );

  coinMotion.offsetX = damp(coinMotion.offsetX, offsetXTarget, 2.3, deltaSeconds);
  coinMotion.offsetY = damp(coinMotion.offsetY, offsetYTarget, 2.3, deltaSeconds);

  const shimmerTarget = clamp(
    0.12 + audio.highDrive * 0.34 + pulseImpact * 0.18 + pulseAnticipation * 0.12 + Math.abs(coinMotion.flipVelocity) * 0.04,
    0.12,
    0.95
  );
  coinMotion.shimmer = damp(coinMotion.shimmer, shimmerTarget, 4.8, deltaSeconds);

  const settleTarget = coinMotion.phase === "idle" ? 1 : coinMotion.phase === "settle" ? 0.62 : 0.18;
  coinMotion.settle = damp(coinMotion.settle, settleTarget, 2.2, deltaSeconds);
}

function updatePizzaFieldMotion(deltaSeconds: number, now: number) {
  const pulseConfidence = pulse.confidence;
  const pulseImpact = pulse.impact * pulseConfidence;
  const pulseAnticipation = pulse.anticipation * pulseConfidence;
  const reactivity = clamp(0.56 + ((strength.value - 0.35) / 1) * 0.94, 0.56, 1.5);
  const driftWave = Math.sin(now * 0.00021 + traversal.segmentSeed * TAU * 0.72 + traversal.palettePhase * TAU * 0.18);
  const driftDirection =
    Math.abs(coinMotion.spinVelocity) > 0.14 ? (coinMotion.spinVelocity >= 0 ? 1 : -1) : driftWave >= 0 ? 1 : -1;
  const driftBias = driftWave * 0.045;
  const kickSignal = clamp(
    pulseImpact * 0.88 + audio.bassDrive * 0.48 + audio.surge * 0.24 + audio.noveltySmoothed * 0.18,
    0,
    1.6
  );
  const kickRise = Math.max(0, kickSignal - pizzaFieldMotion.lastKickSignal);
  const coinCoupling =
    coinMotion.spinVelocity * (0.1 + audio.bassDrive * 0.02) +
    coinMotion.flipVelocity * 0.018 +
    Math.sin(coinMotion.precession) * (0.02 + audio.midDrive * 0.012);
  const driftVelocity = driftDirection * (0.08 + audio.ambient * 0.11 + audio.energy * 0.03) + driftBias;

  pizzaFieldMotion.lastKickSignal = kickSignal;

  pizzaFieldMotion.targetVelocity = damp(
    pizzaFieldMotion.targetVelocity,
    clamp(
      driftVelocity +
        coinCoupling +
        pulseAnticipation * driftDirection * 0.09 +
        (audio.spectralFlux * 0.04 + audio.midDrive * 0.035) * reactivity,
      -0.92,
      0.92
    ),
    1.02,
    deltaSeconds
  );

  if (kickRise > 0.04) {
    // Bass/pulse add a deliberate rotational shove so the field feels driven, not just drifting.
    pizzaFieldMotion.angularVelocity +=
      driftDirection * (0.22 + pulseImpact * 0.56 + audio.bassDrive * 0.34 + audio.surge * 0.14) * reactivity;
    pizzaFieldMotion.backdropTorsionVelocity +=
      driftDirection * (0.06 + pulseImpact * 0.14 + audio.midDrive * 0.05 + audio.spectralFlux * 0.04) * reactivity;
  }

  // The field has its own momentum, then eases toward a quieter drift target between impacts.
  pizzaFieldMotion.angularVelocity = damp(
    pizzaFieldMotion.angularVelocity,
    pizzaFieldMotion.targetVelocity,
    1.02 + audio.ambient * 0.22 + audio.energy * 0.18,
    deltaSeconds
  );
  pizzaFieldMotion.rotation = wrapAngle(pizzaFieldMotion.rotation + pizzaFieldMotion.angularVelocity * deltaSeconds);

  const lagTarget =
    pizzaFieldMotion.rotation -
    pizzaFieldMotion.angularVelocity *
      (0.34 + audio.midDrive * 0.2 + audio.spectralFlux * 0.12 + Math.abs(coinMotion.flipVelocity) * 0.03);
  const rotationGap = angleDelta(pizzaFieldMotion.rotation, pizzaFieldMotion.backdropLagRotation);
  const torsionTarget = clamp(
    rotationGap * (1.08 + audio.midDrive * 0.72 + audio.spectralFlux * 0.4) +
      (coinMotion.spinVelocity - pizzaFieldMotion.angularVelocity) * 0.15 +
      coinMotion.flipVelocity * 0.048,
    -1.12,
    1.12
  );

  // Backdrop lag is intentionally slower than the field so the background feels dragged through a viscous medium.
  pizzaFieldMotion.backdropLagRotation = dampAngle(
    pizzaFieldMotion.backdropLagRotation,
    lagTarget,
    0.72 + audio.ambient * 0.18 + audio.midDrive * 0.1,
    deltaSeconds
  );
  pizzaFieldMotion.backdropTorsionVelocity = damp(
    pizzaFieldMotion.backdropTorsionVelocity,
    torsionTarget,
    1.24 + audio.midDrive * 0.28 + audio.spectralFlux * 0.22,
    deltaSeconds
  );
  pizzaFieldMotion.backdropTorsion = damp(
    pizzaFieldMotion.backdropTorsion,
    pizzaFieldMotion.backdropTorsionVelocity,
    1.52,
    deltaSeconds
  );

  const settleTarget =
    coinMotion.phase === "idle"
      ? 1
      : coinMotion.phase === "settle"
        ? 0.64
        : 0.2 + audio.spectralFlux * 0.08 + Math.min(Math.abs(pizzaFieldMotion.backdropTorsion), 0.14);
  pizzaFieldMotion.settle = damp(pizzaFieldMotion.settle, settleTarget, 2, deltaSeconds);
}

function updateTraversal(deltaSeconds: number, now: number) {
  const reactivity = clamp(0.5 + ((strength.value - 0.35) / 1) * 0.95, 0.5, 1.45);
  const aspectRatio = getViewportAspectRatio();
  updateTraversalMode(deltaSeconds, now, aspectRatio);

  if (traversal.mode === "transit") {
    traversal.pathSpeed = damp(traversal.pathSpeed, 0.42, 3.2, deltaSeconds);
    traversal.segmentEscape = damp(traversal.segmentEscape, 0, 4.2, deltaSeconds);
    traversal.bendPhase += deltaSeconds * 0.08;
    traversal.driftPhase += deltaSeconds * 0.06;
    traversal.palettePhase = (traversal.palettePhase + deltaSeconds * 0.01) % 1;
    return;
  }

  const escapeTarget = clamp((interest.lowInterestTime - 0.55) / 1.35, 0, 1);
  const calmCruise = 0.82 + audio.ambient * 0.08;
  const audioTravelBias = (audio.noveltySmoothed * 0.04 + audio.spectralFlux * 0.12 + audio.surge * 0.05) * reactivity;
  const modeSpeedMultiplier = traversal.mode === "dissolve" ? 0.58 : traversal.mode === "reveal" ? 0.84 : 1;

  traversal.segmentEscape = damp(traversal.segmentEscape, escapeTarget, 2.1, deltaSeconds);
  const speedTarget = clamp((calmCruise + audioTravelBias + traversal.segmentEscape * 0.22) * modeSpeedMultiplier, 0.44, 1.16);
  traversal.pathSpeed = damp(traversal.pathSpeed, speedTarget, 2.1, deltaSeconds);
  traversal.progress += (deltaSeconds / traversal.segmentDuration) * traversal.pathSpeed * (1 + traversal.segmentEscape * 0.26);
  traversal.bendPhase += deltaSeconds * (0.28 + audio.bend * 0.24 + audio.midDrive * 0.06);
  traversal.driftPhase += deltaSeconds * (0.16 + audio.ambient * 0.22);
  traversal.palettePhase = (traversal.palettePhase + deltaSeconds * (0.016 + audio.palette * 0.024 + audio.highDrive * 0.012)) % 1;

  while (traversal.progress >= 1) {
    advanceSegment(aspectRatio);
  }

  const from = family.pointsOfInterest[traversal.currentIndex];
  const to = family.pointsOfInterest[traversal.nextIndex];
  const easedPath = smoothStep(clamp(traversal.progress, 0, 1));
  const directionX = to.center.x - from.center.x;
  const directionY = to.center.y - from.center.y;
  const directionLength = Math.hypot(directionX, directionY);
  const fallbackAngle = traversal.segmentSeed * 1.13;
  const unitX = directionLength > 0.000001 ? directionX / directionLength : Math.cos(fallbackAngle);
  const unitY = directionLength > 0.000001 ? directionY / directionLength : Math.sin(fallbackAngle);
  const normalX = -unitY;
  const normalY = unitX;
  const zoomDistance = Math.abs(Math.log(Math.max(from.scale, 0.000001) / Math.max(to.scale, 0.000001)));
  const segmentSpan = Math.max(directionLength, (from.scale + to.scale) * (0.6 + zoomDistance * 0.22));
  const bendLift =
    segmentSpan *
    ((from.bend + to.bend) * 0.5 + Math.sin(traversal.bendPhase + traversal.segmentSeed) * 0.045 * audio.bend * reactivity);
  const controlA = {
    x: from.center.x + unitX * segmentSpan * 0.32 + normalX * bendLift,
    y: from.center.y + unitY * segmentSpan * 0.32 + normalY * bendLift,
  };
  const controlB = {
    x: to.center.x - unitX * segmentSpan * 0.28 - normalX * bendLift * 0.84,
    y: to.center.y - unitY * segmentSpan * 0.28 - normalY * bendLift * 0.84,
  };
  const pathPoint = cubicBezierPoint(from.center, controlA, controlB, to.center, easedPath);
  const baseScale = Math.exp(lerp(Math.log(from.scale), Math.log(to.scale), easedPath));
  const tangent = cubicBezierTangent(from.center, controlA, controlB, to.center, easedPath);
  const tangentAhead = cubicBezierTangent(from.center, controlA, controlB, to.center, clamp(easedPath + 0.08, 0, 1));
  const tangentMagnitude = Math.max(Math.hypot(tangent.x, tangent.y), 0.000001);
  const tangentUnit = {
    x: tangent.x / tangentMagnitude,
    y: tangent.y / tangentMagnitude,
  };
  const normalUnit = {
    x: -tangentUnit.y,
    y: tangentUnit.x,
  };
  const leadDistance = baseScale * clamp(0.026 + traversal.pathSpeed * 0.018 + traversal.segmentEscape * 0.018, 0.026, 0.07);
  const railAnchor = {
    x: pathPoint.x + tangentUnit.x * leadDistance,
    y: pathPoint.y + tangentUnit.y * leadDistance,
  };
  const localRadius = lerp(from.localRadius, to.localRadius, easedPath);
  const tangentLimit = baseScale * clamp(localRadius * 1.14 + traversal.segmentEscape * 0.028, 0.07, 0.19);
  const normalLimit = baseScale * clamp(localRadius * 0.82 + traversal.segmentEscape * 0.018, 0.055, 0.14);

  updateInterestGuidance(railAnchor, baseScale, deltaSeconds, now, tangentUnit, normalUnit, tangentLimit, normalLimit);

  const driftNormal = Math.sin(traversal.driftPhase + traversal.segmentSeed * 0.61) * baseScale * (0.007 + audio.ambient * 0.007);
  const driftTangent = Math.cos(traversal.driftPhase * 0.63 - traversal.segmentSeed * 0.27) * baseScale * (0.004 + audio.ambient * 0.004);
  const driftX = tangentUnit.x * driftTangent + normalUnit.x * driftNormal;
  const driftY = tangentUnit.y * driftTangent + normalUnit.y * driftNormal;
  const tangentAngle = Math.atan2(tangentUnit.y, tangentUnit.x);
  const tangentAheadAngle = Math.atan2(tangentAhead.y, tangentAhead.x);
  const headingBias = clamp(Math.sin(tangentAngle) * 0.035, -0.035, 0.035);
  const curvatureBank = clamp(angleDelta(tangentAheadAngle, tangentAngle) * 3.1, -0.16, 0.16);
  const focusNormalAmount = interest.focusOffset.x * normalUnit.x + interest.focusOffset.y * normalUnit.y;
  const correctionBank = clamp((focusNormalAmount / Math.max(normalLimit, 0.000001)) * 0.05, -0.05, 0.05);
  const pulseZoomKick = pulse.confidence * (pulse.impact * 0.015 + pulse.anticipation * 0.006);
  const rotationTarget =
    lerp(from.rotation + from.bank, to.rotation + to.bank, easedPath) +
    headingBias +
    curvatureBank +
    correctionBank +
    Math.sin(traversal.bendPhase * 0.42 + traversal.segmentSeed) * (0.008 + audio.bend * 0.014) +
    (audio.temperature - 0.5) * 0.024 * reactivity +
    traversal.transitionRotationOffset;
  const audioZoomFactor = 1 - (audio.zoom * 0.03 + pulseZoomKick) * reactivity * interest.zoomPermission;
  const railPull = lerp(from.railPull, to.railPull, easedPath);
  const correctionInfluence = clamp((1 - railPull) * 2.2 + traversal.segmentEscape * 0.08, 0.42, 0.72);

  traversal.desiredCamera = {
    center: {
      x: railAnchor.x + interest.focusOffset.x * correctionInfluence + driftX,
      y: railAnchor.y + interest.focusOffset.y * correctionInfluence + driftY,
    },
    scale: clamp(baseScale * interest.zoomGovernor * audioZoomFactor * traversal.transitionScaleMultiplier, 0.02, 3.2),
    rotation: rotationTarget,
  };

  // The desired camera can move more assertively while the rendered camera eases after it.
  // That extra inertial layer is what makes the flight read as intentional instead of reactive.
  const centerLag = distance(traversal.camera.center, traversal.desiredCamera.center) / Math.max(baseScale, 0.000001);
  const scaleLag = Math.abs(Math.log(Math.max(traversal.camera.scale, 0.000001) / Math.max(traversal.desiredCamera.scale, 0.000001)));
  const centerResponse = 1.15 + clamp(centerLag, 0, 0.8) * 0.65 + traversal.segmentEscape * 0.45;
  const scaleResponse = 1.28 + scaleLag * 1.08 + traversal.segmentEscape * 0.32;
  const rotationResponse = 1.32 + Math.abs(curvatureBank) * 3.2;

  traversal.camera = {
    center: {
      x: damp(traversal.camera.center.x, traversal.desiredCamera.center.x, centerResponse, deltaSeconds),
      y: damp(traversal.camera.center.y, traversal.desiredCamera.center.y, centerResponse, deltaSeconds),
    },
    scale: damp(traversal.camera.scale, traversal.desiredCamera.scale, scaleResponse, deltaSeconds),
    rotation: dampAngle(traversal.camera.rotation, traversal.desiredCamera.rotation, rotationResponse, deltaSeconds),
  };
}

function getQualityProfile(refinement: number) {
  // Quality climbs back in discrete steps so we do not churn render-target sizes every frame.
  if (refinement < 0.34) {
    return {
      renderScale: 0.5,
      stableAA: 0.14,
      iterationBias: -0.18,
    };
  }

  if (refinement < 0.78) {
    return {
      renderScale: 0.75,
      stableAA: 0.52,
      iterationBias: 0.12,
    };
  }

  return {
    renderScale: 1,
    stableAA: 1,
    iterationBias: 0.72,
  };
}

function renderFractal(deltaSeconds: number) {
  if (
    !ensureRenderer() ||
    !renderState.gl ||
    !renderState.fractalProgram ||
    !renderState.compositeProgram ||
    !renderState.presentProgram ||
    !renderState.fractalUniforms ||
    !renderState.compositeUniforms ||
    !renderState.presentUniforms ||
    renderState.displayWidth <= 0 ||
    renderState.displayHeight <= 0
  ) {
    return;
  }

  const gl = renderState.gl;
  const fractalUniforms = renderState.fractalUniforms;
  const compositeUniforms = renderState.compositeUniforms;
  const presentUniforms = renderState.presentUniforms;
  const aspectRatio = renderState.displayWidth / Math.max(renderState.displayHeight, 1);
  const currentPoi = family.pointsOfInterest[traversal.currentIndex];
  const nextPoi = family.pointsOfInterest[traversal.nextIndex];
  const pizzaSymmetry = getPizzaSymmetryState();
  const pulseImpact = pulse.impact * pulse.confidence;
  const pulseAnticipation = pulse.anticipation * pulse.confidence;
  const pulseGlow = pulseImpact * 0.9 + pulseAnticipation * 0.4;
  const pizzaPathMix = smoothStep(clamp(traversal.progress, 0, 1));
  const pizzaAnchor = {
    x: lerp(currentPoi.center.x, nextPoi.center.x, pizzaPathMix * 0.34),
    y: lerp(currentPoi.center.y, nextPoi.center.y, pizzaPathMix * 0.34),
  };
  const shaderCenter = isPizzaLayout.value
    ? {
        x: lerp(pizzaAnchor.x, traversal.camera.center.x, 0.18),
        y: lerp(pizzaAnchor.y, traversal.camera.center.y, 0.18),
      }
    : traversal.camera.center;
  const shaderScale = isPizzaLayout.value
    ? clamp(
        Math.exp(lerp(Math.log(Math.max(currentPoi.scale, 0.02)), Math.log(Math.max(nextPoi.scale, 0.02)), pizzaPathMix)) * 4.8,
        0.28,
        1.05
      )
    : traversal.camera.scale;
  const renderViewport: FractalViewport = {
    center: {
      x: shaderCenter.x,
      y: shaderCenter.y,
    },
    scale: shaderScale,
    rotation: traversal.camera.rotation,
  };
  const zoomDepth = Math.max(0, Math.log2(2.35 / Math.max(renderViewport.scale, 0.000001)));
  const dprBias = Math.max(0, Math.sqrt(renderState.dpr) - 1);
  const structuralBias = (fractalMutation.parameters.power - 2) * 0.18 + fractalMutation.parameters.trapMix * 0.05;
  const centerMotion = renderState.lastCamera
    ? distance(renderState.lastCamera.center, renderViewport.center) / Math.max(renderViewport.scale, 0.000001)
    : 0;
  const zoomMotion = renderState.lastCamera
    ? Math.abs(Math.log(renderState.lastCamera.scale / renderViewport.scale))
    : 0;
  const rotationMotion = renderState.lastCamera
    ? Math.abs(angleDelta(renderViewport.rotation, renderState.lastCamera.rotation))
    : 0;
  const motionTarget = centerMotion + zoomMotion * 1.8 + rotationMotion * 0.55;

  renderState.motion = damp(renderState.motion, motionTarget, 10, deltaSeconds);

  const stabilityTarget = clamp(1 - renderState.motion * 12, 0, 1);
  const refinementResponse = stabilityTarget > renderState.refinement ? 1.15 : 6.8;
  renderState.refinement = damp(renderState.refinement, stabilityTarget, refinementResponse, deltaSeconds);

  const quality = getQualityProfile(renderState.refinement);
  const currentWidth = Math.max(1, Math.round(renderState.displayWidth * quality.renderScale));
  const currentHeight = Math.max(1, Math.round(renderState.displayHeight * quality.renderScale));
  const pizzaLayoutMix = isPizzaLayout.value ? 1 : 0;
  const layoutModeValue = isCoinLayout.value ? 2 : pizzaLayoutMix;
  const pizzaWarp = isPizzaLayout.value
    ? clamp(0.14 + audio.bend * 0.1 + audio.highDrive * 0.06 + audio.spectralFlux * 0.05 + pizzaSymmetry.strength * 0.04 + pulseAnticipation * 0.05, 0.14, 0.42)
    : 0;
  const pizzaSpin =
    pizzaFieldMotion.rotation +
    traversal.camera.rotation * 0.12 +
    traversal.palettePhase * TAU * 0.06 +
    (audio.temperature - 0.5) * 0.18;
  const pizzaMorph =
    traversal.bendPhase * 0.42 +
    traversal.driftPhase * 0.28 +
    fractalMutation.depth * 2.4 +
    audio.zoom * 0.36 +
    audio.spectralFlux * 0.7 +
    pulseImpact * 0.28 +
    pulseAnticipation * 0.12;
  const pizzaBackdropRotation = angleDelta(pizzaFieldMotion.backdropLagRotation, pizzaFieldMotion.rotation) * 1.18;
  const pizzaBackdropTorsion = pizzaFieldMotion.backdropTorsion * 1.08;
  const coinRadius = clamp(0.78 + coinMotion.lift * 0.08 + audio.zoom * 0.02 + pulseImpact * 0.02, 0.74, 0.94);
  const coinDepth = clamp(0.98 - coinMotion.lift * 0.34 - pulseImpact * 0.06, 0.72, 1.16);
  const coinOffset = {
    x: coinMotion.offsetX + Math.sin(coinMotion.precession * 0.45) * 0.008 * (1 - coinMotion.settle),
    y: coinMotion.offsetY,
  };
  const coinAxisYaw = wrapAngle(
    coinMotion.precession * 0.88 +
      traversal.palettePhase * TAU * 0.06 +
      pizzaFieldMotion.rotation * 0.08 +
      Math.sin(coinMotion.wobblePhase * 0.52 + traversal.segmentSeed * TAU) * (0.12 + (1 - coinMotion.settle) * 0.12)
  );
  // Keep the main spin axis mostly in the screen plane so body rotation reads as a true 3D turn, not just face spin.
  const coinSpinAxis = normalizeVector3({
    x: Math.cos(coinAxisYaw) * (0.94 + Math.abs(coinMotion.tiltY) * 0.08) - coinMotion.tiltY * 0.06,
    y:
      Math.sin(coinAxisYaw) * (0.86 + Math.abs(coinMotion.tiltX) * 0.08) +
      coinMotion.tiltX * 0.14 +
      pulseAnticipation * 0.04,
    z: clamp(0.18 + coinMotion.lift * 0.18 + audio.bassDrive * 0.08 + pulseImpact * 0.12 + Math.abs(coinMotion.flipVelocity) * 0.012, 0.14, 0.46),
  });
  const coinShimmer = clamp(0.16 + coinMotion.shimmer * 0.72 + audio.highDrive * 0.08 + pulseGlow * 0.04, 0.16, 0.98);

  if (
    !ensureRenderTarget(gl, renderState.currentTarget, currentWidth, currentHeight, gl.LINEAR) ||
    !ensureRenderTarget(gl, renderState.historyTargets[0], renderState.displayWidth, renderState.displayHeight, gl.LINEAR) ||
    !ensureRenderTarget(gl, renderState.historyTargets[1], renderState.displayWidth, renderState.displayHeight, gl.LINEAR)
  ) {
    resetTemporalState();
    return;
  }

  const currentAspectRatio = currentWidth / Math.max(currentHeight, 1);
  const stableAA = clamp(quality.stableAA * (0.42 + stabilityTarget * 0.58), 0, 1);
  const maxIterations = family.getMaxIterations(
    renderViewport.scale,
    clamp(quality.iterationBias + dprBias + zoomDepth * 0.08 + structuralBias - traversal.voidMix * 0.42 - pizzaLayoutMix * 0.12, -0.4, 1.6)
  );

  gl.bindFramebuffer(gl.FRAMEBUFFER, renderState.currentTarget.framebuffer);
  gl.viewport(0, 0, currentWidth, currentHeight);
  gl.useProgram(renderState.fractalProgram);
  gl.uniform2f(fractalUniforms.resolution, currentWidth, currentHeight);
  gl.uniform2f(fractalUniforms.center, renderViewport.center.x, renderViewport.center.y);
  gl.uniform1f(fractalUniforms.scale, renderViewport.scale);
  gl.uniform1f(fractalUniforms.rotation, renderViewport.rotation);
  gl.uniform1f(fractalUniforms.aspect, currentAspectRatio);
  const palettePhase =
    traversal.palettePhase + family.pointsOfInterest[traversal.currentIndex].hueOffset + (audio.temperature - 0.5) * 0.08;
  gl.uniform1f(fractalUniforms.palettePhase, ((palettePhase % 1) + 1) % 1);
  gl.uniform1f(fractalUniforms.ambientLift, (0.07 + audio.ambient * 0.08 + pulseGlow * 0.03) * (1 - traversal.voidMix * 0.82));
  gl.uniform1f(fractalUniforms.paletteEnergy, (0.14 + audio.palette * 0.12 + audio.highDrive * 0.06 + pulseGlow * 0.05) * (1 - traversal.voidMix * 0.9));
  gl.uniform1f(fractalUniforms.stableAA, stableAA);
  gl.uniform1i(fractalUniforms.maxIterations, maxIterations);
  gl.uniform1f(fractalUniforms.structurePower, fractalMutation.parameters.power);
  gl.uniform1f(fractalUniforms.trapMix, fractalMutation.parameters.trapMix);
  gl.uniform1f(fractalUniforms.trapScale, fractalMutation.parameters.trapScale);
  gl.uniform1f(fractalUniforms.paletteBias, fractalMutation.parameters.paletteBias);
  gl.uniform1f(fractalUniforms.voidFade, traversal.voidMix);
  gl.uniform1f(fractalUniforms.voidCollapse, traversal.voidCollapse);
  gl.uniform1f(fractalUniforms.layoutMode, layoutModeValue);
  gl.uniform1f(fractalUniforms.sliceCount, pizzaSymmetry.order);
  gl.uniform1f(fractalUniforms.pizzaWarp, pizzaWarp);
  gl.uniform1f(fractalUniforms.pizzaSpin, pizzaSpin);
  gl.uniform1f(fractalUniforms.pizzaMorph, pizzaMorph);
  gl.uniform1f(fractalUniforms.symmetryGroup, pizzaSymmetry.group === "dihedral" ? 1 : 0);
  gl.uniform1f(fractalUniforms.symmetryMode, pizzaSymmetry.modeIndex);
  gl.uniform1f(fractalUniforms.symmetryStrength, pizzaSymmetry.strength);
  gl.uniform2f(fractalUniforms.coinTilt, coinMotion.tiltX, coinMotion.tiltY);
  gl.uniform1f(fractalUniforms.coinSpin, coinMotion.spin);
  gl.uniform1f(fractalUniforms.coinPrecession, wrapAngle(coinMotion.precession + traversal.palettePhase * TAU * 0.04));
  gl.uniform1f(fractalUniforms.coinFlip, coinMotion.flip);
  gl.uniform1f(fractalUniforms.coinDepth, coinDepth);
  gl.uniform1f(fractalUniforms.coinRadius, coinRadius);
  gl.uniform2f(fractalUniforms.coinOffset, coinOffset.x, coinOffset.y);
  gl.uniform3f(fractalUniforms.coinSpinAxis, coinSpinAxis.x, coinSpinAxis.y, coinSpinAxis.z);
  gl.uniform1f(fractalUniforms.coinShimmer, coinShimmer);
  gl.uniform1f(fractalUniforms.pizzaBackdropRotation, pizzaBackdropRotation);
  gl.uniform1f(fractalUniforms.pizzaBackdropTorsion, pizzaBackdropTorsion);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  const historyReadTarget = renderState.historyTargets[renderState.historyReadIndex];
  const historyWriteIndex = 1 - renderState.historyReadIndex;
  const historyWriteTarget = renderState.historyTargets[historyWriteIndex];
  const historyCamera = renderState.historyCamera ?? renderViewport;
  const historyParameters = renderState.historyFractalParameters ?? fractalMutation.parameters;
  const mutationHistoryDelta =
    Math.abs(fractalMutation.parameters.power - historyParameters.power) * 0.32 +
    Math.abs(fractalMutation.parameters.trapMix - historyParameters.trapMix) * 0.22 +
    Math.abs(fractalMutation.parameters.trapScale - historyParameters.trapScale) * 0.18 +
    Math.abs(fractalMutation.parameters.paletteBias - historyParameters.paletteBias) * 0.48;
  const motionHistoryBlend = clamp(0.78 - renderState.motion * 10.5 - mutationHistoryDelta, 0, 0.78);
  const historyBlend =
    !isPizzaLayout.value && renderState.historyValid && motionHistoryBlend > 0
      ? clamp((motionHistoryBlend + (1 - quality.renderScale) * 0.18) * (1 - traversal.voidMix * 0.92), 0, 0.82)
      : 0;

  gl.bindFramebuffer(gl.FRAMEBUFFER, historyWriteTarget.framebuffer);
  gl.viewport(0, 0, renderState.displayWidth, renderState.displayHeight);
  gl.useProgram(renderState.compositeProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, renderState.currentTarget.texture);
  gl.activeTexture(gl.TEXTURE1);
  gl.bindTexture(gl.TEXTURE_2D, historyReadTarget.texture);
  gl.uniform1i(compositeUniforms.currentTexture, 0);
  gl.uniform1i(compositeUniforms.historyTexture, 1);
  gl.uniform2f(compositeUniforms.currentTexelSize, 1 / currentWidth, 1 / currentHeight);
  gl.uniform2f(compositeUniforms.currentCenter, renderViewport.center.x, renderViewport.center.y);
  gl.uniform1f(compositeUniforms.currentScale, renderViewport.scale);
  gl.uniform1f(compositeUniforms.currentRotation, renderViewport.rotation);
  gl.uniform1f(compositeUniforms.currentAspect, aspectRatio);
  gl.uniform2f(compositeUniforms.previousCenter, historyCamera.center.x, historyCamera.center.y);
  gl.uniform1f(compositeUniforms.previousScale, historyCamera.scale);
  gl.uniform1f(compositeUniforms.previousRotation, historyCamera.rotation);
  gl.uniform1f(compositeUniforms.previousAspect, aspectRatio);
  gl.uniform1f(compositeUniforms.historyBlend, historyBlend);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  gl.viewport(0, 0, renderState.displayWidth, renderState.displayHeight);
  gl.useProgram(renderState.presentProgram);
  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, historyWriteTarget.texture);
  gl.uniform1i(presentUniforms.sourceTexture, 0);
  gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

  gl.bindTexture(gl.TEXTURE_2D, null);
  renderState.historyReadIndex = historyWriteIndex;
  renderState.historyValid = true;
  renderState.historyCamera = copyViewport(renderViewport);
  renderState.historyFractalParameters = copyFractalParameters(fractalMutation.parameters);
  renderState.lastCamera = copyViewport(renderViewport);
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
  updateCoinMotion(deltaSeconds, now);
  updatePizzaFieldMotion(deltaSeconds, now);
  updateFractalMutation(deltaSeconds);
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
      resetFractalMutationState();
      resetCoinMotionState();
      resetPizzaFieldMotionState();
      lastFrameTime = 0;
      return;
    }

    resetTraversalState();
    resetInterestState();
    resetAudioState();
    resetFractalMutationState();
    resetCoinMotionState();
    resetPizzaFieldMotionState();
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
    resetFractalMutationState();
    resetCoinMotionState();
    resetPizzaFieldMotionState();
    resetTemporalState();
    lastFrameTime = 0;
  }
);

watch(
  () => fractalLayoutMode.value,
  () => {
    resetTemporalState();
    resetCoinMotionState();
    resetPizzaFieldMotionState();
    interest.lowInterestTime = 0;
    interest.focusTargetHoldUntil = 0;
    traversal.voidMix = 0;
    traversal.voidCollapse = 0;
    traversal.transitionScaleMultiplier = 1;
    traversal.transitionRotationOffset = 0;

    if (traversal.mode !== "explore") {
      setTraversalMode("explore", 0);
    }

    lastFrameTime = 0;
    lastRenderTime = 0;

    if (!visible.value) return;

    renderFractal(1 / 60);
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
