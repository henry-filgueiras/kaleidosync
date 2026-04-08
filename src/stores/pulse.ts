import { acceptHMRUpdate, defineStore } from "pinia";
import { reactive, toRefs, watch } from "vue";
import { AudioSource } from "@wearesage/shared";
import { useSpotify } from "@wearesage/vue/stores/spotify";
import { useSources } from "./sources";

type BeatEntry = {
  start: number | string;
  duration?: number | string;
};

type SpotifyBeatAnalysis = {
  audioAnalysis?: {
    beats?: BeatEntry[];
  };
  track?: {
    timestamp?: number | string;
    item?: {
      id?: string;
    };
  };
};

export type SharedPulseSnapshot = {
  impact: number;
  phase: number;
  anticipation: number;
  confidence: number;
  estimatedIntervalMs: number;
};

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function createSilentPulseSnapshot(): SharedPulseSnapshot {
  return {
    impact: 0,
    phase: 0,
    anticipation: 0,
    confidence: 0,
    estimatedIntervalMs: 0,
  };
}

export const usePulse = defineStore("pulse", () => {
  const sources = useSources();
  const spotify = useSpotify();
  const pulse = reactive<SharedPulseSnapshot>(createSilentPulseSnapshot());

  let samplerId: number | null = null;
  let lastImpactAt = 0;
  let lastHeuristicBeatAt = 0;
  let heuristicIntervals: number[] = [];
  let fastLogVolume = 0;
  let slowLogVolume = 0;
  let noveltyHistory: number[] = [];
  let lastNoveltyResponse = 0;
  let spotifyBeatIndex = 0;
  let lastSpotifyTrackId = "";
  let lastSpotifyBeatKey = "";

  function reset() {
    Object.assign(pulse, createSilentPulseSnapshot());
    lastImpactAt = 0;
    lastHeuristicBeatAt = 0;
    heuristicIntervals = [];
    fastLogVolume = 0;
    slowLogVolume = 0;
    noveltyHistory = [];
    lastNoveltyResponse = 0;
    spotifyBeatIndex = 0;
    lastSpotifyTrackId = "";
    lastSpotifyBeatKey = "";
  }

  function getBeatDurationMs(beats: BeatEntry[], index: number) {
    const beat = beats[index];
    const nextBeat = beats[index + 1];
    const explicitDuration = Number(beat?.duration) * 1000;

    if (Number.isFinite(explicitDuration) && explicitDuration > 0) {
      return explicitDuration;
    }

    if (nextBeat) {
      return Math.max(180, (Number(nextBeat.start) - Number(beat.start)) * 1000);
    }

    return 500;
  }

  function registerImpact(now: number, intervalMs?: number) {
    lastImpactAt = now;
    pulse.impact = 1;

    if (intervalMs && Number.isFinite(intervalMs) && intervalMs >= 180 && intervalMs <= 1600) {
      pulse.estimatedIntervalMs = intervalMs;
    }
  }

  function updateImpact(now: number) {
    if (!lastImpactAt) {
      pulse.impact = 0;
      return;
    }

    pulse.impact = clamp(1 - (now - lastImpactAt) / 520, 0, 1);
  }

  function updateSpotifyBeat(now: number) {
    if (sources.source !== AudioSource.SPOTIFY || !spotify.playing) return false;

    const analysis = spotify.analysisData as SpotifyBeatAnalysis | null;
    const beats = analysis?.audioAnalysis?.beats;
    const timestamp = Number(analysis?.track?.timestamp);
    const trackId = String(analysis?.track?.item?.id || "");

    if (!Array.isArray(beats) || beats.length === 0 || !Number.isFinite(timestamp) || !trackId) {
      return false;
    }

    if (lastSpotifyTrackId !== trackId) {
      lastSpotifyTrackId = trackId;
      spotifyBeatIndex = 0;
      lastSpotifyBeatKey = "";
    }

    const positionMs = now - timestamp;
    if (positionMs < 0) return false;

    let index = spotifyBeatIndex;

    while (index > 0 && positionMs < Number(beats[index].start) * 1000) {
      index--;
    }

    while (index < beats.length - 1 && positionMs >= Number(beats[index].start) * 1000 + getBeatDurationMs(beats, index)) {
      index++;
    }

    spotifyBeatIndex = index;

    const beatStartMs = Number(beats[index].start) * 1000;
    const beatDurationMs = getBeatDurationMs(beats, index);
    const beatKey = `${trackId}:${index}`;

    if (beatKey !== lastSpotifyBeatKey) {
      lastSpotifyBeatKey = beatKey;
      registerImpact(now, beatDurationMs);
    }

    pulse.phase = clamp((positionMs - beatStartMs) / beatDurationMs, 0, 1);
    pulse.anticipation = Math.pow(clamp((pulse.phase - 0.56) / 0.44, 0, 1), 1.35);
    pulse.confidence = 1;

    return true;
  }

  function updateHeuristicBeat(now: number) {
    const volume = clamp(Number(sources.volume) || 0, 0, 1);
    const logVolume = Math.log1p(volume * 48) / Math.log1p(48);
    const fastAlpha = 0.34;
    const slowAlpha = 0.08;

    fastLogVolume += (logVolume - fastLogVolume) * fastAlpha;
    slowLogVolume += (logVolume - slowLogVolume) * slowAlpha;

    const novelty = Math.max(0, fastLogVolume - slowLogVolume);
    noveltyHistory.push(novelty);

    if (noveltyHistory.length > 32) {
      noveltyHistory.splice(0, noveltyHistory.length - 32);
    }

    const noveltyMean =
      noveltyHistory.length > 0 ? noveltyHistory.reduce((sum, value) => sum + value, 0) / noveltyHistory.length : novelty;
    const noveltyDeviation =
      noveltyHistory.length > 1
        ? Math.sqrt(noveltyHistory.reduce((sum, value) => sum + Math.pow(value - noveltyMean, 2), 0) / noveltyHistory.length)
        : noveltyMean;
    const noveltyZ = Math.max(0, (novelty - noveltyMean) / Math.max(noveltyDeviation, 0.015));
    const noveltyResponse = 1 - Math.exp(-2.8 * noveltyZ);
    const responseRise = noveltyResponse - lastNoveltyResponse;

    const refractoryMs = pulse.estimatedIntervalMs > 0 ? Math.max(250, pulse.estimatedIntervalMs * 0.42) : 280;
    const sinceLastBeat = lastHeuristicBeatAt ? now - lastHeuristicBeatAt : Infinity;
    const detectedBeat = noveltyResponse > 0.52 && responseRise > 0.035 && sinceLastBeat >= refractoryMs;

    lastNoveltyResponse = noveltyResponse;

    if (detectedBeat) {
      if (lastHeuristicBeatAt) {
        const interval = now - lastHeuristicBeatAt;

        if (interval >= 180 && interval <= 1600) {
          heuristicIntervals.push(interval);

          if (heuristicIntervals.length > 6) {
            heuristicIntervals.splice(0, heuristicIntervals.length - 6);
          }

          const averageInterval = heuristicIntervals.reduce((sum, value) => sum + value, 0) / heuristicIntervals.length;
          registerImpact(now, averageInterval);
        } else {
          registerImpact(now);
        }
      } else {
        registerImpact(now);
      }

      lastHeuristicBeatAt = now;
    }

    if (heuristicIntervals.length > 0 && lastHeuristicBeatAt) {
      const averageInterval = heuristicIntervals.reduce((sum, value) => sum + value, 0) / heuristicIntervals.length;
      const deviation = heuristicIntervals.reduce((sum, value) => sum + Math.abs(value - averageInterval), 0) / heuristicIntervals.length;
      const stability = clamp(1 - deviation / Math.max(averageInterval * 0.22, 1), 0, 1);
      const coverage = clamp(heuristicIntervals.length / 4, 0, 1);
      const progress = clamp((now - lastHeuristicBeatAt) / averageInterval, 0, 1);
      const freshness = clamp(
        1 - Math.max(0, now - lastHeuristicBeatAt - averageInterval) / Math.max(averageInterval * 1.6, 1),
        0,
        1
      );

      pulse.phase = progress;
      pulse.anticipation = Math.pow(clamp((progress - 0.6) / 0.4, 0, 1), 1.3) * stability * freshness;
      // Confidence prefers consistent intervals, then lets fresh novelty lift the floor a bit.
      pulse.confidence = clamp(stability * coverage * 0.88 * freshness + noveltyResponse * 0.18, 0, 1);
    } else {
      pulse.phase = 0;
      pulse.anticipation = 0;
      pulse.confidence = 0;
    }
  }

  function tick() {
    if (sources.source === null || sources.source === AudioSource.NONE) {
      if (pulse.impact > 0 || pulse.anticipation > 0 || pulse.confidence > 0 || pulse.phase > 0 || pulse.estimatedIntervalMs > 0) {
        reset();
      }
      return;
    }

    const now = Date.now();
    updateImpact(now);

    if (!updateSpotifyBeat(now)) {
      updateHeuristicBeat(now);
    }
  }

  function ensureSampler() {
    if (typeof window === "undefined" || samplerId !== null) return;
    samplerId = window.setInterval(tick, 40);
  }

  watch(
    () => sources.source,
    () => {
      reset();
    },
    { immediate: true }
  );

  ensureSampler();

  return {
    ...toRefs(pulse),
    reset,
  };
});

if (import.meta.hot) {
  import.meta.hot.accept(acceptHMRUpdate(usePulse, import.meta.hot));
}
