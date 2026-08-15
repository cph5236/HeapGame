/**
 * PlayerAnimator.test.ts — dash animation state.
 *
 * The bag is normally a single static texture pushed around by procedural
 * squash/stretch. The dash is the one action with drawn frames, so it gets its
 * own AnimState that suspends the procedural pose for the length of the
 * authored playback (3 frames × 100ms) and hands the sprite back afterwards.
 *
 * Strategy: mock `phaser` down to the event-name constants the class reads and
 * hand-roll sprite/scene stubs, matching PlayerCosmetics.test.ts.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('phaser', () => ({
  default: {
    Scenes: { Events: { POST_UPDATE: 'postupdate', SHUTDOWN: 'shutdown' } },
  },
}));

// Tie-band drawing is PlayerCosmetics-adjacent art, not dash state.
vi.mock('../../ui/tieBand', () => ({ drawTieBand: vi.fn() }));

import { PlayerAnimator, dashStringPoints, DASH_ANIM_DURATION } from '../PlayerAnimator';
import type { PlayerAnimState } from '../Player';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from '../../constants';

// ── Stubs ─────────────────────────────────────────────────────────────────────

const BASE_SCALE_X = PLAYER_WIDTH / 174;
const BASE_SCALE_Y = PLAYER_HEIGHT / 197;

function makeSprite() {
  return {
    x: 100, y: 200,
    scaleX: BASE_SCALE_X, scaleY: BASE_SCALE_Y,
    angle: 0, flipX: false,
    texture: { key: 'trashbag-nostrings' },
    body: { setSize: vi.fn() },
    setScale: vi.fn(function (this: any, sx: number, sy: number) {
      this.scaleX = sx; this.scaleY = sy ?? sx; return this;
    }),
    setAngle: vi.fn(function (this: any, a: number) { this.angle = a; return this; }),
    setFlipX: vi.fn(function (this: any, v: boolean) { this.flipX = v; return this; }),
    setTexture: vi.fn(function (this: any, key: string) { this.texture.key = key; return this; }),
    play: vi.fn().mockReturnThis(),
    stop: vi.fn().mockReturnThis(),
  };
}

function makeGraphics() {
  return {
    setDepth: vi.fn().mockReturnThis(),
    setPosition: vi.fn().mockReturnThis(),
    clear: vi.fn(), lineStyle: vi.fn(), beginPath: vi.fn(),
    moveTo: vi.fn(), lineTo: vi.fn(), strokePath: vi.fn(), destroy: vi.fn(),
  };
}

function makeScene(gfx: ReturnType<typeof makeGraphics>) {
  return {
    add:   { graphics: () => gfx },
    anims: { exists: vi.fn(() => true) },
    events: { on: vi.fn(), once: vi.fn(), off: vi.fn() },
  };
}

function baseState(over: Partial<PlayerAnimState> = {}): PlayerAnimState {
  return {
    vy: 0, onGround: true, onWall: false, frozen: false,
    justLanded: false, justJumped: false, justAirJumped: false,
    justWallJumped: false, justDied: false, justPlaced: false,
    justDashed: false, dashDir: 1,
    ...over,
  };
}

function makeAnimator() {
  const sprite = makeSprite();
  const gfx    = makeGraphics();
  const scene  = makeScene(gfx);
  const animator = new PlayerAnimator(sprite as any, scene as any);
  return { animator, sprite, gfx, scene };
}

let ctx: ReturnType<typeof makeAnimator>;
beforeEach(() => { ctx = makeAnimator(); });

// ── Entering the dash ─────────────────────────────────────────────────────────

describe('PlayerAnimator — dash entry', () => {
  it('plays the dash animation when the player dashes', () => {
    ctx.animator.update(16, baseState({ justDashed: true, dashDir: 1 }));

    expect(ctx.sprite.play).toHaveBeenCalledWith('player-dash');
  });

  it('faces the bag left when dashing left', () => {
    ctx.animator.update(16, baseState({ justDashed: true, dashDir: -1 }));

    expect(ctx.sprite.flipX).toBe(true);
  });

  it('faces the bag right when dashing right', () => {
    ctx.animator.update(16, baseState({ justDashed: true, dashDir: 1 }));

    expect(ctx.sprite.flipX).toBe(false);
  });

  it('skips the animation when it was never registered', () => {
    ctx.scene.anims.exists = vi.fn(() => false);

    ctx.animator.update(16, baseState({ justDashed: true }));

    expect(ctx.sprite.play).not.toHaveBeenCalled();
  });

  it('interrupts an in-progress launch curve', () => {
    ctx.animator.update(16, baseState({ justJumped: true }));
    expect(ctx.sprite.scaleY).toBeGreaterThan(BASE_SCALE_Y); // launch stretch

    ctx.animator.update(16, baseState({ justDashed: true }));

    expect(ctx.sprite.play).toHaveBeenCalledWith('player-dash');
    expect(ctx.sprite.scaleY).toBeCloseTo(BASE_SCALE_Y, 5);
  });
});

// ── During the dash ───────────────────────────────────────────────────────────

describe('PlayerAnimator — dash pose', () => {
  it('holds the base scale so the drawn frames carry the pose', () => {
    ctx.animator.update(16, baseState({ justDashed: true }));
    // Falling fast would normally stretch the bag vertically.
    ctx.animator.update(16, baseState({ onGround: false, vy: 600 }));

    expect(ctx.sprite.scaleX).toBeCloseTo(BASE_SCALE_X, 5);
    expect(ctx.sprite.scaleY).toBeCloseTo(BASE_SCALE_Y, 5);
    expect(ctx.sprite.angle).toBe(0);
  });

  it('keeps the hitbox at the un-squashed player size', () => {
    ctx.animator.update(16, baseState({ justDashed: true }));

    expect(ctx.sprite.body.setSize).toHaveBeenLastCalledWith(
      PLAYER_WIDTH / BASE_SCALE_X, PLAYER_HEIGHT / BASE_SCALE_Y,
    );
  });

  it('does not re-trigger the animation on later frames of the same dash', () => {
    ctx.animator.update(16, baseState({ justDashed: true }));
    ctx.animator.update(16, baseState());
    ctx.animator.update(16, baseState());

    expect(ctx.sprite.play).toHaveBeenCalledTimes(1);
  });
});

// ── Leaving the dash ──────────────────────────────────────────────────────────

describe('PlayerAnimator — dash exit', () => {
  it('holds the dash frames for the full authored playback', () => {
    ctx.animator.update(16, baseState({ justDashed: true }));
    ctx.animator.update(DASH_ANIM_DURATION - 16 - 1, baseState());

    expect(ctx.sprite.setTexture).not.toHaveBeenCalled();
  });

  it('restores the static bag once the playback ends', () => {
    ctx.animator.update(16, baseState({ justDashed: true }));
    ctx.animator.update(DASH_ANIM_DURATION, baseState());

    expect(ctx.sprite.setTexture).toHaveBeenCalledWith('trashbag-nostrings');
    expect(ctx.sprite.stop).toHaveBeenCalled();
    expect(ctx.sprite.flipX).toBe(false);
  });

  it('restores the static bag when the player dies mid-dash', () => {
    ctx.animator.update(16, baseState({ justDashed: true }));
    ctx.animator.update(16, baseState({ justDied: true }));

    expect(ctx.sprite.setTexture).toHaveBeenCalledWith('trashbag-nostrings');
    expect(ctx.sprite.flipX).toBe(false);
  });

  it('resumes procedural squash after the dash', () => {
    ctx.animator.update(16, baseState({ justDashed: true }));
    ctx.animator.update(DASH_ANIM_DURATION, baseState({ onGround: false, vy: 600 }));
    ctx.animator.update(16, baseState({ onGround: false, vy: 600 }));

    expect(ctx.sprite.scaleY).toBeGreaterThan(BASE_SCALE_Y); // falling stretch
  });
});

// ── Swept-back strings ────────────────────────────────────────────────────────

describe('dashStringPoints', () => {
  it('sweeps the strings behind a rightward dash', () => {
    const p = dashStringPoints(1);

    expect(p.endLx).toBeLessThan(0);
    expect(p.endRx).toBeLessThan(0);
    expect(p.cpLx).toBeLessThan(0);
    expect(p.cpRx).toBeLessThan(0);
  });

  it('mirrors horizontally for a leftward dash', () => {
    const right = dashStringPoints(1);
    const left  = dashStringPoints(-1);

    expect(left.cpLx).toBe(-right.cpLx);
    expect(left.endLx).toBe(-right.endLx);
    expect(left.cpRx).toBe(-right.cpRx);
    expect(left.endRx).toBe(-right.endRx);
  });

  it('keeps the vertical trail unchanged by direction', () => {
    expect(dashStringPoints(-1).endLy).toBe(dashStringPoints(1).endLy);
    expect(dashStringPoints(-1).endRy).toBe(dashStringPoints(1).endRy);
  });
});
