import { createNoise2D, type NoiseFunction2D } from 'simplex-noise';
import type { ScanlineRow } from './HeapPolygon';
import {
  CHUNK_BAND_HEIGHT,
  LAYER_STEP,
  INFINITE_MIN_WIDTH,
  INFINITE_MAX_WIDTH,
  INFINITE_CENTER_DRIFT_MAX,
  INFINITE_NOISE_SCALE,
  INFINITE_DIFFICULTY_RANGE,
  LEDGE_STEP,
  LEDGE_BLEND,
} from '../constants';

export class LayerGenerator {
  private readonly noise: NoiseFunction2D;
  private readonly colLeft:  number;
  private readonly colRight: number;
  private readonly startY:   number;

  /** Next band top Y to generate (decrements each chunk — heap grows upward). */
  nextBandTop: number;

  constructor(seed: number, colLeft: number, colRight: number, startY: number) {
    this.noise    = createNoise2D(seededPRNG(seed));
    this.colLeft  = colLeft;
    this.colRight = colRight;
    this.startY   = startY;
    this.nextBandTop = Math.ceil(startY / CHUNK_BAND_HEIGHT) * CHUNK_BAND_HEIGHT;
  }

  /** Advance state and return the next 500px chunk upward. */
  nextChunk(): { bandTop: number; rows: ScanlineRow[] } {
    const bandTop    = this.nextBandTop - CHUNK_BAND_HEIGHT;
    this.nextBandTop = bandTop;
    return { bandTop, rows: this.rowsForBand(bandTop) };
  }

  /** Pure — generate rows for any band without advancing state. */
  rowsForBand(bandTop: number): ScanlineRow[] {
    const bandBottom = bandTop + CHUNK_BAND_HEIGHT;
    const rows: ScanlineRow[] = [];
    const colMid = (this.colLeft + this.colRight) / 2;

    for (let y = bandTop; y <= bandBottom; y += LAYER_STEP) {
      const t         = clamp01((this.startY - y) / INFINITE_DIFFICULTY_RANGE);
      const scale     = lerp(INFINITE_NOISE_SCALE, 300, t);
      const minW      = lerp(INFINITE_MIN_WIDTH, 80, t);
      const driftMax  = lerp(INFINITE_CENTER_DRIFT_MAX, 350, t);

      const snappedY  = Math.floor(y / LEDGE_STEP) * LEDGE_STEP;
      const sampleY   = lerp(y, snappedY, LEDGE_BLEND);
      const ny        = sampleY / scale;
      const ny2       = sampleY / (scale * 0.35);
      const centerX   = colMid + this.noise(0, ny) * driftMax * 0.7 + this.noise(0, ny2) * driftMax * 0.3;
      const leftHalf  = lerp(minW / 2, INFINITE_MAX_WIDTH / 2, ((this.noise(1, ny) * 0.7 + this.noise(1, ny2) * 0.3) + 1) / 2);
      const rightHalf = lerp(minW / 2, INFINITE_MAX_WIDTH / 2, ((this.noise(2, ny) * 0.7 + this.noise(2, ny2) * 0.3) + 1) / 2);

      let leftX  = Math.max(this.colLeft,  centerX - leftHalf);
      let rightX = Math.min(this.colRight, centerX + rightHalf);

      if (rightX - leftX < minW) {
        const mid = (leftX + rightX) / 2;
        leftX  = Math.max(this.colLeft,  mid - minW / 2);
        rightX = Math.min(this.colRight, mid + minW / 2);
      }

      rows.push({ y, leftX, rightX });
    }

    return rows;
  }
}

function seededPRNG(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0x100000000;
  };
}

function clamp01(t: number): number { return Math.max(0, Math.min(1, t)); }
function lerp(a: number, b: number, t: number): number { return a + (b - a) * t; }
