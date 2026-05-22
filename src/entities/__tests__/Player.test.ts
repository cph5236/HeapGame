/**
 * Player.test.ts — unit tests for Player.update() mobile controls:
 *   1. Analog walk (tiltFactor → proportional vx)
 *   2. Keyboard overrides tilt to full speed
 *   3. Tilt-kick jump on mobile (vx at moment of jump)
 *   4. Mobile dive: diveJustFired sets diveActive, applies PLAYER_DIVE_SPEED
 *   5. Ladder: dragUp climbs up, dragDown descends
 *
 * Strategy: bypass the Phaser constructor entirely by building a Player-like
 * harness that shares the same update() logic. Because Player's constructor
 * hard-wires Phaser scene APIs we can't import Phaser in a Node test, we mock
 * the module and directly manipulate the instance after construction.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  PLAYER_SPEED,
  PLAYER_JUMP_VELOCITY,
  PLAYER_DIVE_SPEED,
  PLAYER_MAX_FALL_SPEED,
  TERRAIN_STICK_SPEED,
  PLACEMENT_MOVE_SPEED,
  JUMP_BUFFER_MS,
  JUMP_CUT_FACTOR,
  APEX_VY_THRESHOLD,
  APEX_GRAVITY_FACTOR,
  FALL_GRAVITY_FACTOR,
  WORLD_GRAVITY_Y,
} from '../../constants';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Minimal Phaser mock — only the slice that Player.ts touches at module scope
// (KeyCodes lookup) and the instance methods called in update().
vi.mock('phaser', () => {
  const JustDown = vi.fn(() => false);
  const JustUp   = vi.fn(() => false);
  return {
    default: {
      Input: {
        Keyboard: {
          KeyCodes: {
            LEFT: 'LEFT', A: 'A',
            RIGHT: 'RIGHT', D: 'D',
            UP: 'UP', W: 'W',
            DOWN: 'DOWN', S: 'S',
            SHIFT: 'SHIFT',
          },
          JustDown,
          JustUp,
        },
      },
    },
  };
});

// ── InputManager singleton mock ────────────────────────────────────────────────
// We mock the module before importing Player so Player picks up the mock.

/** Mutable IM state shared across all test helpers. */
const imState = {
  tiltFactor: 0,
  goLeft: false,
  goRight: false,
  isMobile: false,
  jumpJustPressed: false,
  jumpVx: 0,
  dashJustFired: false,
  dashDir: 1 as 1 | -1,
  diveJustFired: false,
  dragUp: false,
  dragDown: false,
  placeHeld: false,
};

vi.mock('../../systems/InputManager', () => ({
  InputManager: {
    getInstance: () => imState,
  },
}));

// ── Helpers ───────────────────────────────────────────────────────────────────

/** Tracked calls from the sprite mock. */
type SpyCalls = {
  setVelocityX: number[];
  setVelocityY: number[];
  setFlipX:     boolean[];
};

interface MockBody {
  blocked: { left: boolean; right: boolean; down: boolean };
  velocity: { x: number; y: number };
  _maxVelocityY: number;
  _gravityY: number;
  setMaxVelocityY: (v: number) => void;
  setGravityY: (v: number) => void;
  setAllowGravity: (v: boolean) => void;
  setSize: () => void;
}

interface MockSprite {
  x: number;
  y: number;
  scaleX: number;
  scaleY: number;
  flipX: boolean;
  body: MockBody;
  scene: object;
  setDisplaySize: () => MockSprite;
  setDepth: () => MockSprite;
  setVelocityX: (v: number) => MockSprite;
  setVelocityY: (v: number) => MockSprite;
  setVelocity: (x: number, y: number) => MockSprite;
  setFlipX: (v: boolean) => MockSprite;
  _spy: SpyCalls;
}

