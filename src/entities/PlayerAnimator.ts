import Phaser from 'phaser';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from '../constants';
import type { PlayerAnimState } from './Player';

// ── Tuning constants ────────────────────────────────────────────────────────
const LERP_SPEED         = 12;    // lerp factor per second
const APEX_VY_THRESHOLD  = 80;    // px/s — |vy| below this → apex state
const LAUNCH_DURATION    = 600;   // ms
const AIR_JUMP_DURATION  = 500;   // ms
const LANDING_DURATION   = 400;   // ms
const IDLE_PERIOD        = 2200;  // ms — breathing sine period
const FALL_FLAP_PERIOD   = 550;   // ms — string flutter period
const APEX_WIGGLE_PERIOD = 450;   // ms — apex rotation sine period
const STRING_STROKE_W    = 2.5;   // px
const COLLAR_OFFSET_Y    = -0.44; // fraction of PLAYER_HEIGHT (red collar position)

// ── State enum ───────────────────────────────────────────────────────────────
enum AnimState {
  IDLE, LAUNCHING, AIR_JUMP, APEX, FALLING, LANDING, WALL_SLIDE,
}

// ── Keyframe type ────────────────────────────────────────────────────────────
interface Keyframe {
  t: number;
  scaleX: number; scaleY: number;
  cpLx: number; cpLy: number; endLx: number; endLy: number;
  cpRx: number; cpRy: number; endRx: number; endRy: number;
}

// ── Timed-state keyframe curves ──────────────────────────────────────────────
const LAUNCH_FRAMES: Keyframe[] = [
  { t: 0.00, scaleX: 0.72, scaleY: 1.38, cpLx: -3, cpLy: 20, endLx: -2, endLy: 40, cpRx:  3, cpRy: 20, endRx:  2, endRy: 40 },
  { t: 0.55, scaleX: 0.84, scaleY: 1.22, cpLx: -6, cpLy: 16, endLx: -8, endLy: 32, cpRx:  6, cpRy: 16, endRx:  8, endRy: 32 },
  { t: 1.00, scaleX: 1.00, scaleY: 1.00, cpLx: -9, cpLy: 16, endLx:-12, endLy: 30, cpRx:  9, cpRy: 16, endRx: 12, endRy: 30 },
];

const AIR_JUMP_FRAMES: Keyframe[] = [
  { t: 0.00, scaleX: 1.00, scaleY: 1.00, cpLx: -9, cpLy: 16, endLx:-12, endLy: 30, cpRx:  9, cpRy: 16, endRx: 12, endRy: 30 },
  { t: 0.15, scaleX: 0.80, scaleY: 1.30, cpLx: -3, cpLy: 20, endLx: -2, endLy: 40, cpRx:  3, cpRy: 20, endRx:  2, endRy: 40 },
  { t: 0.60, scaleX: 0.88, scaleY: 1.18, cpLx: -8, cpLy: 15, endLx:-10, endLy: 28, cpRx:  8, cpRy: 15, endRx: 10, endRy: 28 },
  { t: 1.00, scaleX: 1.00, scaleY: 1.00, cpLx: -9, cpLy: 16, endLx:-12, endLy: 30, cpRx:  9, cpRy: 16, endRx: 12, endRy: 30 },
];

const LANDING_FRAMES: Keyframe[] = [
  { t: 0.00, scaleX: 1.45, scaleY: 0.55, cpLx:  -5, cpLy: -10, endLx:  -6, endLy: -22, cpRx:   5, cpRy: -10, endRx:   6, endRy: -22 },
  { t: 0.28, scaleX: 0.88, scaleY: 1.15, cpLx: -24, cpLy:   8, endLx: -30, endLy:  14, cpRx:  24, cpRy:   8, endRx:  30, endRy:  14 },
  { t: 0.65, scaleX: 1.06, scaleY: 0.96, cpLx: -10, cpLy:  12, endLx: -11, endLy:  24, cpRx:  10, cpRy:  12, endRx:  11, endRy:  24 },
  { t: 1.00, scaleX: 1.00, scaleY: 1.00, cpLx:  -9, cpLy:  16, endLx: -12, endLy:  30, cpRx:   9, cpRy:  16, endRx:  12, endRy:  30 },
];

