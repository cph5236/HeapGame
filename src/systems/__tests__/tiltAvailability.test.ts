import { describe, it, expect } from 'vitest';
import {
  isTiltPendingPermission,
  mountableControlMode,
  startupControlOverride,
  tiltPromptKind,
  type TiltPlatformState,
} from '../tiltAvailability';

/** Android / desktop-with-gyro: setupTilt() attached the listener immediately. */
const ANDROID: TiltPlatformState = {
  isMobile: true,
  requiresPermissionGesture: false,
  tiltPermissionGranted: true,
  tiltPermissionBlocked: false,
};

/** iOS on a top-level page (heapgame.com): the permission dialog CAN appear,
 *  but nothing is granted until the player taps for it. */
const IOS_WEB: TiltPlatformState = {
  isMobile: true,
  requiresPermissionGesture: true,
  tiltPermissionGranted: false,
  tiltPermissionBlocked: false,
};

/** iOS inside itch.io's cross-origin iframe: the dialog can never appear. */
const IOS_ITCH: TiltPlatformState = {
  isMobile: true,
  requiresPermissionGesture: true,
  tiltPermissionGranted: false,
  tiltPermissionBlocked: true,
};

/** iOS after the player granted permission. */
const IOS_GRANTED: TiltPlatformState = { ...IOS_WEB, tiltPermissionGranted: true };

const DESKTOP: TiltPlatformState = {
  isMobile: false,
  requiresPermissionGesture: false,
  tiltPermissionGranted: false,
  tiltPermissionBlocked: false,
};

describe('isTiltPendingPermission', () => {
  it('is true on iOS web before the player grants permission', () => {
    expect(isTiltPendingPermission(IOS_WEB)).toBe(true);
  });
  it('is true on iOS inside a cross-origin iframe (grant can never happen)', () => {
    expect(isTiltPendingPermission(IOS_ITCH)).toBe(true);
  });
  it('is false once iOS permission is granted', () => {
    expect(isTiltPendingPermission(IOS_GRANTED)).toBe(false);
  });
  it('is false on Android, where the listener attaches immediately', () => {
    expect(isTiltPendingPermission(ANDROID)).toBe(false);
  });
  it('is false on desktop', () => {
    expect(isTiltPendingPermission(DESKTOP)).toBe(false);
  });
});

describe('startupControlOverride', () => {
  // The bug: a first-time iPhone player boots straight into TutorialScene, which
  // never runs MenuScene's tilt prompt. In tilt mode with no orientation listener
  // attached they had NO movement input at all. The override makes the joystick
  // the active mode on every entry point until tilt can actually deliver data.
  it('forces the joystick on iOS web before permission is granted', () => {
    expect(startupControlOverride(IOS_WEB)).toBe('joystick');
  });
  it('forces the joystick on iOS inside a cross-origin iframe', () => {
    expect(startupControlOverride(IOS_ITCH)).toBe('joystick');
  });
  it('leaves the saved pref alone once iOS permission is granted', () => {
    expect(startupControlOverride(IOS_GRANTED)).toBeNull();
  });
  it('leaves the saved pref alone on Android', () => {
    expect(startupControlOverride(ANDROID)).toBeNull();
  });
  it('leaves the saved pref alone on desktop', () => {
    expect(startupControlOverride(DESKTOP)).toBeNull();
  });
});

describe('tiltPromptKind', () => {
  it('offers the permission opt-in on iOS web when tilt is the saved pref', () => {
    expect(tiltPromptKind(IOS_WEB, 'tilt')).toBe('permission');
  });
  it('stays silent on iOS web when the player already chose the joystick', () => {
    expect(tiltPromptKind(IOS_WEB, 'joystick')).toBe('none');
  });
  it('explains the blocked context on itch.io rather than offering a dead button', () => {
    expect(tiltPromptKind(IOS_ITCH, 'tilt')).toBe('blocked');
  });
  it('stays silent on itch.io when the player already chose the joystick', () => {
    expect(tiltPromptKind(IOS_ITCH, 'joystick')).toBe('none');
  });
  it('stays silent once iOS permission is granted', () => {
    expect(tiltPromptKind(IOS_GRANTED, 'tilt')).toBe('none');
  });
  it('stays silent on Android', () => {
    expect(tiltPromptKind(ANDROID, 'tilt')).toBe('none');
  });
  it('stays silent on desktop', () => {
    expect(tiltPromptKind(DESKTOP, 'tilt')).toBe('none');
  });
});

describe('mountableControlMode', () => {
  it('substitutes the joystick when mobile tilt is not authorized', () => {
    expect(mountableControlMode('tilt', { isMobile: true, tiltAuthorized: false })).toBe('joystick');
  });
  it('keeps tilt once tilt is authorized', () => {
    expect(mountableControlMode('tilt', { isMobile: true, tiltAuthorized: true })).toBe('tilt');
  });
  it('keeps tilt on desktop, where the keyboard drives the player', () => {
    expect(mountableControlMode('tilt', { isMobile: false, tiltAuthorized: false })).toBe('tilt');
  });
  it('never overrides an explicit joystick preference', () => {
    expect(mountableControlMode('joystick', { isMobile: true, tiltAuthorized: true })).toBe('joystick');
    expect(mountableControlMode('joystick', { isMobile: false, tiltAuthorized: false })).toBe('joystick');
  });
});