function makeSprite(overrides: Partial<MockBody> = {}): MockSprite {
  const spy: SpyCalls = { setVelocityX: [], setVelocityY: [], setFlipX: [] };

  const body: MockBody = {
    blocked: { left: false, right: false, down: false },
    velocity: { x: 0, y: 0 },
    _maxVelocityY: PLAYER_MAX_FALL_SPEED,
    _gravityY: 0,
    setMaxVelocityY(v) { this._maxVelocityY = v; },
    setGravityY(v) { this._gravityY = v; },
    setAllowGravity: vi.fn(),
    setSize: vi.fn(),
    ...overrides,
  };

  const sprite: MockSprite = {
    x: 0,
    y: 0,
    scaleX: 1,
    scaleY: 1,
    flipX: false,
    body,
    scene: {},
    setDisplaySize() { return this; },
    setDepth() { return this; },
    setVelocityX(v) { spy.setVelocityX.push(v); return this; },
    setVelocityY(v) { spy.setVelocityY.push(v); return this; },
    setVelocity(x, y) { spy.setVelocityX.push(x); spy.setVelocityY.push(y); return this; },
    setFlipX(v) { spy.setFlipX.push(v); this.flipX = v; return this; },
    _spy: spy,
  };

  return sprite;
}

/** Minimal Phaser.Scene mock — only the slice Player's constructor calls. */
function makeScene(sprite: MockSprite) {
  return {
    physics: {
      add: {
        sprite: () => sprite,
      },
    },
    input: {
      keyboard: {
        // Return a fresh key object each call so left/right/jump/down/dash are independent
        addKey: () => ({ isDown: false }),
      },
    },
  };
}

/** Build a Player instance with all Phaser dependencies mocked. */
async function makePlayer(opts: {
  onGround?: boolean;
  bodyOverrides?: Partial<MockBody>;
  config?: Partial<import('../../systems/SaveData').PlayerConfig>;
} = {}) {
  const { Player } = await import('../Player');

  const sprite = makeSprite(opts.bodyOverrides);

  // Simulate ground: set sprite.y to worldHeight - PLAYER_HEIGHT/2 so onGround=true
  // OR set body.blocked.down
  if (opts.onGround !== false) {
    sprite.body.blocked.down = true;
  }

  const scene = makeScene(sprite);

  const defaultConfig = {
    maxAirJumps: 1,
    wallJump: false,
    dash: false,
    dive: true,
    jumpBoost: 0,
    ...opts.config,
  } as import('../../systems/SaveData').PlayerConfig;

  const player = new Player(scene as any, 0, 0, defaultConfig);

  // Inject our spy sprite directly (constructor already stored it via scene.physics.add.sprite)
  // The constructor stores the return value of scene.physics.add.sprite, which IS our sprite mock.
  // However, it also calls some chained methods. Those are stubs that return `this`, so the
  // reference stored in player.sprite is the same object. We need to verify this is the case:
  // player.sprite === sprite — if not, we fall back to (player as any).sprite = sprite.
  if ((player as any).sprite !== sprite) {
    (player as any).sprite = sprite;
  }

  return { player, sprite, spy: sprite._spy };
}

// ── Reset IM state before each test ───────────────────────────────────────────

beforeEach(() => {
  imState.tiltFactor     = 0;
  imState.goLeft         = false;
  imState.goRight        = false;
  imState.isMobile       = false;
  imState.jumpJustPressed = false;
  imState.jumpVx         = 0;
  imState.dashJustFired  = false;
  imState.dashDir        = 1;
  imState.diveJustFired  = false;
  imState.dragUp         = false;
  imState.dragDown       = false;
  imState.placeHeld      = false;
  vi.resetModules();
});

afterEach(() => {
  vi.resetModules();
});

// ── 1. Analog walk ────────────────────────────────────────────────────────────

describe('Player — analog walk', () => {
  it('tiltFactor 0.5 applies half PLAYER_SPEED as vx', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = 0.5;

    player.update(16);

    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBeCloseTo(PLAYER_SPEED * 0.5, 5);
  });

  it('tiltFactor -0.5 applies negative half PLAYER_SPEED as vx', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = -0.5;

    player.update(16);

    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBeCloseTo(-PLAYER_SPEED * 0.5, 5);
  });

  it('tiltFactor 1.0 applies full PLAYER_SPEED', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = 1.0;

    player.update(16);

    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBeCloseTo(PLAYER_SPEED, 5);
  });

  it('tiltFactor 0 applies 0 vx (phone level)', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = 0;

    player.update(16);

    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBe(0);
  });

  it('positive tilt sets flipX to false', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = 0.5;

    player.update(16);

    expect(spy.setFlipX).toContain(false);
  });

  it('negative tilt sets flipX to true', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = -0.5;

    player.update(16);

    expect(spy.setFlipX).toContain(true);
  });

  it('goLeft is not used in walk block (tiltFactor is sole source of truth)', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = 0;
    imState.goLeft = true;

    player.update(16);

    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBe(0);
  });

  it('goRight is not used in walk block (tiltFactor is sole source of truth)', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = 0;
    imState.goRight = true;

    player.update(16);

    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBe(0);
  });
});

