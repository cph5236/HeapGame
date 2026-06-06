import {
  TILT_DEAD_ZONE_DEG,
  TILT_MAX_DEG,
  SWIPE_MIN_DISTANCE_PX,
  SWIPE_MAX_TIME_MS,
  DRAG_THRESHOLD_PX,
  SWIPE_JUMP_HORIZONTAL_MAX,
  SWIPE_JUMP_CURVE_EXP,
  TILT_CURVE_EXP,
} from '../constants';

/** A screen-space rectangle in Phaser game coordinates. */
export interface ScreenRect { x: number; y: number; w: number; h: number; }

/** Minimal structural view of Phaser's ScaleManager — just the page→game-coord
 *  transforms. Kept structural so InputManager stays Phaser-free and unit-testable. */
export interface ScreenTransform {
  transformX(pageX: number): number;
  transformY(pageY: number): number;
}

export class InputManager {
  private static instance: InputManager;

  // Continuous tilt state
  tiltFactor = 0;   // normalized [-1, 1]
  goLeft     = false;
  goRight    = false;

  // Control mode
  controlMode: 'tilt' | 'joystick' = 'tilt';
  diveHeld = false;   // continuous "stick down held" — sustains dive like keyboard Down

  // Continuous placement state
  placeHeld = false;

  // Consumed-per-frame impulse flags (cleared at start of each update)
  jumpJustPressed = false;
  jumpVx          = 0;   // horizontal component of swipe-up gesture, 0 for tap
  dashJustFired   = false;
  dashDir: 1 | -1 = 1;
  diveJustFired   = false;

  // Live drag outputs — updated by touchmove, cleared on touchend drag exit
  dragUp   = false;
  dragDown = false;

  // Platform
  readonly isMobile: boolean;
  tiltPermissionGranted = false;
  // True once a real deviceorientation event with non-null gamma has arrived. The
  // only trustworthy signal that tilt actually works — iOS in a cross-origin iframe
  // (e.g. itch.io) exposes DeviceOrientationEvent but never fires events. The tilt
  // watchdog uses this to fall back to the joystick.
  tiltDataReceived = false;

  // True on platforms (iOS 13+) where device-tilt needs a user-gesture permission
  // grant before any orientation events arrive. The tilt watchdog uses this to wait
  // for the permission tap instead of falling back prematurely.
  requiresPermissionGesture = false;

  // Internal tilt
  private gamma = 0;
  private tiltListenerAttached = false;

  // Touch state machine
  private touchState: 'idle' | 'tracking' | 'drag' = 'idle';
  private activeTouchId: number | undefined = undefined;
  private touchStartX    = 0;
  private touchStartY    = 0;
  private touchStartTime = 0;
  private currentTouchY  = 0;

  // True when the in-flight touch began inside a registered UI button zone, so
  // the global jump/dash/dive/drag handlers ignore the whole gesture. Decided
  // synchronously at touchstart by geometry — must NOT depend on Phaser's
  // (deferred) pointer events, which fire a frame too late to beat touchend.
  private uiGestureSuppressed = false;
  private screenTransform?: ScreenTransform;
  // Screen-space (Phaser game-coord) rects that swallow taps, keyed by owner id.
  // Buttons add/remove their rect as they show/hide.
  private suppressRects = new Map<string, ScreenRect>();

  // Pending impulse flags — set by touch handlers, consumed each frame
  private pendingJump     = false;
  private pendingJumpVx   = 0;
  private pendingDash     = false;
  private pendingDashDir: 1 | -1 = 1;
  private pendingDive     = false;

  private constructor() {
    this.isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    if (this.isMobile) {
      this.setupTilt();
      window.addEventListener('touchstart',  this.onTouchStart,  { passive: true });
      window.addEventListener('touchmove',   this.onTouchMove,   { passive: true });
      window.addEventListener('touchend',    this.onTouchEnd,    { passive: true });
      window.addEventListener('touchcancel', this.onTouchCancel, { passive: true });
    }
  }

  static getInstance(): InputManager {
    if (!InputManager.instance) {
      InputManager.instance = new InputManager();
    }
    return InputManager.instance;
  }