// ── PlayerAnimator ────────────────────────────────────────────────────────────
export class PlayerAnimator {
  private readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private readonly gfx:    Phaser.GameObjects.Graphics;

  private readonly baseScaleX: number;
  private readonly baseScaleY: number;

  private state:      AnimState = AnimState.IDLE;
  private stateTimer: number    = 0;  // ms remaining in current timed state
  private dormant:    boolean   = false;

  // Accumulators for continuous sine-driven states
  private idleTime:     number = 0;
  private fallFlapTime: number = 0;
  private apexTime:     number = 0;

  // Interpolated string control/end points (world-space offsets from attach point)
  private cpLx  = -9;  private cpLy  =  16;
  private endLx = -12; private endLy =  30;
  private cpRx  =  9;  private cpRy  =  16;
  private endRx =  12; private endRy =  30;

  constructor(
    sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
    scene:  Phaser.Scene,
  ) {
    this.sprite     = sprite;
    this.baseScaleX = sprite.scaleX;
    this.baseScaleY = sprite.scaleY;
    this.gfx        = scene.add.graphics().setDepth(11);
  }

  update(delta: number, state: PlayerAnimState): void {
    if (this.dormant) return;

    // ── Interrupts (checked before anything else) ──────────────────────────
    if (state.justDied) {
      this.sprite.setScale(this.baseScaleX, this.baseScaleY);
      this.sprite.setAngle(0);
      this.sprite.body.setSize(PLAYER_WIDTH / this.baseScaleX, PLAYER_HEIGHT / this.baseScaleY);
      this.gfx.clear();
      this.dormant = true;
      return;
    }
    if (state.frozen) {
      this.dormant = true;
      return;
    }

    // ── Timed-state tick ───────────────────────────────────────────────────
    if (this.stateTimer > 0) {
      // Interrupt timed state if a higher-priority event fires
      if (state.justLanded &&
          (this.state === AnimState.LAUNCHING || this.state === AnimState.AIR_JUMP)) {
        this.enterTimed(AnimState.LANDING, LANDING_DURATION);
        this.applyKeyframes();
        this.drawStrings();
        return;
      } else if (state.justWallJumped &&
                 (this.state === AnimState.LAUNCHING || this.state === AnimState.AIR_JUMP)) {
        this.enterTimed(AnimState.LAUNCHING, LAUNCH_DURATION);
        this.applyKeyframes();
        this.drawStrings();
        return;
      } else {
        this.stateTimer -= delta;
        if (this.stateTimer > 0) {
          this.applyKeyframes();
          this.drawStrings();
          return;
        }
        this.stateTimer = 0;
        // fall through to continuous-state selection below
      }
    }

    // ── Continuous-state transitions ───────────────────────────────────────
    if (state.justLanded) {
      this.enterTimed(AnimState.LANDING, LANDING_DURATION);
      this.applyKeyframes();
      this.drawStrings();
      return;
    }
    if (state.justJumped) {
      this.enterTimed(AnimState.LAUNCHING, LAUNCH_DURATION);
      this.applyKeyframes();
      this.drawStrings();
      return;
    }
    if (state.justAirJumped) {
      this.enterTimed(AnimState.AIR_JUMP, AIR_JUMP_DURATION);
      this.applyKeyframes();
      this.drawStrings();
      return;
    }

    if (state.onWall && !state.onGround && state.vy > 0) {
      this.state = AnimState.WALL_SLIDE;
    } else if (!state.onGround && Math.abs(state.vy) < APEX_VY_THRESHOLD) {
      this.state = AnimState.APEX;
    } else if (!state.onGround && state.vy >= APEX_VY_THRESHOLD) {
      this.state = AnimState.FALLING;
    } else {
      this.state = AnimState.IDLE;
    }

    this.idleTime     += delta;
    this.fallFlapTime += delta;
    this.apexTime     += delta;

    this.applyContinuousState(delta);
    this.drawStrings();
  }

