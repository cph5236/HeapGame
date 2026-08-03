/** Pure decisions about whether device-tilt can actually steer the player right
 *  now, derived from the platform flags InputManager discovers at construction.
 *
 *  Kept Phaser-free and side-effect-free so every entry point (main bootstrap,
 *  MenuScene, tutorial) reaches the same verdict from the same rules. */

export interface TiltPlatformState {
  isMobile: boolean;
  /** iOS 13+: orientation events need a user-gesture permission grant first. */
  requiresPermissionGesture: boolean;
  tiltPermissionGranted: boolean;
  /** Cross-origin iframe (itch.io) — the grant dialog can never be shown. */
  tiltPermissionBlocked: boolean;
}

/** True when tilt is gated behind a permission grant that hasn't happened yet,
 *  so no `deviceorientation` listener is attached and tilt mode would leave the
 *  player with no movement input at all. */
export function isTiltPendingPermission(p: TiltPlatformState): boolean {
  return p.isMobile && p.requiresPermissionGesture && !p.tiltPermissionGranted;
}

/** Session control-mode override to apply at startup, or null to leave the saved
 *  pref in force.
 *
 *  Tilt is treated as an opt-in UPGRADE on iOS rather than a default that has to
 *  be disproved: until the grant lands, the joystick is the active mode on every
 *  entry point. Before this, a first-time iPhone player booted straight into
 *  TutorialScene — which never runs MenuScene's tilt prompt — and was left in
 *  tilt mode with no orientation listener and no joystick, i.e. unable to move.
 *
 *  This is a SESSION override, so the saved pref is untouched: clearing it the
 *  moment permission is granted restores the player's chosen tilt controls. */
export function startupControlOverride(p: TiltPlatformState): 'joystick' | null {
  return isTiltPendingPermission(p) ? 'joystick' : null;
}

/** Which tilt affordance the menu should surface.
 *  - `permission` — offer the grant opt-in ("Enable Tilt Controls").
 *  - `blocked`    — grant is impossible here; explain why the joystick is on.
 *  - `none`       — tilt works, or the player already picked the joystick. */
export type TiltPromptKind = 'none' | 'permission' | 'blocked';

export function tiltPromptKind(
  p: TiltPlatformState, savedMode: 'tilt' | 'joystick',
): TiltPromptKind {
  if (!isTiltPendingPermission(p)) return 'none';
  // An explicit joystick preference is an answer already — don't re-ask.
  if (savedMode === 'joystick') return 'none';
  return p.tiltPermissionBlocked ? 'blocked' : 'permission';
}

/** The control mode a gameplay scene should actually mount, given the preferred
 *  (effective) mode. Last line of defence: on mobile, tilt that isn't authorized
 *  mounts NO controls at all, so substitute the joystick rather than hand the
 *  player a scene they cannot move in. Desktop keeps 'tilt' — there the mode
 *  simply means "no on-screen stick", and the keyboard drives the player. */
export function mountableControlMode(
  preferred: 'tilt' | 'joystick',
  p: { isMobile: boolean; tiltAuthorized: boolean },
): 'tilt' | 'joystick' {
  if (preferred === 'joystick') return 'joystick';
  if (!p.isMobile) return 'tilt';
  return p.tiltAuthorized ? 'tilt' : 'joystick';
}
