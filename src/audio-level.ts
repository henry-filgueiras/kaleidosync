export const RAW_AUDIO_NOISE_FLOOR_DB = -72;

export function rawLevelToDecibels(level: number, noiseFloorDb = RAW_AUDIO_NOISE_FLOOR_DB) {
  if (level <= 0.00001) return noiseFloorDb;
  return Math.max(noiseFloorDb, 20 * Math.log10(level));
}

export function rawDecibelsToPercent(value: number, noiseFloorDb = RAW_AUDIO_NOISE_FLOOR_DB) {
  return Math.max(0, Math.min(100, Math.round(((value - noiseFloorDb) / -noiseFloorDb) * 100)));
}

export function sampleRawAnalyserLevel(analyser: AnalyserNode | null, existingBuffer?: Uint8Array | null) {
  if (!analyser) {
    return {
      level: 0,
      buffer: existingBuffer ?? null,
    };
  }

  const buffer = existingBuffer && existingBuffer.length === analyser.fftSize ? existingBuffer : new Uint8Array(analyser.fftSize);

  analyser.getByteTimeDomainData(buffer);

  let sumSquares = 0;
  for (let i = 0; i < buffer.length; i++) {
    const centered = (buffer[i] - 128) / 128;
    sumSquares += centered * centered;
  }

  return {
    level: Math.max(0, Math.sqrt(sumSquares / buffer.length)),
    buffer,
  };
}
