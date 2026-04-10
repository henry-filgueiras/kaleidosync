export interface SurfaceOracleControls {
  amplitude: number;
  radius: number;
  damping: number;
  propagationSpeed: number;
  viscosity: number;
  sourceFrequency: number;
  emitterStrength: number;
}

export type SurfaceOracleControlKey = keyof SurfaceOracleControls;
export type SurfaceOracleClickMode = "impulse" | "emitter";
export const SURFACE_ORACLE_EMITTER_VOICE_IDS = ["downbeat", "four-floor", "anticipation", "novelty", "bass", "shimmer"] as const;
export type SurfaceOracleEmitterVoiceId = (typeof SURFACE_ORACLE_EMITTER_VOICE_IDS)[number];
export type SurfaceOracleEmitterPlacementMode = "cycle" | SurfaceOracleEmitterVoiceId;

export interface SurfaceOraclePreset {
  id: Exclude<SurfaceOraclePresetId, "custom">;
  name: string;
  description: string;
  accent: string;
  controls: SurfaceOracleControls;
}

export interface SurfaceOraclePointerSample {
  x: number;
  y: number;
  inside: boolean;
}

export interface SurfaceOracleEmitter {
  id: number;
  x: number;
  y: number;
  voiceId: SurfaceOracleEmitterVoiceId;
  phaseOffset: number;
}

export interface SurfaceOracleEmitterVoiceCount {
  voiceId: SurfaceOracleEmitterVoiceId;
  count: number;
}

export interface SurfaceOracleDiagnosticsSnapshot {
  fps: number;
  gridWidth: number;
  gridHeight: number;
  cellSize: number;
  pointer: SurfaceOraclePointerSample;
  emitterCount: number;
  emitterVoices: SurfaceOracleEmitterVoiceCount[];
}

export interface SurfaceOracleImpulseOptions {
  amplitude: number;
  radius: number;
}

export interface SurfaceOracleEmitterDrive {
  amplitude: number;
  radius: number;
  glow: number;
}

export interface SurfaceOracleSimulationSnapshot {
  cols: number;
  rows: number;
  cellSize: number;
  height: Float32Array;
  emitters: readonly SurfaceOracleEmitter[];
  timeSeconds: number;
}

export const SURFACE_ORACLE_PRESET_IDS = ["calm-glass", "water", "standing-wave", "mercury", "custom"] as const;
export type SurfaceOraclePresetId = (typeof SURFACE_ORACLE_PRESET_IDS)[number];