  destroy(): void {
    this.sprite.setScale(this.baseScaleX, this.baseScaleY);
    this.sprite.setAngle(0);
    this.sprite.body.setSize(PLAYER_WIDTH / this.baseScaleX, PLAYER_HEIGHT / this.baseScaleY);
    this.gfx.destroy();
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private enterTimed(newState: AnimState, duration: number): void {
    this.state      = newState;
    this.stateTimer = duration;
    this.idleTime   = 0;
  }

  private applyKeyframes(): void {
    const frames   = this.state === AnimState.LAUNCHING ? LAUNCH_FRAMES
                   : this.state === AnimState.AIR_JUMP  ? AIR_JUMP_FRAMES
                   : LANDING_FRAMES;
    const duration = this.state === AnimState.LAUNCHING ? LAUNCH_DURATION
                   : this.state === AnimState.AIR_JUMP  ? AIR_JUMP_DURATION
                   : LANDING_DURATION;

    const t  = 1 - this.stateTimer / duration;   // 0 → 1 progress
    const kf = this.sampleKeyframes(frames, t);

    const absSX = kf.scaleX * this.baseScaleX;
    const absSY = kf.scaleY * this.baseScaleY;
    this.sprite.setScale(absSX, absSY);
    this.sprite.body.setSize(PLAYER_WIDTH / absSX, PLAYER_HEIGHT / absSY);

    // Snap string points to keyframe values (no lerp needed — keyframes are already smooth)
    this.cpLx  = kf.cpLx;  this.cpLy  = kf.cpLy;
    this.endLx = kf.endLx; this.endLy = kf.endLy;
    this.cpRx  = kf.cpRx;  this.cpRy  = kf.cpRy;
    this.endRx = kf.endRx; this.endRy = kf.endRy;
  }

  private sampleKeyframes(frames: Keyframe[], t: number): Keyframe {
    let a = frames[0];
    let b = frames[frames.length - 1];
    for (let i = 0; i < frames.length - 1; i++) {
      if (t >= frames[i].t && t <= frames[i + 1].t) {
        a = frames[i];
        b = frames[i + 1];
        break;
      }
    }
    const range = b.t - a.t;
    const f     = range < 0.0001 ? 1 : (t - a.t) / range;
    return {
      t,
      scaleX: a.scaleX + (b.scaleX - a.scaleX) * f,
      scaleY: a.scaleY + (b.scaleY - a.scaleY) * f,
      cpLx:   a.cpLx  + (b.cpLx  - a.cpLx)  * f,
      cpLy:   a.cpLy  + (b.cpLy  - a.cpLy)  * f,
      endLx:  a.endLx + (b.endLx - a.endLx) * f,
      endLy:  a.endLy + (b.endLy - a.endLy) * f,
      cpRx:   a.cpRx  + (b.cpRx  - a.cpRx)  * f,
      cpRy:   a.cpRy  + (b.cpRy  - a.cpRy)  * f,
      endRx:  a.endRx + (b.endRx - a.endRx) * f,
      endRy:  a.endRy + (b.endRy - a.endRy) * f,
    };
  }

  private applyContinuousState(delta: number): void {
    let sx: number, sy: number, angle: number;
    let cpLx: number, cpLy: number, endLx: number, endLy: number;
    let cpRx: number, cpRy: number, endRx: number, endRy: number;

    switch (this.state) {
      case AnimState.IDLE: {
        const wave = Math.sin((this.idleTime / IDLE_PERIOD) * Math.PI * 2);
        sx = 1 + wave * 0.025;
        sy = 1 - wave * 0.025;
        angle = 0;
        cpLx = -9; cpLy = 16; endLx = -12; endLy = 30;
        cpRx =  9; cpRy = 16; endRx =  12; endRy = 30;
        break;
      }
      case AnimState.APEX: {
        const wave = Math.sin((this.apexTime / APEX_WIGGLE_PERIOD) * Math.PI * 2);
        sx = 1.06; sy = 0.94; angle = wave * 2;
        cpLx = -20; cpLy = 6; endLx = -30; endLy = 8;
        cpRx =  20; cpRy = 6; endRx =  30; endRy = 8;
        break;
      }
      case AnimState.FALLING: {
        // Strings flutter between straight-up and angled
        const wave = Math.sin((this.fallFlapTime / FALL_FLAP_PERIOD) * Math.PI * 2);
        sx = 0.88; sy = 1.15; angle = 0;
        cpLx = -8.5 + wave * -3.5; cpLy = -7 + wave * 3; endLx = -6; endLy = -22;
        cpRx =  8.5 + wave *  3.5; cpRy = -7 + wave * 3; endRx =  6; endRy = -22;
        break;
      }
      case AnimState.WALL_SLIDE: {
        const wave = Math.sin((this.idleTime / 900) * Math.PI * 2) * 0.01;
        sx = 1.10 + wave; sy = 0.92 - wave; angle = 0;
        cpLx = -4; cpLy = 10; endLx =  -3; endLy = 24;
        cpRx = 10; cpRy = 12; endRx =  14; endRy = 26;
        break;
      }
      default:
        sx = 1; sy = 1; angle = 0;
        cpLx = -9; cpLy = 16; endLx = -12; endLy = 30;
        cpRx =  9; cpRy = 16; endRx =  12; endRy = 30;
    }

    const lerpF    = Math.min(1, (LERP_SPEED * delta) / 1000);
    const targetSX = sx * this.baseScaleX;
    const targetSY = sy * this.baseScaleY;
    const curSX    = this.sprite.scaleX + (targetSX - this.sprite.scaleX) * lerpF;
    const curSY    = this.sprite.scaleY + (targetSY - this.sprite.scaleY) * lerpF;
    const curAngle = this.sprite.angle  + (angle - this.sprite.angle)  * lerpF;

    this.sprite.setScale(curSX, curSY);
    this.sprite.setAngle(curAngle);
    this.sprite.body.setSize(PLAYER_WIDTH / curSX, PLAYER_HEIGHT / curSY);

    this.cpLx  += (cpLx  - this.cpLx)  * lerpF;
    this.cpLy  += (cpLy  - this.cpLy)  * lerpF;
    this.endLx += (endLx - this.endLx) * lerpF;
    this.endLy += (endLy - this.endLy) * lerpF;
    this.cpRx  += (cpRx  - this.cpRx)  * lerpF;
    this.cpRy  += (cpRy  - this.cpRy)  * lerpF;
    this.endRx += (endRx - this.endRx) * lerpF;
    this.endRy += (endRy - this.endRy) * lerpF;
  }

  private drawStrings(): void {
    const attachX = this.sprite.x;
    const attachY = this.sprite.y + PLAYER_HEIGHT * COLLAR_OFFSET_Y * this.sprite.scaleY;

    this.gfx.clear();
    this.gfx.lineStyle(STRING_STROKE_W, 0xffffff, 1);

    // Left string — quadratic bezier via line segments
    this.drawQuadraticBezier(
      attachX, attachY,
      attachX + this.cpLx, attachY + this.cpLy,
      attachX + this.endLx, attachY + this.endLy,
    );

    // Right string — quadratic bezier via line segments
    this.drawQuadraticBezier(
      attachX, attachY,
      attachX + this.cpRx, attachY + this.cpRy,
      attachX + this.endRx, attachY + this.endRy,
    );
  }

  private drawQuadraticBezier(x0: number, y0: number, cpx: number, cpy: number, x1: number, y1: number): void {
    // Approximate quadratic bezier with line segments
    const segments = 16;
    this.gfx.beginPath();
    this.gfx.moveTo(x0, y0);
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      const mt = 1 - t;
      const x = mt * mt * x0 + 2 * mt * t * cpx + t * t * x1;
      const y = mt * mt * y0 + 2 * mt * t * cpy + t * t * y1;
      this.gfx.lineTo(x, y);
    }
    this.gfx.strokePath();
  }
}
