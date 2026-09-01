import type { SettingsSceneData } from './SettingsScene';

/** A gameplay scene that can rebuild its on-screen controls in place. */
export interface ControlHost {
  remountControls?: () => void;
}

/**
 * Build the SettingsSceneData the pause menu launches with.
 *
 * Split out from PauseScene so the `onControlsChanged` wiring is unit-testable.
 * The live control scheme is established once, by mountJoystick() at gameplay
 * `create()` — it is the only caller of `InputManager.setControlMode`. Changing
 * the mode from Settings persists the preference but touches nothing already on
 * screen, so without this callback a mid-run switch silently does nothing until
 * the next run starts.
 *
 * @param returnTo   scene to resume when Settings closes (the pause menu itself)
 * @param hostLookup resolves the running gameplay scene; may return undefined if
 *                   it has been stopped while Settings was open.
 */
export function pauseSettingsData(
  returnTo: string,
  hostLookup: () => ControlHost | undefined,
): SettingsSceneData {
  return {
    returnTo,
    context: 'game',
    onControlsChanged: () => { hostLookup()?.remountControls?.(); },
  };
}