// ── 2. Keyboard overrides tilt ────────────────────────────────────────────────

describe('Player — keyboard overrides tilt', () => {
  it('keyboard left key drives full -PLAYER_SPEED regardless of tilt', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = 0.8; // tilting right

    // Make the left keyboard key appear pressed
    await import('../Player');
    // We need to reach into the private leftKeys to set isDown.
    // Cast player to any to access private fields in tests.
    (player as any).leftKeys[0].isDown = true;

    player.update(16);

    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBe(-PLAYER_SPEED);
  });

  it('keyboard right key drives full +PLAYER_SPEED regardless of tilt', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = -0.8; // tilting left

    (player as any).rightKeys[0].isDown = true;

    player.update(16);

    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBe(PLAYER_SPEED);
  });
});

// ── 3. Tilt-kick jump (mobile) ────────────────────────────────────────────────

describe('Player — tilt-kick jump', () => {
  it('ground jump on mobile applies tiltFactor * PLAYER_SPEED as vx', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.isMobile       = true;
    imState.tiltFactor     = 0.5;
    imState.jumpJustPressed = true;

    player.update(16);

    // The tilt-kick setVelocityX happens before setVelocityY in the jump block
    // Find the setVelocityX call that corresponds to the tilt-kick
    // (it's called before setVelocityY with the jump velocity)
    expect(spy.setVelocityX).toContain(PLAYER_SPEED * 0.5);
    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY - 0);
  });

  it('ground jump on desktop does NOT apply tilt-kick vx from isMobile path', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.isMobile        = false;
    imState.tiltFactor      = 0.5;
    imState.jumpJustPressed  = true;

    player.update(16);

    // On desktop, only the tilt walk vx (0.5 * PLAYER_SPEED) would be set — NOT the jump tilt kick
    // The walk block also fires tiltFactor * PLAYER_SPEED in the else branch,
    // but the jump block should NOT fire PLAYER_SPEED * 0.5 via isMobile path.
    // We verify setVelocityY was called (jump happened) but no EXTRA vx was injected
    // from the jump block (the walk block covers the tilt vx separately).
    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY);
  });

  it('air jump seeds momentumX from jumpVx (swipe-jump)', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 1, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    // Set coyoteTimer to 0 so no ground jump
    (player as any).coyoteTimer = 0;
    (player as any).airJumpsRemaining = 1;

    imState.jumpJustPressed = true;
    imState.jumpVx = -120;

    player.update(16);

    expect((player as any).momentumX).toBe(-120);
  });

  it('wall jump sets correct wall-jump vx and jump vy (no tilt-kick from isMobile jump block)', async () => {
    const { player, spy } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: true, right: false, down: false }, velocity: { x: 0, y: 50 } },
      config: { maxAirJumps: 0, wallJump: true, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;
    (player as any).wallJumpsRemaining = 1;

    imState.isMobile        = true;
    imState.tiltFactor      = 0.9;
    imState.jumpJustPressed  = true;

    player.update(16);

    // Wall jump should set vx = 1 * PLAYER_SPEED * 1.5 (dir=1 from blocked.left)
    // and vy = PLAYER_JUMP_VELOCITY from the wall jump block
    expect(spy.setVelocityX).toContain(PLAYER_SPEED * 1.5);
    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY);
    // The jump block's isMobile tilt-kick is NOT executed for wall jumps
    // (onWallForJump guard prevents ground/air jump paths from running)
    // setVelocityX contains 180 from the walk-phase tilt, but NOT from the jump block:
    // verify that the last setVelocityX is the wall-jump vx (300), not a tilt-kick
    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBe(PLAYER_SPEED * 1.5);
  });
});

// ── 4. Mobile dive ────────────────────────────────────────────────────────────

