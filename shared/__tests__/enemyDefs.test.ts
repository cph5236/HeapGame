import { describe, it, expect } from 'vitest';
import { ENEMY_DEFS, DEFAULT_ENEMY_PARAMS } from '../enemyDefs';

describe('jumper enemy def', () => {
  it('is a wall-only enemy with the expected texture + score', () => {
    const d = ENEMY_DEFS.jumper;
    expect(d.kind).toBe('jumper');
    expect(d.textureKey).toBe('jumper');
    expect(d.spawnOnHeapWall).toBe(true);
    expect(d.spawnOnHeapSurface).toBe(false);
    expect(d.scoreValue).toBe(150);
    expect(d.displayName).toBe('JUMPER CABLES');
    expect(d.bodyIdle).toBeDefined();
    expect(d.bodyAttack).toBeDefined();
  });

  it('has default spawn params', () => {
    expect(DEFAULT_ENEMY_PARAMS.jumper.spawnStartPxAboveFloor).toBe(3000);
    expect(DEFAULT_ENEMY_PARAMS.jumper.spawnChanceMax).toBe(0.30);
  });
});
