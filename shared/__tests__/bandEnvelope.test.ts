import { describe, it, expect } from 'vitest';
import {
  BAND_SIZE_PX, bandOf, bandMidY, verticesToEnvelope, envelopeToVertices,
  extendsEnvelope, mergeBands, envelopeToRows, bandsToWire, wireToBands,
} from '../heapPolygon/bandEnvelope';

describe('band arithmetic', () => {
  it('matches the client render resolution', () => {
    expect(BAND_SIZE_PX).toBe(20);
  });

  it('maps y to its band and back to the band midpoint', () => {
    expect(bandOf(0)).toBe(0);
    expect(bandOf(19.999)).toBe(0);
    expect(bandOf(20)).toBe(1);
    expect(bandOf(47115)).toBe(2355);
    expect(bandMidY(0)).toBe(10);
    expect(bandMidY(2355)).toBe(47110);
  });
});

describe('verticesToEnvelope', () => {
  it('keeps only the min-x and max-x of each band', () => {
    const env = verticesToEnvelope([
      { x: 300, y: 5 }, { x: 500, y: 12 }, { x: 400, y: 18 },  // band 0
      { x: 250, y: 25 },                                        // band 1
    ]);
    expect(env.get(0)).toEqual({ minX: 300, maxX: 500 });
    expect(env.get(1)).toEqual({ minX: 250, maxX: 250 });
    expect(env.size).toBe(2);
  });

  it('is idempotent — re-enveloping its own output changes nothing', () => {
    const pts = [{ x: 300, y: 5 }, { x: 500, y: 12 }, { x: 250, y: 25 }];
    const once = verticesToEnvelope(pts);
    const twice = verticesToEnvelope(envelopeToVertices(once));
    expect(envelopeToRows(twice)).toEqual(envelopeToRows(once));
  });
});

describe('envelopeToVertices', () => {
  it('emits both extents at band-mid-y, ascending by band', () => {
    const env = verticesToEnvelope([{ x: 300, y: 5 }, { x: 500, y: 12 }, { x: 250, y: 25 }]);
    expect(envelopeToVertices(env)).toEqual([
      { x: 300, y: 10 }, { x: 500, y: 10 }, { x: 250, y: 30 },
    ]);
  });

  it('emits a single vertex for a band whose extents are equal', () => {
    const env = verticesToEnvelope([{ x: 250, y: 25 }]);
    expect(envelopeToVertices(env)).toEqual([{ x: 250, y: 30 }]);
  });

  it('emits nothing for absent bands rather than filling gaps', () => {
    const env = verticesToEnvelope([{ x: 300, y: 5 }, { x: 250, y: 65 }]);
    expect(envelopeToVertices(env)).toEqual([{ x: 300, y: 10 }, { x: 250, y: 70 }]);
  });
});

describe('extendsEnvelope', () => {
  const env = verticesToEnvelope([{ x: 300, y: 5 }, { x: 500, y: 12 }]);

  it('accepts a point outside its band extents', () => {
    expect(extendsEnvelope(env, 299, 5)).toBe(true);
    expect(extendsEnvelope(env, 501, 5)).toBe(true);
  });

  it('rejects a point at or inside its band extents', () => {
    expect(extendsEnvelope(env, 300, 5)).toBe(false);
    expect(extendsEnvelope(env, 400, 5)).toBe(false);
    expect(extendsEnvelope(env, 500, 5)).toBe(false);
  });

  it('accepts any point in an empty band', () => {
    expect(extendsEnvelope(env, 400, 25)).toBe(true);
  });
});

describe('mergeBands', () => {
  it('widens with MIN/MAX rather than replacing', () => {
    const env = verticesToEnvelope([{ x: 300, y: 5 }, { x: 500, y: 12 }]);
    const merged = mergeBands(env, [{ band: 0, minX: 400, maxX: 600 }]);
    expect(merged.get(0)).toEqual({ minX: 300, maxX: 600 });
  });

  it('inserts bands it has not seen', () => {
    const merged = mergeBands(new Map(), [{ band: 7, minX: 100, maxX: 200 }]);
    expect(merged.get(7)).toEqual({ minX: 100, maxX: 200 });
  });

  it('is idempotent — applying the same rows twice is a no-op', () => {
    const rows = [{ band: 0, minX: 400, maxX: 600 }];
    const once = mergeBands(new Map(), rows);
    const twice = mergeBands(once, rows);
    expect(envelopeToRows(twice)).toEqual(envelopeToRows(once));
  });
});

describe('wire encoding', () => {
  it('round-trips through the flat triple array', () => {
    const rows: ReturnType<typeof envelopeToRows> = [
      { band: 0, minX: 300, maxX: 500 },
      { band: 3, minX: 250, maxX: 250 },
    ];
    expect(bandsToWire(rows)).toEqual([0, 300, 500, 3, 250, 250]);
    expect(wireToBands(bandsToWire(rows))).toEqual(rows);
  });

  it('ignores a trailing partial triple rather than throwing', () => {
    expect(wireToBands([0, 300, 500, 3, 250])).toEqual([{ band: 0, minX: 300, maxX: 500 }]);
  });
});
