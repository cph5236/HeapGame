/**
 * The save file, split along the platform/game seam.
 *
 * `save/core.ts` owns storage, schema versioning, player identity and write-auth,
 * and device-local preferences — everything a game built on this shell keeps.
 * `save/game.ts` owns this game's fields and every rule about how they migrate
 * and merge, so deleting that one file leaves a working platform save behind.
 *
 * This barrel re-exports both so no call site needs to know where a given
 * accessor lives. Import from here, not from `save/core` or `save/game`
 * directly — importing the barrel is also what guarantees the game half has
 * registered its extension with core before anything calls load().
 */
export * from './save/game';
export {
  SAVE_KEY,
  CURRENT_SCHEMA,
  type SoundSettings,
  type CoreSave,
  type RawSave,
  type SaveExtension,
  MissingSaveExtensionError,
  getStoredRemoteConfig,
  setStoredRemoteConfig,
  resetAllData,
  getPlayerGuid,
  getPlayerName,
  setPlayerName,
  getGpgsPlayerId,
  getEffectivePlayerId,
  setGpgsPlayerId,
  getPlayerSecret,
  getVerboseLogging,
  setVerboseLogging,
  mergeCloudSave,
  getRawSaveForCloudSync,
  applyMergedSave,
  getControlMode,
  setControlMode,
  getJoystickSide,
  setJoystickSide,
  setSessionControlMode,
  clearAutoControlOverride,
  getEffectiveControlMode,
  getSoundSettings,
  setSoundVolume,
  resetCacheForTests,
  getSchemaVersionForTests,
} from './save/core';