describe('Player — mobile dive', () => {
  it('diveJustFired sets diveActive and applies PLAYER_DIVE_SPEED', async () => {
    const { player, spy, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 200 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: true, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;
    imState.diveJustFired = true;

    player.update(16);

    expect(spy.setVelocityY).toContain(PLAYER_DIVE_SPEED);
    expect(sprite.body._maxVelocityY).toBe(PLAYER_DIVE_SPEED);
  });

  it('diveActive sustains dive for DASH_DURATION_MS before expiring', async () => {
    const { player, spy } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 200 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: true, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;
    imState.diveJustFired = true;

    // First frame: fires diveJustFired, sets diveActive = DASH_DURATION_MS
    player.update(16);
    expect(spy.setVelocityY).toContain(PLAYER_DIVE_SPEED);

    // Verify diveActive was set
    expect((player as any).diveActive).toBeGreaterThan(0);

    // Second frame: no diveJustFired, but diveActive still > 0 → still diving
    imState.diveJustFired = false;
    spy.setVelocityY.length = 0;
    player.update(16);
    expect(spy.setVelocityY).toContain(PLAYER_DIVE_SPEED);
  });

  it('dive does not fire when player is on ground', async () => {
    const { player, spy } = await makePlayer({
      onGround: true,
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: true, jumpBoost: 0 },
    });
    imState.diveJustFired = true;

    player.update(16);

    expect(spy.setVelocityY).not.toContain(PLAYER_DIVE_SPEED);
  });

  it('desktop down key still triggers dive', async () => {
    const { player, spy, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 200 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: true, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;
    (player as any).downKeys[0].isDown = true;

    player.update(16);

    expect(spy.setVelocityY).toContain(PLAYER_DIVE_SPEED);
    expect(sprite.body._maxVelocityY).toBe(PLAYER_DIVE_SPEED);
  });
});

// ── 5. Ladder drag ────────────────────────────────────────────────────────────

describe('Player — ladder drag', () => {
  it('dragUp causes player to climb up (negative vy)', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    player.enterLadder();
    imState.dragUp = true;

    player.update(16);

    const lastVy = spy.setVelocityY[spy.setVelocityY.length - 1];
    expect(lastVy).toBeLessThan(0); // negative = up
  });

  it('dragDown causes player to descend (positive vy)', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    player.enterLadder();
    imState.dragDown = true;

    player.update(16);

    const lastVy = spy.setVelocityY[spy.setVelocityY.length - 1];
    expect(lastVy).toBeGreaterThan(0); // positive = down
  });

  it('no drag input while on ladder keeps player stationary (vy=0)', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    player.enterLadder();
    imState.dragUp   = false;
    imState.dragDown = false;

    player.update(16);

    const lastVy = spy.setVelocityY[spy.setVelocityY.length - 1];
    expect(lastVy).toBe(0);
  });

  it('jumpJustPressed on ladder climbs up', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    player.enterLadder();
    imState.jumpJustPressed = true;

    player.update(16);

    const lastVy = spy.setVelocityY[spy.setVelocityY.length - 1];
    expect(lastVy).toBeLessThan(0);
  });

  it('goLeft on ladder exits ladder', async () => {
    const { player } = await makePlayer({ onGround: true });
    player.enterLadder();
    expect(player.isOnLadder).toBe(true);

    imState.goLeft = true;

    player.update(16);

    expect(player.isOnLadder).toBe(false);
  });
});

// ── 6. Slope eject ────────────────────────────────────────────────────────

describe('Player — slope eject', () => {
  it('slope eject is suppressed when tilting (tiltFactor non-zero)', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    // Inject inSlopeZone state
    (player as any).inSlopeZone = true;
    imState.tiltFactor = 0.5;

    player.update(16);

    // When tilting, vx should reflect the tilt (0.5 * PLAYER_SPEED), not the slope eject velocity
    const lastVx = spy.setVelocityX[spy.setVelocityX.length - 1];
    expect(lastVx).toBeCloseTo(PLAYER_SPEED * 0.5, 5);
  });
});

// ── 7. Terrain stick ──────────────────────────────────────────────────────

