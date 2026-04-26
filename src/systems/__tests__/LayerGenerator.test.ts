import { describe, it, expect } from 'vitest';
import { LayerGenerator } from '../LayerGenerator';
import {
  CHUNK_BAND_HEIGHT,
  INFINITE_MIN_WIDTH,
  MOCK_HEAP_HEIGHT_PX,
} from '../../constants';

const COL_LEFT  = 100;
const COL_RIGHT = 1060;
const START_Y   = MOCK_HEAP_HEIGHT_PX; // world floor — heap starts here

describe('LayerGenerator', () => {
  it('rowsForBand: leftX < rightX for every row', () => {
    const gen = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const rows = gen.rowsForBand(MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT);
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.leftX).toBeLessThan(r.rightX);
    }
  });

  it('rowsForBand: all rows respect column bounds', () => {
    const gen = new LayerGenerator(99, COL_LEFT, COL_RIGHT, START_Y);
    const rows = gen.rowsForBand(MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT);
    for (const r of rows) {
      expect(r.leftX).toBeGreaterThanOrEqual(COL_LEFT);
      expect(r.rightX).toBeLessThanOrEqual(COL_RIGHT);
    }
  });

  it('rowsForBand: width never falls below INFINITE_MIN_WIDTH at t=0', () => {
    // t=0 means y ≈ START_Y (bottom of heap — easiest section)
    const gen = new LayerGenerator(7, COL_LEFT, COL_RIGHT, START_Y);
    const rows = gen.rowsForBand(MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT);
    for (const r of rows) {
      expect(r.rightX - r.leftX).toBeGreaterThanOrEqual(INFINITE_MIN_WIDTH - 1);
    }
  });

  it('rowsForBand: rows are ordered top-to-bottom (increasing y)', () => {
    const gen = new LayerGenerator(1, COL_LEFT, COL_RIGHT, START_Y);
    const rows = gen.rowsForBand(MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT);
    for (let i = 1; i < rows.length; i++) {
      expect(rows[i].y).toBeGreaterThan(rows[i - 1].y);
    }
  });

  it('rowsForBand: deterministic for same seed and band', () => {
    const a = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const b = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const bandTop = MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT;
    expect(a.rowsForBand(bandTop)).toEqual(b.rowsForBand(bandTop));
  });

  it('rowsForBand: different seeds produce different rows', () => {
    const a = new LayerGenerator(1, COL_LEFT, COL_RIGHT, START_Y);
    const b = new LayerGenerator(2, COL_LEFT, COL_RIGHT, START_Y);
    const bandTop = MOCK_HEAP_HEIGHT_PX - CHUNK_BAND_HEIGHT;
    const rowsA = a.rowsForBand(bandTop);
    const rowsB = b.rowsForBand(bandTop);
    expect(rowsA[0].leftX).not.toBeCloseTo(rowsB[0].leftX, 0);
  });

  it('nextChunk: advances nextBandTop by CHUNK_BAND_HEIGHT each call', () => {
    const gen = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const initial = gen.nextBandTop;
    gen.nextChunk();
    expect(gen.nextBandTop).toBe(initial - CHUNK_BAND_HEIGHT);
    gen.nextChunk();
    expect(gen.nextBandTop).toBe(initial - CHUNK_BAND_HEIGHT * 2);
  });

  it('nextChunk: returns rows for the correct band', () => {
    const gen = new LayerGenerator(42, COL_LEFT, COL_RIGHT, START_Y);
    const { bandTop, rows } = gen.nextChunk();
    // All rows should fall within [bandTop, bandTop + CHUNK_BAND_HEIGHT]
    for (const r of rows) {
      expect(r.y).toBeGreaterThanOrEqual(bandTop);
      expect(r.y).toBeLessThanOrEqual(bandTop + CHUNK_BAND_HEIGHT);
    }
  });
});
