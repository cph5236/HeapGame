/**
 * pauseSettings.test.ts — the pause menu's Settings hand-off.
 *
 * Regression guard for a mid-run control switch doing nothing. Before A2 the
 * pause menu's "Controls" view was read-only help text, so the mode could not be
 * changed mid-run at all. Routing pause -> SettingsScene exposed the real Tilt /
 * Joystick toggles in a running game, but the live scheme is only ever
 * established by mountJoystick() at gameplay create() — the sole caller of
 * InputManager.setControlMode. Without an onControlsChanged that re-mounts, the
 * toggle persists the preference and changes nothing on screen until next run.
 */
import { describe, it, expect } from 'vitest';
import { pauseSettingsData, type ControlHost } from '../pauseSettings';

describe('pauseSettingsData', () => {
  it('resumes the pause menu and opens in game context', () => {
    const data = pauseSettingsData('PauseScene', () => undefined);
    expect(data.returnTo).toBe('PauseScene');
    expect(data.context).toBe('game');
  });

  it('supplies an onControlsChanged callback', () => {
    // The bug: this was absent, so SettingsScene's `this.onControlsChanged?.()`
    // was a no-op on the pause path.
    expect(pauseSettingsData('PauseScene', () => undefined).onControlsChanged)
      .toBeTypeOf('function');
  });

  it('re-mounts the running scene controls when Settings changes the mode', () => {
    let remounted = 0;
    const host: ControlHost = { remountControls: () => { remounted += 1; } };
    pauseSettingsData('PauseScene', () => host).onControlsChanged!();
    expect(remounted).toBe(1);
  });

  it('resolves the host lazily, per invocation', () => {
    // The gameplay scene must be looked up when the toggle is tapped, not when
    // Settings is launched — flipping the mode twice has to reach it twice.
    const seen: number[] = [];
    let n = 0;
    const data = pauseSettingsData('PauseScene', () => ({
      remountControls: () => seen.push(n),
    }));
    n = 1; data.onControlsChanged!();
    n = 2; data.onControlsChanged!();
    expect(seen).toEqual([1, 2]);
  });

  it('tolerates the gameplay scene having gone away', () => {
    expect(() => pauseSettingsData('PauseScene', () => undefined).onControlsChanged!())
      .not.toThrow();
  });

  it('tolerates a host that cannot re-mount', () => {
    expect(() => pauseSettingsData('PauseScene', () => ({})).onControlsChanged!())
      .not.toThrow();
  });
});
