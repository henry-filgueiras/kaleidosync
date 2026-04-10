import type {
  SurfaceOracleControls,
  SurfaceOracleEmitter,
  SurfaceOracleImpulseOptions,
  SurfaceOracleSimulationSnapshot,
} from "./types";

const TARGET_ROWS = 112;
const MIN_CELL_SIZE = 5;
const MAX_CELL_SIZE = 10;
const FIXED_STEP = 1 / 60;
const MAX_ACCUMULATED_TIME = 1 / 10;
const MAX_INTEGRATION_STEPS = 4;
const HEIGHT_LIMIT = 4.5;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

export function deriveCellSize(width: number, height: number) {
  const inferred = Math.round(Math.min(width, height) / TARGET_ROWS);
  return clamp(inferred, MIN_CELL_SIZE, MAX_CELL_SIZE);
}

export class HeightFieldSurface {
  private cols = 0;

  private rows = 0;

  private cellSize = 8;

  private currentHeight = new Float32Array(0);

  private previousHeight = new Float32Array(0);

  private nextHeight = new Float32Array(0);

  private accumulator = 0;

  private emitters: SurfaceOracleEmitter[] = [];

  private nextEmitterId = 0;

  private simulationTime = 0;

  resize(width: number, height: number) {
    this.cellSize = deriveCellSize(width, height);
    this.cols = Math.max(2, Math.ceil(width / this.cellSize));
    this.rows = Math.max(2, Math.ceil(height / this.cellSize));

    const size = this.cols * this.rows;
    this.currentHeight = new Float32Array(size);
    this.previousHeight = new Float32Array(size);
    this.nextHeight = new Float32Array(size);
    this.accumulator = 0;
    this.emitters = this.emitters.filter(emitter => emitter.x <= width && emitter.y <= height);
  }

  reset(options: { clearEmitters?: boolean } = {}) {
    this.currentHeight.fill(0);
    this.previousHeight.fill(0);
    this.nextHeight.fill(0);
    this.accumulator = 0;
    this.simulationTime = 0;

    if (options.clearEmitters) {
      this.emitters = [];
      this.nextEmitterId = 0;
    }
  }

  step(deltaSeconds: number, controls: SurfaceOracleControls) {
    this.accumulator += Math.min(deltaSeconds, MAX_ACCUMULATED_TIME);
    let steps = 0;

    while (this.accumulator >= FIXED_STEP && steps < MAX_INTEGRATION_STEPS) {
      this.integrate(controls);
      this.simulationTime += FIXED_STEP;
      this.accumulator -= FIXED_STEP;
      steps += 1;
    }
  }

  injectAtPixel(x: number, y: number, options: SurfaceOracleImpulseOptions) {
    this.applySourceToBuffer(this.currentHeight, x, y, options.amplitude, options.radius);
  }

  toggleEmitterAtPixel(x: number, y: number, proximityRadius = 20): "added" | "removed" {
    const existingIndex = this.emitters.findIndex(emitter => Math.hypot(emitter.x - x, emitter.y - y) <= proximityRadius);

    if (existingIndex >= 0) {
      this.emitters.splice(existingIndex, 1);
      return "removed";
    }

    this.emitters.push({
      id: this.nextEmitterId,
      x,
      y,
    });
    this.nextEmitterId += 1;

    return "added";
  }

  clearEmitters() {
    this.emitters = [];
  }

  getSnapshot(): SurfaceOracleSimulationSnapshot {
    return {
      cols: this.cols,
      rows: this.rows,
      cellSize: this.cellSize,
      height: this.currentHeight,
      emitters: this.emitters,
      timeSeconds: this.simulationTime,
    };
  }

  getCols() {
    return this.cols;
  }

  getRows() {
    return this.rows;
  }

  getCellSize() {
    return this.cellSize;
  }

  getEmitterCount() {
    return this.emitters.length;
  }