  /** Called once per frame from GameScene before player.update(). */
  // _inLiveZone reserved for future mobile UI gating (e.g. showing/hiding placement button inside InputManager)
  update(_delta: number, _inLiveZone: boolean): void {
    // Transfer pending touch impulses from last frame into active flags
    this.jumpJustPressed = this.pendingJump;
    this.jumpVx          = this.pendingJumpVx;
    this.dashJustFired   = this.pendingDash;
    this.diveJustFired   = this.pendingDive;
    if (this.pendingDash) this.dashDir = this.pendingDashDir;
    this.pendingJump   = false;
    this.pendingJumpVx = 0;
    this.pendingDash   = false;
    this.pendingDive   = false;

    // Compute analog tilt factor and derive binary booleans
    if (this.tiltListenerAttached && this.controlMode === 'tilt') {
      const g   = this.gamma;
      const abs = Math.abs(g);

      if (abs < TILT_DEAD_ZONE_DEG) {
        this.tiltFactor = 0;
      } else if (abs >= TILT_MAX_DEG) {
        this.tiltFactor = g > 0 ? 1 : -1;
      } else {
        const t = (abs - TILT_DEAD_ZONE_DEG) / (TILT_MAX_DEG - TILT_DEAD_ZONE_DEG);
        this.tiltFactor = Math.sign(g) * Math.pow(t, TILT_CURVE_EXP);
      }

      this.goLeft  = this.tiltFactor < -0.01;
      this.goRight = this.tiltFactor >  0.01;
    }
  }

  /** Wire the Phaser ScaleManager so touch coords (page space) can be mapped to
   *  game space for UI hit-testing. Call once at startup. */
  attachScreenTransform(t: ScreenTransform): void {
    this.screenTransform = t;
  }

  /** Register (rect) or clear (null) a screen-space zone, in Phaser game coords,
   *  that swallows taps so they never become a jump/dash/dive/drag. On-screen
   *  buttons call this as they show/hide. Keyed by `id` so each button owns one. */
  setSuppressionRect(id: string, rect: ScreenRect | null): void {
    if (rect) this.suppressRects.set(id, rect);
    else      this.suppressRects.delete(id);
  }

  /** True if a page-space point falls inside any registered suppression zone.
   *  Decided synchronously at touchstart, independent of Phaser's pointer timing. */
  private isInSuppressionZone(pageX: number, pageY: number): boolean {
    if (!this.screenTransform || this.suppressRects.size === 0) return false;
    const gx = this.screenTransform.transformX(pageX);
    const gy = this.screenTransform.transformY(pageY);
    for (const r of this.suppressRects.values()) {
      if (gx >= r.x && gx <= r.x + r.w && gy >= r.y && gy <= r.y + r.h) return true;
    }
    return false;
  }

  /** Set the control scheme. Joystick mode gates device-tilt and window gestures
   *  off; a JoystickController becomes the sole movement source. */
  setControlMode(mode: 'tilt' | 'joystick'): void {
    this.controlMode = mode;
  }

  /** Joystick: write the analog horizontal axis (−1..1) directly. */
  setAxis(factor: number): void {
    this.tiltFactor = factor;
    this.goLeft  = factor < -0.01;
    this.goRight = factor >  0.01;
  }

  /** Joystick: queue a jump pulse for the next frame (vx = horizontal launch). */
  pulseJump(vx = 0): void {
    this.pendingJump   = true;
    this.pendingJumpVx = vx;
  }

  /** Joystick: queue a dash pulse for the next frame. */
  pulseDash(dir: 1 | -1): void {
    this.pendingDash    = true;
    this.pendingDashDir = dir;
  }

  /** Joystick: queue a dive burst for the next frame. */
  pulseDive(): void {
    this.pendingDive = true;
  }

  /** Joystick: continuous ladder-climb signals (up/down held on the stick). */
  setLadderDrag(up: boolean, down: boolean): void {
    this.dragUp   = up;
    this.dragDown = down;
  }

  /** Called by the on-screen placement button on pointerdown. */
  startPlace(): void {
    this.placeHeld = true;
  }

  /** Called by the on-screen placement button on pointerup / pointerout. */
  endPlace(): void {
    this.placeHeld = false;
  }

  /** Requests DeviceOrientation permission (iOS 13+). Resolves to whether tilt was
   *  granted. No-op (returns true) on platforms without the permission gate. Never
   *  throws — a rejected/blocked request (e.g. cross-origin iframe) resolves false
   *  so callers can fall back to the joystick. */
  async requestTiltPermission(): Promise<boolean> {
    if (!this.requiresPermissionGesture) return true;

    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const result = await (DeviceOrientationEvent as any).requestPermission();
      if (result === 'granted') {
        this.attachTiltListener();
        this.tiltPermissionGranted = true;
        return true;
      }
    } catch {
      // Permission API blocked (e.g. cross-origin iframe) — treat as unavailable.
    }
    return false;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private setupTilt(): void {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    if (typeof (DeviceOrientationEvent as any).requestPermission === 'function') {
      // iOS 13+ — must wait for user gesture
      this.requiresPermissionGesture = true;
    } else {
      // Android / desktop with tilt — attach immediately
      this.attachTiltListener();
      this.tiltPermissionGranted = true;
    }
  }

