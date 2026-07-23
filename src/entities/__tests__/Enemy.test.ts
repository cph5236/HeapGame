import { describe, it, expect } from 'vitest';
import { mirrorBodyBox } from '../Enemy';

describe('mirrorBodyBox', () => {
  it('mirrors offsetX within the frame, keeps other dims', () => {
    const m = mirrorBodyBox({ width: 210, height: 150, offsetX: 30, offsetY: 55 }, 256);
    expect(m).toEqual({ width: 210, height: 150, offsetX: 256 - 30 - 210, offsetY: 55 });
  });
});