  private integrate(controls: SurfaceOracleControls) {
    const energyRetention = clamp(1 - controls.damping, 0.88, 0.998);
    const propagation = controls.propagationSpeed;
    const viscosity = controls.viscosity;

    for (let y = 1; y < this.rows - 1; y += 1) {
      const rowOffset = y * this.cols;

      for (let x = 1; x < this.cols - 1; x += 1) {
        const index = rowOffset + x;
        const current = this.currentHeight[index];
        const previous = this.previousHeight[index];
        const neighborSum =
          this.currentHeight[index - 1] +
          this.currentHeight[index + 1] +
          this.currentHeight[index - this.cols] +
          this.currentHeight[index + this.cols];
        const laplacian = neighborSum - current * 4;
        let next = (current * 2 - previous + laplacian * propagation) * energyRetention;

        if (viscosity > 0) {
          const neighborAverage = neighborSum * 0.25;
          next += (neighborAverage - next) * viscosity;
        }

        this.nextHeight[index] = clamp(next, -HEIGHT_LIMIT, HEIGHT_LIMIT);
      }
    }

    this.applyDrivenEmitters(this.nextHeight, controls, this.simulationTime + FIXED_STEP);
    this.applyReflectiveBoundary(this.nextHeight);

    const swap = this.previousHeight;
    this.previousHeight = this.currentHeight;
    this.currentHeight = this.nextHeight;
    this.nextHeight = swap;
  }

  private applyDrivenEmitters(buffer: Float32Array, controls: SurfaceOracleControls, timeSeconds: number) {
    if (this.emitters.length === 0) return;

    const sourceAmplitude = Math.sin(timeSeconds * controls.sourceFrequency * Math.PI * 2);

    if (Math.abs(sourceAmplitude) < 0.0001) return;

    const drivenAmplitude = controls.amplitude * controls.emitterStrength * 0.28 * sourceAmplitude;
    const drivenRadius = clamp(controls.radius * 0.48, 18, 34);

    for (const emitter of this.emitters) {
      this.applySourceToBuffer(buffer, emitter.x, emitter.y, drivenAmplitude, drivenRadius);
    }
  }

  private applySourceToBuffer(buffer: Float32Array, x: number, y: number, amplitude: number, radius: number) {
    if (this.cols === 0 || this.rows === 0) return;

    const cellX = clamp(Math.round(x / this.cellSize), 0, this.cols - 1);
    const cellY = clamp(Math.round(y / this.cellSize), 0, this.rows - 1);
    const cellRadius = Math.max(1, radius / this.cellSize);
    const radiusSquared = cellRadius * cellRadius;
    const yStart = Math.max(0, Math.floor(cellY - cellRadius));
    const yEnd = Math.min(this.rows - 1, Math.ceil(cellY + cellRadius));
    const xStart = Math.max(0, Math.floor(cellX - cellRadius));
    const xEnd = Math.min(this.cols - 1, Math.ceil(cellX + cellRadius));

    for (let gridY = yStart; gridY <= yEnd; gridY += 1) {
      for (let gridX = xStart; gridX <= xEnd; gridX += 1) {
        const dx = gridX - cellX;
        const dy = gridY - cellY;
        const distanceSquared = dx * dx + dy * dy;

        if (distanceSquared > radiusSquared) continue;

        const normalizedDistance = distanceSquared / radiusSquared;
        const falloff = Math.exp(-normalizedDistance * 3.6);
        const index = gridY * this.cols + gridX;
        buffer[index] = clamp(buffer[index] + amplitude * falloff, -HEIGHT_LIMIT, HEIGHT_LIMIT);
      }
    }
  }

  private applyReflectiveBoundary(buffer: Float32Array) {
    if (this.cols < 2 || this.rows < 2) return;

    for (let x = 0; x < this.cols; x += 1) {
      buffer[x] = buffer[this.cols + x];
      const bottomIndex = (this.rows - 1) * this.cols + x;
      const bottomSourceIndex = (this.rows - 2) * this.cols + x;
      buffer[bottomIndex] = buffer[bottomSourceIndex];
    }

    for (let y = 0; y < this.rows; y += 1) {
      const rowStart = y * this.cols;
      buffer[rowStart] = buffer[rowStart + 1];
      buffer[rowStart + this.cols - 1] = buffer[rowStart + this.cols - 2];
    }
  }
}
