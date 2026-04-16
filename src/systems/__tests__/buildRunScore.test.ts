import { describe, it, expect } from 'vitest';
import { buildRunScore } from '../buildRunScore';
import type { EnemyDef } from '../../data/enemyDefs';
import type { EnemyKind } from '../../entities/Enemy';

const TEST_DEFS: Record<EnemyKind, EnemyDef> = {
  percher: {
    kind: 'percher', textureKey: 'rat', width: 32, height: 32, speed: 55,
    spawnOnHeapSurface: true, spawnOnHeapWall: false,
    spawnStartY: 50000, spawnEndY: -1,
    spawnChanceMin: 0.15, spawnChanceMax: 0.35, spawnRampEndY: 10000,
    displayName: 'RAT', scoreValue: 100,
  },
  ghost: {
    kind: 'ghost', textureKey: 'vulture-fly-left', width: 51, height: 43, speed: 320,
    spawnOnHeapSurface: true, spawnOnHeapWall: false,
    spawnStartY: 50000, spawnEndY: -1,
    spawnChanceMin: 0.25, spawnChanceMax: 0.5, spawnRampEndY: 5000,
    displayName: 'VULTURE', scoreValue: 200,
  },
};

describe('buildRunScore', () => {
  it('returns only height row when no kills and failure run', () => {
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: {}, elapsedMs: 85000 },
      TEST_DEFS,
      true, // isFailure — pace skipped
    );
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toMatchObject({ type: 'height', value: 6000 });
    expect(result.finalScore).toBe(6000);
  });

  it('height row label shows ft reading', () => {
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: {}, elapsedMs: 0 },
      TEST_DEFS,
      true,
    );
    expect(result.rows[0].detail).toBe('600ft');
  });

  it('adds kill row per enemy type with bonus = count x scoreValue', () => {
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: { percher: 2 }, elapsedMs: 0 },
      TEST_DEFS,
      true,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({ type: 'kill', value: 200 });
    expect(result.finalScore).toBe(6200);
  });

  it('adds pace row for successful run', () => {
    // 6000px / 60s × 10 = 1000
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: {}, elapsedMs: 60000 },
      TEST_DEFS,
      false,
    );
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toMatchObject({ type: 'pace', value: 1000 });
    expect(result.finalScore).toBe(7000);
  });

  it('omits pace row for failure runs', () => {
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: {}, elapsedMs: 60000 },
      TEST_DEFS,
      true,
    );
    expect(result.rows.some(r => r.type === 'pace')).toBe(false);
  });

  it('omits pace row when elapsedMs is 0', () => {
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: {}, elapsedMs: 0 },
      TEST_DEFS,
      false,
    );
    expect(result.rows.some(r => r.type === 'pace')).toBe(false);
  });

  it('computes full compound score: height + kills + pace', () => {
    // 6000 + (2×100 + 1×200) + floor(6000/85×10) = 6000 + 400 + 705 = 7105
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: { percher: 2, ghost: 1 }, elapsedMs: 85000 },
      TEST_DEFS,
      false,
    );
    expect(result.finalScore).toBe(7105);
    expect(result.rows).toHaveLength(4); // height, percher, ghost, pace
  });

  it('floors the pace bonus', () => {
    // 6000 / 85s × 10 = 705.88... → 705
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: {}, elapsedMs: 85000 },
      TEST_DEFS,
      false,
    );
    const paceRow = result.rows.find(r => r.type === 'pace')!;
    expect(paceRow.value).toBe(705);
  });

  it('kill row label uses displayName and count', () => {
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: { ghost: 1 }, elapsedMs: 0 },
      TEST_DEFS,
      true,
    );
    expect(result.rows[1].label).toBe('VULTURE x1');
  });

  it('pace row detail shows the formula', () => {
    const result = buildRunScore(
      { baseHeightPx: 6000, kills: {}, elapsedMs: 85000 },
      TEST_DEFS,
      false,
    );
    const paceRow = result.rows.find(r => r.type === 'pace')!;
    expect(paceRow.detail).toBe('6000 / 85s x 10');
  });
});