  private attachTiltListener(): void {
    if (this.tiltListenerAttached) return;
    window.addEventListener('deviceorientation', this.onDeviceOrientation);
    this.tiltListenerAttached = true;
  }

  private onDeviceOrientation = (e: DeviceOrientationEvent): void => {
    if (e.gamma !== null) {
      this.gamma = e.gamma;
      this.tiltDataReceived = true;
    }
  };

  private onTouchStart = (e: TouchEvent): void => {
    if (this.touchState !== 'idle') return;
    // Track the first NEWLY-pressed touch that isn't inside a UI zone (joystick
    // base, on-screen buttons). We scan `changedTouches` (the fingers added by THIS
    // event), tested at their press position — never `touches` (all fingers down),
    // because a held joystick finger that has dragged out of the stick's rect would
    // otherwise be mistaken for a fresh gesture and swallow the jump. This lets a
    // tap/swipe jump register while another finger holds the joystick, and a tap on
    // a button never becomes a jump. Joystick supplies movement; taps/swipes jump.
    let t: Touch | undefined;
    for (let i = 0; i < e.changedTouches.length; i++) {
      if (!this.isInSuppressionZone(e.changedTouches[i].clientX, e.changedTouches[i].clientY)) {
        t = e.changedTouches[i];
        break;
      }
    }
    if (!t) return;
    this.activeTouchId  = t.identifier;
    this.touchStartX    = t.clientX;
    this.touchStartY    = t.clientY;
    this.touchStartTime = performance.now();
    this.currentTouchY  = t.clientY;
    this.touchState     = 'tracking';
    this.uiGestureSuppressed = false; // only non-suppressed touches are ever tracked
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (this.touchState !== 'tracking' && this.touchState !== 'drag') return;
    if (this.uiGestureSuppressed) return;

    const t = Array.from(e.touches).find(touch => touch.identifier === this.activeTouchId);
    if (!t) return;

    const currentX = t.clientX;
    const currentY = t.clientY;

    if (this.touchState === 'tracking') {
      const adx = Math.abs(currentX - this.touchStartX);
      const ady = Math.abs(currentY - this.touchStartY);

      if (ady > adx && ady >= DRAG_THRESHOLD_PX) {
        this.touchState = 'drag';
      }
    }

    this.currentTouchY = currentY;

    // Update live drag outputs
    if (this.touchState === 'drag') {
      this.dragUp   = this.currentTouchY < this.touchStartY - DRAG_THRESHOLD_PX;
      this.dragDown = this.currentTouchY > this.touchStartY + DRAG_THRESHOLD_PX;
    }
  };

  private onTouchCancel = (): void => {
    this.touchState         = 'idle';
    this.activeTouchId      = undefined;
    this.dragUp             = false;
    this.dragDown           = false;
    this.uiGestureSuppressed = false;
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (this.touchState === 'idle') return;

    const t = Array.from(e.changedTouches).find(touch => touch.identifier === this.activeTouchId);
    if (!t) return; // a different finger lifted — keep tracking ours

    const wasDrag = this.touchState === 'drag';
    this.dragUp        = false;
    this.dragDown      = false;
    this.touchState    = 'idle';
    this.activeTouchId = undefined;

    // Gesture was claimed by a UI button — consume it without firing any impulse.
    if (this.uiGestureSuppressed) {
      this.uiGestureSuppressed = false;
      return;
    }

    const dx  = t.clientX - this.touchStartX;
    const dy  = t.clientY - this.touchStartY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const dt  = performance.now() - this.touchStartTime;
    const mag  = Math.sqrt(dx * dx + dy * dy);
    const fast = mag >= SWIPE_MIN_DISTANCE_PX && dt < SWIPE_MAX_TIME_MS;

    if (adx > ady && adx >= SWIPE_MIN_DISTANCE_PX && dt < SWIPE_MAX_TIME_MS) {
      this.pendingDash    = true;
      this.pendingDashDir = dx > 0 ? 1 : -1;
    } else if (ady > adx && fast && dy > 0) {
      this.pendingDive = true;
    } else if (ady > adx && fast && dy < 0) {
      this.pendingJump   = true;
      this.pendingJumpVx = this.computeSwipeJumpVx(dx, dy);
    } else if (!wasDrag) {
      this.pendingJump = true;
    }
  };

  private computeSwipeJumpVx(dx: number, dy: number): number {
    const sinAbs = Math.abs(dx) / Math.sqrt(dx * dx + dy * dy);
    return Math.sign(dx) * Math.pow(Math.min(1, sinAbs / Math.SQRT1_2), SWIPE_JUMP_CURVE_EXP) * SWIPE_JUMP_HORIZONTAL_MAX;
  }
}
