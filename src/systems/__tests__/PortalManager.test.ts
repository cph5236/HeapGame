import { describe, it, expect } from 'vitest';
import { pickDifferentColumn } from '../PortalManager';

describe('pickDifferentColumn', () => {
  it('never returns the same index as source', () => {
    for (let source = 0; source < 3; source++) {
      for (let trial = 0; trial < 20; trial++) {
        const rng = () => trial / 20;
        const result = pickDifferentColumn(source, 3, rng);
        expect(result).not.toBe(source);
      }
    }
  });

  it('returns a value within [0, numCols)', () => {
    for (let trial = 0; trial < 20; trial++) {
      const result = pickDifferentColumn(0, 3, () => trial / 20);
      expect(result).toBeGreaterThanOrEqual(0);
      expect(result).toBeLessThan(3);
    }
  });
});
