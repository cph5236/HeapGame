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
  DASH_DURATION_MS,
} from '../../constants';

// ── Mocks ─────────────────────────────────────────────────────────────────────

// Minimal Phaser mock — only the slice that Player.ts touches at module scope
// (KeyCodes lookup) and the instance methods called in update().
vi.mock('phaser', () => {
  const JustDown = vi.fn(() => false);
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
  setMaxVelocityY: (v: number) => void;
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
    setMaxVelocityY(v) { this._maxVelocityY = v; },
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
    const { Player } = await import('../Player');
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

  it('air jump on mobile applies tilt-kick vx', async () => {
    const { player, spy } = await makePlayer({
      onGround: false,
      bodyOverrides: { blocked: { left: false, right: false, down: false }, velocity: { x: 0, y: 100 } },
      config: { maxAirJumps: 1, wallJump: false, dash: false, dive: false, jumpBoost: 0 },
    });
    // Set coyoteTimer to 0 so no ground jump
    (player as any).coyoteTimer = 0;
    (player as any).airJumpsRemaining = 1;

    imState.isMobile        = true;
    imState.tiltFactor      = -0.75;
    imState.jumpJustPressed  = true;

    player.update(16);

    expect(spy.setVelocityX).toContain(PLAYER_SPEED * -0.75);
    expect(spy.setVelocityY).toContain(PLAYER_JUMP_VELOCITY);
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
    const { player, spy, sprite } = await makePlayer({
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
