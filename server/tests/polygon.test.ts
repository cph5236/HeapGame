import { describe, it, expect } from 'vitest';
import { hashVertices } from '../src/polygon';
import { Vertex } from '../../shared/heapTypes';

// A simple 10×10 square with corners at (0,0), (10,0), (10,10), (0,10)
const SQUARE: Vertex[] = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 10 },
  { x: 0, y: 10 },
];

describe('hashVertices', () => {
  it('returns a 64-char hex string', () => {
    expect(hashVertices(SQUARE)).toMatch(/^[0-9a-f]{64}$/);
  });

  it('returns the same hash for identical vertex arrays', () => {
    expect(hashVertices(SQUARE)).toBe(hashVertices([...SQUARE]));
  });

  it('returns different hashes for different vertex arrays', () => {
    const other: Vertex[] = [{ x: 1, y: 1 }];
    expect(hashVertices(SQUARE)).not.toBe(hashVertices(other));
  });
});