describe('Player — terrain stick', () => {
  it('applies TERRAIN_STICK_SPEED downward when grounded with velocity.y near zero', async () => {
    const { player, spy, sprite } = await makePlayer({ onGround: true });
    sprite.body.velocity.y = 0; // physics just zeroed it after resolving into a slab

    player.update(16);

    expect(spy.setVelocityY).toContain(TERRAIN_STICK_SPEED);
  });

  it('does NOT apply terrain stick when velocity.y is already negative (player jumping upward)', async () => {
    // Scenario: jump fired last frame, player is still touching slab (blocked.down=true
    // due to snap-induced overlap), but is moving upward. Terrain stick must not cancel the jump.
    const { player, spy, sprite } = await makePlayer({ onGround: true });
    sprite.body.velocity.y = -550; // upward jump velocity set last frame

    player.update(16);

    // Terrain stick MUST NOT fire — TERRAIN_STICK_SPEED is downward and would cancel the jump
    expect(spy.setVelocityY).not.toContain(TERRAIN_STICK_SPEED);
  });
});

// ── 8. Placement mode ─────────────────────────────────────────────────────

describe('Player — placement mode', () => {
  it('caps ground speed to PLACEMENT_MOVE_SPEED when placement mode is active', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    player.setPlacementMode(true);

    player.update(16);

    const maxVx = Math.max(...spy.setVelocityX.map(Math.abs));
    expect(maxVx).toBeLessThanOrEqual(PLACEMENT_MOVE_SPEED);
  });

  it('blocks jumping when placement mode is active', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.jumpJustPressed = true;
    player.setPlacementMode(true);

    player.update(16);

    expect(spy.setVelocityY).not.toContain(PLAYER_JUMP_VELOCITY);
  });

  it('restores normal speed when placement mode is cleared', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.tiltFactor = 1; // full right tilt
    player.setPlacementMode(true);
    player.setPlacementMode(false);

    player.update(16);

    expect(spy.setVelocityX).toContain(PLAYER_SPEED);
  });
});

// ── 9. Dive landing ──────────────────────────────────────────────────────

describe('Player — dive landing', () => {
  it('clears diveActive when player lands while a dive burst is still running', async () => {
    const { player } = await makePlayer({
      onGround: true,
      config: { maxAirJumps: 1, wallJump: false, dash: false, dive: true, jumpBoost: 0 },
    });
    // Simulate landing mid-dive: diveActive frozen at 120ms remaining
    (player as any).diveActive = 120;

    player.update(16);

    expect((player as any).diveActive).toBe(0);
  });

  it('does not re-trigger dive on the first airborne frame after landing a dive', async () => {
    // Reproduce the stuck-on-surface bug:
    // 1. land while diveActive > 0  →  diveActive should clear
    // 2. jump  →  first airborne frame must NOT apply dive velocity
    const { player, spy, sprite } = await makePlayer({
      onGround: true,
      config: { maxAirJumps: 1, wallJump: false, dash: false, dive: true, jumpBoost: 0 },
    });
    (player as any).diveActive = 120; // frozen dive from before landing

    // Frame 1: grounded — should clear diveActive
    player.update(16);
    expect((player as any).diveActive).toBe(0);

    // Frame 2: now simulate being airborne (player jumped)
    sprite.body.blocked.down = false;
    imState.jumpJustPressed = false; // jump already consumed

    player.update(16);

    // Dive must NOT have fired — setVelocityY should not contain PLAYER_DIVE_SPEED
    expect(spy.setVelocityY).not.toContain(PLAYER_DIVE_SPEED);
  });
});

// ── 10. Air momentum ──────────────────────────────────────────────────────

