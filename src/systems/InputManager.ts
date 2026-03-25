import {
  TILT_DEAD_ZONE_DEG,
  SWIPE_MIN_DISTANCE_PX,
  SWIPE_MAX_TIME_MS,
  SWIPE_DIRECTION_RATIO,
} from '../constants';

export class InputManager {
  private static instance: InputManager;

  // Continuous tilt state
  goLeft  = false;
  goRight = false;

  // Consumed-per-frame impulse flags (cleared at start of each update)
  jumpJustPressed  = false;
  dashJustFired    = false;
  dashDir: 1 | -1  = 1;
  placeJustPressed = false;

  // Platform
  readonly isMobile: boolean;
  tiltPermissionGranted = false;

  // Internal tilt
  private gamma = 0;
  private tiltListenerAttached = false;
  private requiresPermissionGesture = false;

  // Internal touch tracking
  private touchStartX    = 0;
  private touchStartY    = 0;
  private touchStartTime = 0;

  // Pending impulse flags — set by touch handlers, consumed each frame
  private pendingJump     = false;
  private pendingPlace    = false;
  private pendingDash     = false;
  private pendingDashDir: 1 | -1 = 1;

  private constructor() {
    this.isMobile = ('ontouchstart' in window) || navigator.maxTouchPoints > 0;

    if (this.isMobile) {
      this.setupTilt();
      window.addEventListener('touchstart', this.onTouchStart, { passive: true });
      window.addEventListener('touchend',   this.onTouchEnd,   { passive: true });
    }
  }

  static getInstance(): InputManager {
    if (!InputManager.instance) {
      InputManager.instance = new InputManager();
    }
    return InputManager.instance;
  }

  /** Called once per frame from GameScene before player.update(). */
  update(_delta: number, _inTopZone: boolean): void {
    // Transfer pending touch impulses from last frame into active flags
    this.jumpJustPressed  = this.pendingJump;
    this.dashJustFired    = this.pendingDash;
    if (this.pendingDash) this.dashDir = this.pendingDashDir;
    this.placeJustPressed = this.pendingPlace;
    this.pendingJump  = false;
    this.pendingDash  = false;
    this.pendingPlace = false;

    // Update directional state from tilt
    if (this.tiltListenerAttached) {
      this.goLeft  = this.gamma < -TILT_DEAD_ZONE_DEG;
      this.goRight = this.gamma >  TILT_DEAD_ZONE_DEG;
    }
  }

  /** Called by the on-screen placement button to trigger a block placement. */
  triggerPlace(): void {
    this.pendingPlace = true;
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
  };

  private onTouchEnd = (e: TouchEvent): void => {
    const t = e.changedTouches[0];
    if (!t) return;

    const dx = t.clientX - this.touchStartX;
    const dy = t.clientY - this.touchStartY;
    const dt = performance.now() - this.touchStartTime;
    const adx = Math.abs(dx);
    const ady = Math.abs(dy);

    const isSwipe =
      dt < SWIPE_MAX_TIME_MS &&
      adx > SWIPE_MIN_DISTANCE_PX &&
      (ady === 0 || adx / ady > SWIPE_DIRECTION_RATIO);

    if (isSwipe) {
      this.pendingDash    = true;
      this.pendingDashDir = dx > 0 ? 1 : -1;
    } else {
      this.pendingJump = true;
    }
  };
}
