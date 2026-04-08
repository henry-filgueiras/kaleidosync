import { acceptHMRUpdate, defineStore } from "pinia";
import { reactive, watch } from "vue";
import { audioSystem } from "@wearesage/vue/classes/AudioSystemManager";
import { useSources } from "./sources";

export const SHARED_AUDIO_FEATURE_FFT_SIZE = 1024;
export const SHARED_AUDIO_FEATURE_ANALYSER_SMOOTHING = 0;

const TRACKED_FREQUENCY_MIN_HZ = 24;
const TRACKED_FREQUENCY_MAX_HZ = 12_000;
const FLUX_HISTORY_SIZE = 48;
const MIN_RESAMPLE_INTERVAL_MS = 2;

type AudioBandKey = "bass" | "lowMid" | "mid" | "high" | "air";

type AudioBandDefinition = {
  key: AudioBandKey;
  minHz: number;
  maxHz: number;
};

type PreparedBandRange = {
  key: AudioBandKey;
  start: number;
  end: number;
};

export type SharedAudioFeatureSnapshot = {
  analyserReady: boolean;
  bass: number;
  lowMid: number;
  mid: number;
  high: number;
  air: number;
  spectralFlux: number;
  centroid: number;
  centroidHz: number;
  energy: number;
  novelty: number;
  bandImbalance: number;
};

// Broad musical bands tuned for stable visual control rather than studio-precision metering.
const BAND_DEFINITIONS: AudioBandDefinition[] = [
  { key: "bass", minHz: 24, maxHz: 140 },
  { key: "lowMid", minHz: 140, maxHz: 400 },
  { key: "mid", minHz: 400, maxHz: 2_000 },
  { key: "high", minHz: 2_000, maxHz: 6_000 },
  { key: "air", minHz: 6_000, maxHz: 12_000 },
];

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function damp(current: number, target: number, smoothing: number, deltaSeconds: number) {
  return current + (target - current) * (1 - Math.exp(-smoothing * deltaSeconds));
}

function smoothFeature(current: number, target: number, rise: number, fall: number, deltaSeconds: number) {
  return damp(current, target, target >= current ? rise : fall, deltaSeconds);
}

function createSilentSnapshot(): SharedAudioFeatureSnapshot {
  return {
    analyserReady: false,
    bass: 0,
    lowMid: 0,
    mid: 0,
    high: 0,
    air: 0,
    spectralFlux: 0,
    centroid: 0,
    centroidHz: TRACKED_FREQUENCY_MIN_HZ,
    energy: 0,
    novelty: 0,
    bandImbalance: 0,
  };
}

function averageRange(spectrum: Float32Array, start: number, end: number) {
  if (end <= start) return 0;

  let sum = 0;
  for (let index = start; index < end; index++) {
    sum += spectrum[index];
  }

  return sum / (end - start);
}

function normalizeLogFrequency(valueHz: number, minHz: number, maxHz: number) {
  const safeValue = clamp(valueHz, minHz, maxHz);
  const logMin = Math.log(minHz);
  const logMax = Math.log(maxHz);
  return clamp((Math.log(safeValue) - logMin) / Math.max(logMax - logMin, 0.000001), 0, 1);
}

