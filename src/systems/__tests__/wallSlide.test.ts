import { describe, it, expect } from 'vitest';
import {
  bankWallSlideMomentum,
  wallSlidePressVelocity,
  applyWallLeaveNudge,
} from '../wallSlide';
import {
  PLAYER_SPEED,
  WALL_JUMP_PUSH,
  WALL_LEAVE_NUDGE,
  WALL_SLIDE_PRESS_SPEED,
} from '../../constants';

// inwardDir points from the player toward the wall face they are gripping:
// -1 when the wall is on their left (blocked.left), +1 when it is on their right.

describe('bankWallSlideMomentum', () => {
  it('keeps momentum built by air control below the walk-speed cap', () => {
    expect(bankWallSlideMomentum(100, 1, PLAYER_SPEED)).toBe(100);
  });

  it('caps into-wall momentum at walk speed so a fast arrival cannot be banked', () => {
    expect(bankWallSlideMomentum(WALL_JUMP_PUSH, 1, PLAYER_SPEED)).toBe(PLAYER_SPEED);
  });

  it('caps into-wall momentum on the left wall too', () => {
    expect(bankWallSlideMomentum(-WALL_JUMP_PUSH, -1, PLAYER_SPEED)).toBe(-PLAYER_SPEED);
  });

  it('caps at the boosted walk speed when the player carries a speed item', () => {
    // The cap tracks whatever air control may accelerate to this frame, so a speed
    // item raises it too — the wall is not the one place the item stops applying.
    const boosted = PLAYER_SPEED * 1.3;
    expect(bankWallSlideMomentum(WALL_JUMP_PUSH, 1, boosted)).toBe(boosted);
  });

  it('caps at the reduced walk speed when the player carries a heavy item', () => {
    const slowed = PLAYER_SPEED * 0.75;
    expect(bankWallSlideMomentum(WALL_JUMP_PUSH, 1, slowed)).toBe(slowed);
  });

  it('leaves outward momentum untouched even above the cap', () => {
    // Wall-jumping away from this face: the player is leaving, not banking.
    expect(bankWallSlideMomentum(-WALL_JUMP_PUSH, 1, PLAYER_SPEED)).toBe(-WALL_JUMP_PUSH);
  });

  it('leaves a still player at zero', () => {
    expect(bankWallSlideMomentum(0, 1, PLAYER_SPEED)).toBe(0);
  });
});

describe('wallSlidePressVelocity', () => {
  it('caps the press so banked momentum is not spent burying the body in the face', () => {
    expect(wallSlidePressVelocity(PLAYER_SPEED, 1)).toBe(WALL_SLIDE_PRESS_SPEED);
  });

  it('caps the press on the left wall too', () => {
    expect(wallSlidePressVelocity(-PLAYER_SPEED, -1)).toBe(-WALL_SLIDE_PRESS_SPEED);
  });

  it('passes a press weaker than the cap through unchanged', () => {
    // Never invents contact the player is not asking for: one frame of tilt is
    // ~13px/s, and that is what should reach the face.
    expect(wallSlidePressVelocity(13, 1)).toBe(13);
  });

  it('leaves outward velocity alone so leaving the wall is not throttled', () => {
    expect(wallSlidePressVelocity(-PLAYER_SPEED, 1)).toBe(-PLAYER_SPEED);
  });

  it('leaves a still player at zero', () => {
    expect(wallSlidePressVelocity(0, 1)).toBe(0);
  });
});

// outwardDir points away from the wall the player just left.
describe('applyWallLeaveNudge', () => {
  it('nudges a player who left the wall carrying nothing', () => {
    expect(applyWallLeaveNudge(0, 1)).toBe(WALL_LEAVE_NUDGE);
  });

  it('nudges away from a wall on the right', () => {
    expect(applyWallLeaveNudge(0, -1)).toBe(-WALL_LEAVE_NUDGE);
  });

  it('preserves an inward steer, so an alcove entry is not clobbered on exit', () => {
    expect(applyWallLeaveNudge(-200, 1)).toBe(-200);
  });

  it('preserves outward momentum faster than the nudge', () => {
    expect(applyWallLeaveNudge(300, 1)).toBe(300);
  });

  it('overrides a steer too weak to be deliberate', () => {
    expect(applyWallLeaveNudge(-40, 1)).toBe(WALL_LEAVE_NUDGE);
  });
});