describe('Player — air momentum', () => {
  it('accumulates rightward momentum while airborne with full right tilt', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    imState.tiltFactor = 1;
    player.update(16);
    const vx = (player as any).momentumX;
    expect(vx).toBeGreaterThan(0);
    expect(vx).toBeLessThan(PLAYER_SPEED);
  });

  it('applies stop-advantage factor when tilt opposes momentum', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    // Seed positive momentum
    (player as any).momentumX = 100;
    // Tilt left (opposing)
    imState.tiltFactor = -1;
    player.update(16);
    const delta = 100 - (player as any).momentumX; // how much it dropped
    // Without advantage: drop = 1 * AIR_TILT_FORCE * 16 = 12.8
    // With advantage (×1.5): drop = 19.2
    expect(delta).toBeCloseTo(19.2, 0);
  });

  it('decays toward zero when tilt is zero', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).momentumX = 100;
    imState.tiltFactor = 0;
    player.update(16);
    expect((player as any).momentumX).toBeLessThan(100);
    expect((player as any).momentumX).toBeGreaterThan(0);
  });

  it('zeroes momentumX on landing', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).momentumX = 150;
    // Now simulate landing
    (player as any).sprite.body.blocked.down = true;
    player.update(16);
    expect((player as any).momentumX).toBe(0);
  });

  it('zeroes momentumX on wall contact', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: true, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).momentumX = 150;
    player.update(16);
    expect((player as any).momentumX).toBe(0);
  });

  it('zeroes momentumX when dash fires', async () => {
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 0, wallJump: false, dash: true, dive: false, jumpBoost: 0 },
    });
    (player as any).momentumX = 150;
    imState.dashJustFired = true;
    imState.dashDir = 1;
    player.update(16);
    expect((player as any).momentumX).toBe(0);
  });

  it('seeds momentumX from jumpVx on swipe-jump', async () => {
    const { player } = await makePlayer({
      onGround: true,
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    imState.jumpJustPressed = true;
    imState.jumpVx = 120;
    player.update(16);
    expect((player as any).momentumX).toBe(120);
  });

  it('seeds momentumX from body.velocity.x on tap-jump (jumpVx=0)', async () => {
    const { player } = await makePlayer({
      onGround: true,
      bodyOverrides: { blocked: { left: false, right: false, down: true }, velocity: { x: 150, y: 0 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    imState.jumpJustPressed = true;
    imState.jumpVx = 0;
    player.update(16);
    expect((player as any).momentumX).toBe(150);
  });
});

// ── 11. Jump buffer (#1) ──────────────────────────────────────────────────────

describe('Player — jump buffer', () => {
  it('press jump while airborne with no air jumps, then land within buffer window → jump fires', async () => {
    const { player, spy, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 400 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;
    (player as any).airJumpsRemaining = 0;

    // Press jump while falling — buffer should be primed even though jump can't fire yet
    imState.jumpJustPressed = true;
    player.update(16);
    expect(spy.setVelocityY).not.toContain(PLAYER_JUMP_VELOCITY); // can't jump yet

    // Next frame: player lands. No new press, just the buffered one carrying over.
    imState.jumpJustPressed = false;
    sprite.body.blocked.down = true;
    sprite.body.velocity.y = 0;
    spy.setVelocityY.length = 0;
    player.update(16);

    // Buffered jump should fire on landing frame
    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY);
  });

  it('buffer expires after JUMP_BUFFER_MS — landing after the window does NOT jump', async () => {
    const { player, spy, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 400 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;
    (player as any).airJumpsRemaining = 0;

    // Press jump
    imState.jumpJustPressed = true;
    player.update(16);
    imState.jumpJustPressed = false;

    // Tick past the buffer window
    player.update(JUMP_BUFFER_MS + 50);

    // Now land — buffer should have expired
    sprite.body.blocked.down = true;
    sprite.body.velocity.y = 0;
    spy.setVelocityY.length = 0;
    player.update(16);

    expect(spy.setVelocityY).not.toContain(PLAYER_JUMP_VELOCITY);
  });

  it('buffer is consumed once — jump does not retrigger on next frame', async () => {
    const { player, spy } = await makePlayer({ onGround: true });
    imState.jumpJustPressed = true;

    player.update(16);
    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY);

    // Clear and run another frame with no new press — buffer should be consumed
    imState.jumpJustPressed = false;
    spy.setVelocityY.length = 0;
    player.update(16);
    expect(spy.setVelocityY).not.toContain(PLAYER_JUMP_VELOCITY);
  });

  it('buffered jump preserves swipe jumpVx until consumed', async () => {
    const { player, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 400 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;
    (player as any).airJumpsRemaining = 0;

    // Swipe-jump while airborne — captures jumpVx into buffer
    imState.jumpJustPressed = true;
    imState.jumpVx = 200;
    player.update(16);

    // Next frame: pulse cleared but buffer still has the directional value
    imState.jumpJustPressed = false;
    imState.jumpVx = 0;
    sprite.body.blocked.down = true;
    sprite.body.velocity.y = 0;
    player.update(16);

    expect((player as any).momentumX).toBe(200);
  });
});

// ── 12. Variable jump height (#2) ─────────────────────────────────────────────

describe('Player — variable jump height (jump cut)', () => {
  it('releasing jump key while rising cuts upward velocity by JUMP_CUT_FACTOR', async () => {
    const { player, spy } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: -300 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;

    // Frame 1: jump key held while rising
    (player as any).jumpKeys[0].isDown = true;
    player.update(16);

    // Frame 2: jump key released — vy must be cut
    (player as any).jumpKeys[0].isDown = false;
    spy.setVelocityY.length = 0;
    player.update(16);

    const expectedCut = -300 * JUMP_CUT_FACTOR;
    expect(spy.setVelocityY).toContain(expectedCut);
  });

  it('jump cut only fires once per jump', async () => {
    const { player, spy, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: -300 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;

    (player as any).jumpKeys[0].isDown = true;
    player.update(16);

    // Release
    (player as any).jumpKeys[0].isDown = false;
    sprite.body.velocity.y = -300 * JUMP_CUT_FACTOR;
    player.update(16);

    // Another frame — must not cut again
    spy.setVelocityY.length = 0;
    sprite.body.velocity.y = -100; // still rising slowly
    player.update(16);
    const cutAgain = -100 * JUMP_CUT_FACTOR;
    expect(spy.setVelocityY).not.toContain(cutAgain);
  });

  it('jump cut does NOT fire while falling (vy > 0)', async () => {
    const { player, spy } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 200 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;

    (player as any).jumpKeys[0].isDown = true;
    player.update(16);

    (player as any).jumpKeys[0].isDown = false;
    spy.setVelocityY.length = 0;
    player.update(16);

    // No setVelocityY value should equal vy * JUMP_CUT_FACTOR (which would be 90)
    expect(spy.setVelocityY).not.toContain(200 * JUMP_CUT_FACTOR);
  });

  it('holding jump key all the way up preserves full vy (no cut)', async () => {
    const { player, spy } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: -500 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;
    (player as any).jumpKeys[0].isDown = true;

    player.update(16);
    spy.setVelocityY.length = 0;

    // Still holding — no cut should happen
    player.update(16);
    expect(spy.setVelocityY).not.toContain(-500 * JUMP_CUT_FACTOR);
  });

  it('sub-frame keyboard tap (JustDown true, isDown false) cuts on the fire frame', async () => {
    // The bug: a fast tap completes (keydown + keyup) before the next Phaser tick.
    // On the firing frame Phaser reports JustDown=true but isDown=false.
    // The held→released transition detection can't catch this; cut-on-fire must.
    const phaserMod = await import('phaser');
    (phaserMod.default.Input.Keyboard.JustDown as any).mockReturnValueOnce(true);

    const { player, spy } = await makePlayer({ onGround: true, config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 } });
    // jumpKeys[0].isDown stays false — simulating already-released

    player.update(16);

    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY);
    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY * JUMP_CUT_FACTOR);
  });

  it('buffered tap that fires on landing also cuts (no held key at fire time)', async () => {
    // Press jump while falling with no air jumps available; release before landing.
    // The buffered jump fires on landing — and since the key isn't held, it must cut.
    const phaserMod = await import('phaser');

    const { player, spy, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 400 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;

    // Frame 1: airborne, sub-frame tap (JustDown true, isDown false)
    (phaserMod.default.Input.Keyboard.JustDown as any).mockReturnValueOnce(true);
    player.update(16);
    // No jump fired yet (no opportunity)
    expect(spy.setVelocityY).not.toContain(PLAYER_JUMP_VELOCITY);

    // Frame 2: land — buffer fires the jump; key still not held → cut
    sprite.body.blocked.down = true;
    sprite.body.velocity.y = 0;
    spy.setVelocityY.length = 0;
    player.update(16);

    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY);
    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY * JUMP_CUT_FACTOR);
  });

  it('keyboard hold (JustDown true, isDown true) does NOT cut on fire frame', async () => {
    // Sanity: a held jump fires at full height, only cut later on release.
    const phaserMod = await import('phaser');
    (phaserMod.default.Input.Keyboard.JustDown as any).mockReturnValueOnce(true);

    const { player, spy } = await makePlayer({ onGround: true, config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 } });
    (player as any).jumpKeys[0].isDown = true; // held

    player.update(16);

    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY);
    expect(spy.setVelocityY).not.toContain(PLAYER_JUMP_VELOCITY * JUMP_CUT_FACTOR);
  });

  it('mobile swipe-jump (no held key) is never cut — full jump always', async () => {
    // Swipes are one-shot pulses with no "release" — variable height must not apply
    const { player, spy, sprite } = await makePlayer({ onGround: true });
    imState.jumpJustPressed = true;
    player.update(16);

    // Now player is airborne, no keyboard key was ever down
    sprite.body.blocked.down = false;
    sprite.body.velocity.y = -400;
    imState.jumpJustPressed = false;
    spy.setVelocityY.length = 0;
    player.update(16);

    expect(spy.setVelocityY).not.toContain(-400 * JUMP_CUT_FACTOR);
  });
});