export const useAudioFeatures = defineStore("audio-features", () => {
  const sources = useSources();
  const features = reactive<SharedAudioFeatureSnapshot>(createSilentSnapshot());

  let frequencyData: Float32Array | null = null;
  let currentSpectrum: Float32Array | null = null;
  let previousSpectrum: Float32Array | null = null;
  let previousSpectrumReady = false;
  let preparedFftSize = 0;
  let preparedSampleRate = 0;
  let trackedStartBin = 1;
  let trackedEndBin = 1;
  let bandRanges: PreparedBandRange[] = [];
  let fastEnergy = 0;
  let slowEnergy = 0;
  let lastAnalyzedAt = 0;
  let fluxHistory = new Float32Array(FLUX_HISTORY_SIZE);
  let fluxHistoryIndex = 0;
  let fluxHistoryLength = 0;

  function resetWorkingState() {
    previousSpectrumReady = false;
    fastEnergy = 0;
    slowEnergy = 0;
    lastAnalyzedAt = 0;
    fluxHistory.fill(0);
    fluxHistoryIndex = 0;
    fluxHistoryLength = 0;

    if (currentSpectrum) currentSpectrum.fill(0);
    if (previousSpectrum) previousSpectrum.fill(0);
  }

  function reset() {
    resetWorkingState();
    Object.assign(features, createSilentSnapshot());
  }

  function prepareAnalyser(analyser: AnalyserNode) {
    // Keep the shared analyser on the repo's existing 1024 FFT contract so the older
    // volume/stream pipeline keeps its timing while this layer gets ~43 Hz bins at 44.1 kHz.
    if (analyser.fftSize !== SHARED_AUDIO_FEATURE_FFT_SIZE) {
      analyser.fftSize = SHARED_AUDIO_FEATURE_FFT_SIZE;
    }

    // Leave analyser smoothing at the legacy setting and smooth features ourselves so we
    // don't silently change the response of existing loudness-driven consumers.
    if (analyser.smoothingTimeConstant !== SHARED_AUDIO_FEATURE_ANALYSER_SMOOTHING) {
      analyser.smoothingTimeConstant = SHARED_AUDIO_FEATURE_ANALYSER_SMOOTHING;
    }

    const sampleRate = analyser.context.sampleRate;
    const binCount = analyser.frequencyBinCount;

    if (
      frequencyData &&
      currentSpectrum &&
      previousSpectrum &&
      preparedFftSize === analyser.fftSize &&
      preparedSampleRate === sampleRate &&
      currentSpectrum.length === binCount
    ) {
      return;
    }

    preparedFftSize = analyser.fftSize;
    preparedSampleRate = sampleRate;
    frequencyData = new Float32Array(binCount);
    currentSpectrum = new Float32Array(binCount);
    previousSpectrum = new Float32Array(binCount);
    bandRanges = [];

    const binFrequency = sampleRate / analyser.fftSize;
    const nyquist = sampleRate * 0.5;
    const trackedMaxHz = Math.min(TRACKED_FREQUENCY_MAX_HZ, nyquist);
    trackedStartBin = clamp(Math.floor(TRACKED_FREQUENCY_MIN_HZ / binFrequency), 1, binCount);
    trackedEndBin = clamp(Math.ceil(trackedMaxHz / binFrequency), trackedStartBin, binCount);

    for (const definition of BAND_DEFINITIONS) {
      const start = clamp(Math.floor(definition.minHz / binFrequency), 1, binCount);
      const end = clamp(Math.ceil(Math.min(definition.maxHz, nyquist) / binFrequency), start, binCount);
      bandRanges.push({
        key: definition.key,
        start,
        end,
      });
    }

    resetWorkingState();
  }

  function decayFeatures(deltaSeconds: number) {
    features.analyserReady = false;
    features.bass = smoothFeature(features.bass, 0, 6.2, 2.4, deltaSeconds);
    features.lowMid = smoothFeature(features.lowMid, 0, 6.2, 2.4, deltaSeconds);
    features.mid = smoothFeature(features.mid, 0, 6.2, 2.4, deltaSeconds);
    features.high = smoothFeature(features.high, 0, 6.8, 2.6, deltaSeconds);
    features.air = smoothFeature(features.air, 0, 6.8, 2.6, deltaSeconds);
    features.spectralFlux = smoothFeature(features.spectralFlux, 0, 7.2, 3.2, deltaSeconds);
    features.centroid = damp(features.centroid, 0, 3.2, deltaSeconds);
    features.centroidHz = damp(features.centroidHz, TRACKED_FREQUENCY_MIN_HZ, 3.2, deltaSeconds);
    features.energy = damp(features.energy, 0, 3.6, deltaSeconds);
    features.novelty = smoothFeature(features.novelty, 0, 5.4, 3.1, deltaSeconds);
    features.bandImbalance = damp(features.bandImbalance, 0, 3.4, deltaSeconds);
  }

  function update(deltaSeconds: number) {
    const analyser = audioSystem.getAnalyserNode();
    const safeDeltaSeconds = clamp(Number(deltaSeconds) || 0, 0, 0.12);

    if (!analyser) {
      decayFeatures(safeDeltaSeconds || 1 / 60);
      return features;
    }

    prepareAnalyser(analyser);

    if (!frequencyData || !currentSpectrum || !previousSpectrum) {
      decayFeatures(safeDeltaSeconds || 1 / 60);
      return features;
    }

    const now = typeof performance !== "undefined" ? performance.now() : Date.now();
    if (features.analyserReady && lastAnalyzedAt && now - lastAnalyzedAt < MIN_RESAMPLE_INTERVAL_MS) {
      return features;
    }

    if (lastAnalyzedAt && now - lastAnalyzedAt > 420) {
      previousSpectrumReady = false;
      fastEnergy = features.energy;
      slowEnergy = features.energy;
      fluxHistory.fill(0);
      fluxHistoryIndex = 0;
      fluxHistoryLength = 0;
    }
    lastAnalyzedAt = now;

    analyser.getFloatFrequencyData(frequencyData);

    const trackedBins = Math.max(1, trackedEndBin - trackedStartBin);
    const dbRange = Math.max(analyser.maxDecibels - analyser.minDecibels, 1);
    const trackedMaxHz = Math.min(TRACKED_FREQUENCY_MAX_HZ, analyser.context.sampleRate * 0.5);
    const binFrequency = analyser.context.sampleRate / analyser.fftSize;
    let energySum = 0;
    let centroidWeightedSum = 0;
    let centroidMagnitudeSum = 0;
    let spectralFluxRaw = 0;

    for (let index = trackedStartBin; index < trackedEndBin; index++) {
      const db = frequencyData[index];
      const normalizedMagnitude = Number.isFinite(db) ? clamp((db - analyser.minDecibels) / dbRange, 0, 1) : 0;

      currentSpectrum[index] = normalizedMagnitude;
      energySum += normalizedMagnitude;
      centroidWeightedSum += index * binFrequency * normalizedMagnitude;
      centroidMagnitudeSum += normalizedMagnitude;

      if (previousSpectrumReady) {
        spectralFluxRaw += Math.max(0, normalizedMagnitude - previousSpectrum[index]);
      }

      previousSpectrum[index] = normalizedMagnitude;
    }

    if (!previousSpectrumReady) {
      spectralFluxRaw = 0;
      previousSpectrumReady = true;
    }

    const bandLevels = {
      bass: 0,
      lowMid: 0,
      mid: 0,
      high: 0,
      air: 0,
    };

    for (const range of bandRanges) {
      bandLevels[range.key] = averageRange(currentSpectrum, range.start, range.end);
    }

    const energyRaw = energySum / trackedBins;
    spectralFluxRaw /= trackedBins;
    fastEnergy = damp(fastEnergy, energyRaw, 8.4, safeDeltaSeconds || 1 / 60);
    slowEnergy = damp(slowEnergy, energyRaw, 1.8, safeDeltaSeconds || 1 / 60);

    fluxHistory[fluxHistoryIndex] = spectralFluxRaw;
    fluxHistoryIndex = (fluxHistoryIndex + 1) % fluxHistory.length;
    fluxHistoryLength = Math.min(fluxHistoryLength + 1, fluxHistory.length);

    let fluxMean = 0;
    for (let index = 0; index < fluxHistoryLength; index++) {
      fluxMean += fluxHistory[index];
    }
    fluxMean /= Math.max(fluxHistoryLength, 1);

    let fluxVariance = 0;
    for (let index = 0; index < fluxHistoryLength; index++) {
      const delta = fluxHistory[index] - fluxMean;
      fluxVariance += delta * delta;
    }

    const fluxDeviation = fluxHistoryLength > 1 ? Math.sqrt(fluxVariance / fluxHistoryLength) : fluxMean;
    const fluxZScore = Math.max(0, (spectralFluxRaw - fluxMean) / Math.max(fluxDeviation, 0.01));
    const spectralFluxTarget = 1 - Math.exp(-1.9 * fluxZScore);
    const noveltyTarget = clamp(Math.max(0, fastEnergy - slowEnergy) * 3 + spectralFluxTarget * 0.4, 0, 1);
    const centroidHz =
      centroidMagnitudeSum > 0 ? centroidWeightedSum / centroidMagnitudeSum : TRACKED_FREQUENCY_MIN_HZ;
    const centroidTarget = normalizeLogFrequency(centroidHz, TRACKED_FREQUENCY_MIN_HZ, trackedMaxHz);
    const bandImbalanceTarget = clamp(
      (bandLevels.high + bandLevels.air) - (bandLevels.bass + bandLevels.lowMid),
      -1,
      1
    );

    features.analyserReady = true;
    features.bass = smoothFeature(features.bass, bandLevels.bass, 7.8, 3.8, safeDeltaSeconds || 1 / 60);
    features.lowMid = smoothFeature(features.lowMid, bandLevels.lowMid, 7.2, 3.6, safeDeltaSeconds || 1 / 60);
    features.mid = smoothFeature(features.mid, bandLevels.mid, 7.2, 3.6, safeDeltaSeconds || 1 / 60);
    features.high = smoothFeature(features.high, bandLevels.high, 8.2, 4.1, safeDeltaSeconds || 1 / 60);
    features.air = smoothFeature(features.air, bandLevels.air, 8.4, 4.3, safeDeltaSeconds || 1 / 60);
    features.spectralFlux = smoothFeature(features.spectralFlux, spectralFluxTarget, 8.4, 3.8, safeDeltaSeconds || 1 / 60);
    features.centroid = damp(features.centroid, centroidTarget, 3.4, safeDeltaSeconds || 1 / 60);
    features.centroidHz = damp(features.centroidHz, centroidHz, 3.4, safeDeltaSeconds || 1 / 60);
    features.energy = damp(features.energy, energyRaw, 4.4, safeDeltaSeconds || 1 / 60);
    features.novelty = smoothFeature(features.novelty, noveltyTarget, 5.8, 3.5, safeDeltaSeconds || 1 / 60);
    features.bandImbalance = damp(features.bandImbalance, bandImbalanceTarget, 3.2, safeDeltaSeconds || 1 / 60);

    return features;
  }

  watch(
    () => sources.source,
    () => {
      reset();
    }
  );

  return {
    features,
    update,
    reset,
    fftSize: SHARED_AUDIO_FEATURE_FFT_SIZE,
    analyserSmoothing: SHARED_AUDIO_FEATURE_ANALYSER_SMOOTHING,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(useAudioFeatures, import.meta.hot));
}
