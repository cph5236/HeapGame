import {
  TILT_DEAD_ZONE_DEG,
  TILT_MAX_DEG,
  SWIPE_MIN_DISTANCE_PX,
  SWIPE_MAX_TIME_MS,
  DRAG_THRESHOLD_PX,
} from '../constants';

export class InputManager {
  private static instance: InputManager;

  // Continuous tilt state
  tiltFactor = 0;   // normalized [-1, 1]
  goLeft     = false;
  goRight    = false;

  // Continuous placement state
  placeHeld = false;

  // Consumed-per-frame impulse flags (cleared at start of each update)
  jumpJustPressed = false;
  dashJustFired   = false;
  dashDir: 1 | -1 = 1;
  diveJustFired   = false;

  // Live drag outputs — updated by touchmove, cleared on touchend drag exit
  dragUp   = false;
  dragDown = false;

  // Platform
  readonly isMobile: boolean;
  tiltPermissionGranted = false;

  // Internal tilt
  private gamma = 0;
  private tiltListenerAttached = false;
  private requiresPermissionGesture = false;

  // Touch state machine
  private touchState: 'idle' | 'tracking' | 'drag' = 'idle';
  private touchStartX    = 0;
  private touchStartY    = 0;
  private touchStartTime = 0;
  private currentTouchY  = 0;

  // Pending impulse flags — set by touch handlers, consumed each frame
  private pendingJump     = false;
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
    this.dashJustFired   = this.pendingDash;
    this.diveJustFired   = this.pendingDive;
    if (this.pendingDash) this.dashDir = this.pendingDashDir;
    this.pendingJump = false;
    this.pendingDash = false;
    this.pendingDive = false;

    // Compute analog tilt factor and derive binary booleans
    if (this.tiltListenerAttached) {
      const g   = this.gamma;
      const abs = Math.abs(g);

      if (abs < TILT_DEAD_ZONE_DEG) {
        this.tiltFactor = 0;
      } else if (abs >= TILT_MAX_DEG) {
        this.tiltFactor = g > 0 ? 1 : -1;
      } else {
        const raw = (Math.sign(g) * (abs - TILT_DEAD_ZONE_DEG)) / (TILT_MAX_DEG - TILT_DEAD_ZONE_DEG);
        this.tiltFactor = Math.max(-1, Math.min(1, raw));
      }

      this.goLeft  = this.tiltFactor < -0.01;
      this.goRight = this.tiltFactor >  0.01;
    }
  }

  /** Called by the on-screen placement button on pointerdown. */
  startPlace(): void {
    this.placeHeld = true;
  }

  /** Called by the on-screen placement button on pointerup / pointerout. */
  endPlace(): void {
    this.placeHeld = false;
  }

  /** Requests DeviceOrientation permission (iOS 13+). No-op on Android. */
  async requestTiltPermission(): Promise<void> {
    if (!this.requiresPermissionGesture) return;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const result = await (DeviceOrientationEvent as any).requestPermission();
    if (result === 'granted') {
      this.attachTiltListener();
      this.tiltPermissionGranted = true;
    }
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
    if (e.gamma !== null) this.gamma = e.gamma;
  };

  private onTouchStart = (e: TouchEvent): void => {
    const t = e.touches[0];
    if (!t) return;
    this.touchStartX    = t.clientX;
    this.touchStartY    = t.clientY;
    this.touchStartTime = performance.now();
    this.currentTouchY  = t.clientY;
    this.touchState     = 'tracking';
  };

  private onTouchMove = (e: TouchEvent): void => {
    if (this.touchState !== 'tracking' && this.touchState !== 'drag') return;

    const t = e.touches[0];
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
    this.touchState = 'idle';
    this.dragUp     = false;
    this.dragDown   = false;
  };

  private onTouchEnd = (e: TouchEvent): void => {
    if (this.touchState === 'idle') {
      // Spurious event — ignore
      return;
    }

    if (this.touchState === 'drag') {
      // Clear drag outputs and return without firing swipe/tap
      this.dragUp    = false;
      this.dragDown  = false;
      this.touchState = 'idle';
      return;
    }

    // State was 'tracking' — run swipe classifier
    const t = e.changedTouches[0];
    if (!t) {
      this.touchState = 'idle';
      return;
    }

    const dx  = t.clientX - this.touchStartX;
    const dy  = t.clientY - this.touchStartY;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);
    const dt  = performance.now() - this.touchStartTime;

    if (adx > ady && adx >= SWIPE_MIN_DISTANCE_PX && dt < SWIPE_MAX_TIME_MS) {
      // Horizontal swipe → dash
      this.pendingDash    = true;
      this.pendingDashDir = dx > 0 ? 1 : -1;
    } else if (ady > adx && ady >= SWIPE_MIN_DISTANCE_PX && dt < SWIPE_MAX_TIME_MS && dy > 0) {
      // Swipe down → dive
      this.pendingDive = true;
    } else if (ady > adx && ady >= SWIPE_MIN_DISTANCE_PX && dt < SWIPE_MAX_TIME_MS && dy < 0) {
      // Swipe up → jump
      this.pendingJump = true;
    } else {
      // Tap
      this.pendingJump = true;
    }

    this.touchState = 'idle';
  };
}