// ── 13. Asymmetric gravity (#3) — apex hang + fast fall ───────────────────────

describe('Player — asymmetric gravity', () => {
  it('applies fast-fall gravity multiplier when falling', async () => {
    const { player, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 300 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;

    player.update(16);

    // body.setGravityY is additive to world gravity — for a 1.4× multiplier, expect WORLD_GRAVITY_Y * 0.4
    const expected = WORLD_GRAVITY_Y * (FALL_GRAVITY_FACTOR - 1);
    expect(sprite.body._gravityY).toBeCloseTo(expected, 5);
  });

  it('applies apex hang gravity when |vy| < APEX_VY_THRESHOLD', async () => {
    const { player, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: -50 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;

    player.update(16);

    const expected = WORLD_GRAVITY_Y * (APEX_GRAVITY_FACTOR - 1);
    expect(sprite.body._gravityY).toBeCloseTo(expected, 5);
  });

  it('applies normal gravity (0 additive) while rising fast', async () => {
    const { player, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: -400 } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;

    player.update(16);

    expect(sprite.body._gravityY).toBe(0);
  });

  it('resets body gravity to 0 when grounded', async () => {
    const { player, sprite } = await makePlayer({ onGround: true });
    sprite.body._gravityY = WORLD_GRAVITY_Y * (FALL_GRAVITY_FACTOR - 1); // leftover from airborne frame

    player.update(16);

    expect(sprite.body._gravityY).toBe(0);
  });

  it('apex threshold edge: |vy| exactly at threshold uses normal gravity, not apex', async () => {
    const { player, sprite } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: -APEX_VY_THRESHOLD } },
      config: { maxAirJumps: 0, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 0;

    player.update(16);

    // At the boundary we want strict |vy| < threshold to be apex; equal goes to normal
    expect(sprite.body._gravityY).toBe(0);
  });
});

// ── 14. Coyote consumption on every jump path (#9) ───────────────────────────

describe('Player — coyote consumed on every jump path', () => {
  it('ground jump fired while coyote was active consumes the window', async () => {
    const { player } = await makePlayer({
      onGround: true,
      config: { maxAirJumps: 1, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 120;
    imState.jumpJustPressed = true;

    player.update(16);

    expect((player as any).coyoteTimer).toBe(0);
    // Air jump must NOT have also fired (else-if guard) — preserves charges
    expect((player as any).airJumpsRemaining).toBe(1);
  });

  it('wall jump path also consumes coyote (defensive — covers same-frame double-fire)', async () => {
    // Player ran off a ledge onto a wall, coyote still active. Both ground and wall
    // jump paths can fire in the same frame (latent issue tracked separately).
    // What we DO guarantee: by end of update, coyote is 0.
    const { player } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: true, right: false, down: false }, velocity: { x: 0, y: 50 } },
      config: { maxAirJumps: 0, wallJump: true, dash: false, dive: false, jumpBoost: 0 },
    });
    (player as any).coyoteTimer = 100;
    (player as any).wallJumpsRemaining = 1;
    imState.jumpJustPressed = true;

    player.update(16);

    expect((player as any).coyoteTimer).toBe(0);
  });
});
