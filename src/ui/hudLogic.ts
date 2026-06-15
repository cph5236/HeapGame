export type ControlMode = 'tilt' | 'joystick';
export type JoystickSide = 'left' | 'right';

/** Tray dash bar shows unless an on-screen dash button carries the cooldown
 *  (mobile joystick mode). Desktop + mobile-tilt have no dash button. */
export function showDashIndicator(isMobile: boolean, mode: ControlMode): boolean {
  return !isMobile || mode !== 'joystick';
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** One boolean per air-jump slot: first `left` are available, rest used. */
export function airJumpPipStates(left: number, max: number): boolean[] {
  const l = clamp(left, 0, max);
  return Array.from({ length: max }, (_, i) => i < l);
}

/** Dash bar fill (0..1): full when ready (cooldown 0), empty mid-cooldown (1). */
export function dashBarFillFraction(cooldownFraction: number): number {
  return 1 - clamp(cooldownFraction, 0, 1);
}

export interface ClusterDims {
  joyRadius: number; joyMargin: number; dashRadius: number;
  placeW: number; placeH: number; placeGap: number;
}
export interface ClusterLayout {
  stick: { x: number; y: number };
  dash:  { x: number; y: number };
  place: { x: number; y: number };
}

/** Position the whole control cluster by handedness. Stick in one bottom corner;
 *  dash button + PLACE (stacked above it) in the opposite corner. Centers. */
export function controlClusterLayout(
  side: JoystickSide, w: number, h: number, d: ClusterDims,
): ClusterLayout {
  const stickX = side === 'left' ? d.joyMargin + d.joyRadius : w - d.joyMargin - d.joyRadius;
  const stickY = h - d.joyMargin - d.joyRadius;
  const dashX  = side === 'left' ? w - d.joyMargin - d.dashRadius : d.joyMargin + d.dashRadius;
  const dashY  = h - d.joyMargin - d.dashRadius;
  const placeX = dashX;
  const placeY = dashY - d.dashRadius - d.placeGap - d.placeH / 2;
  return {
    stick: { x: stickX, y: stickY },
    dash:  { x: dashX,  y: dashY  },
    place: { x: placeX, y: placeY },
  };
}
