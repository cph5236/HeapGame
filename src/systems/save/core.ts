import type { AppConfig } from '../../../shared/configTypes';
import { generateDefaultPlayerName, MAX_PLAYER_NAME_LEN } from '../../../shared/playerName';

const SAVE_KEY = 'heap_save';
const CURRENT_SCHEMA = 5;

export { SAVE_KEY, CURRENT_SCHEMA };

export interface SoundSettings {
  master:    number;
  music:     number;
  playerSfx: number;
  enemySfx:  number;
  envSfx:    number;
}

const DEFAULT_SOUND_SETTINGS: SoundSettings = {
  master:    1.0,
  music:     0.7,
  playerSfx: 1.0,
  enemySfx:  0.8,
  envSfx:    0.9,
};

/** The half of the save that belongs to the platform: who the player is, how
 *  they're authenticated, and their device-local preferences. A game built on
 *  this shell keeps every field here and contributes its own via
 *  {@link SaveExtension}. */
export interface CoreSave {
  schemaVersion: number;
  playerGuid:     string;
  playerSecret?:  string;   // private write-auth token — never displayed, never logged
  playerName:     string;
  gpgsPlayerId?:  string;
  verboseLogging?: boolean;
  soundSettings?: SoundSettings;
  controlMode?:     'tilt' | 'joystick';
  joystickSide?:    'left' | 'right';
  /** Last-known-good remote config (GET /config). A cache, not authoritative:
   *  seeds ConfigClient before the boot fetch resolves and survives an offline
   *  launch. Rides the cloud save so a fresh install starts warm. */
  remoteConfig?:    AppConfig;
}

/**
 * How a game contributes its own fields to the save. Registered once, at module
 * load, by the game half — see `save/game.ts`.
 *
 * Core never inspects game fields. It calls these three hooks and merges their
 * results UNDER its own, so a game rule can never overwrite a core field. That
 * ordering is what makes the `playerSecret` invariant structural rather than a
 * convention: dropping the secret regenerates it on the next `getPlayerSecret()`,
 * which the server rejects as a hash mismatch and the player is 403-locked out
 * of their own data permanently.
 */
export interface SaveExtension<G extends object = object> {
  /** Fields for a brand-new save. */
  fresh(): G;
  /** Migrate this game's fields from a parsed blob at the given schema version. */
  migrate(parsed: any, version: number): G;
  /** Merge this game's fields across two saves during cloud sync. */
  merge(local: any, cloud: any): G;
}

let _ext: SaveExtension | null = null;

/** Install the game half. Called at module scope by `save/game.ts`; the
 *  `SaveData` barrel imports that before anything can call `load()`. */
export function setSaveExtension(ext: SaveExtension): void { _ext = ext; }

const extFresh   = (): object => _ext?.fresh() ?? {};
const extMigrate = (parsed: any, v: number): object => _ext?.migrate(parsed, v) ?? {};
const extMerge   = (l: any, c: any): object => _ext?.merge(l, c) ?? {};

/** The whole stored record: core fields plus whatever the game registered. Game
 *  fields are opaque here — they ride through load/persist/merge untouched. */
export type RawSave = CoreSave & Record<string, any>;

let _cache: RawSave | null = null;

function generateGuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}-${Math.random().toString(36).slice(2, 10)}`;
}

function freshCore(): CoreSave {
  return {
    schemaVersion: CURRENT_SCHEMA,
    playerGuid:    generateGuid(),
    playerName:    generateDefaultPlayerName(),
    soundSettings: { ...DEFAULT_SOUND_SETTINGS },
  };
}

function freshSave(): RawSave {
  return { ...extFresh(), ...freshCore() };
}

/** Core fields are version-independent: every schema this code has ever written
 *  stored them the same way, so one branch covers v1 through CURRENT_SCHEMA. */
function migrateCore(parsed: any): CoreSave {
  return {
    schemaVersion:  CURRENT_SCHEMA,
    playerGuid:     parsed.playerGuid ?? generateGuid(),
    playerSecret:   parsed.playerSecret,
    playerName:     parsed.playerName ?? generateDefaultPlayerName(),
    gpgsPlayerId:   parsed.gpgsPlayerId,
    verboseLogging: parsed.verboseLogging,
    soundSettings:  parsed.soundSettings ?? { ...DEFAULT_SOUND_SETTINGS },
    controlMode:    parsed.controlMode,
    joystickSide:   parsed.joystickSide,
    remoteConfig:   parsed.remoteConfig,
  };
}

function migrate(parsed: any): RawSave {
  const version = parsed?.schemaVersion ?? 1;
  // Game fields first, core last: core always wins.
  return { ...extMigrate(parsed, version), ...migrateCore(parsed) };
}

export function load(): RawSave {
  if (_cache) return _cache;
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      const migrated = migrate(parsed);
      _cache = migrated;
      if ((parsed?.schemaVersion ?? 1) !== CURRENT_SCHEMA) persist(migrated);
      return migrated;
    }
  } catch { /* fall through */ }
  const fresh = freshSave();
  _cache = fresh;
  return fresh;
}

export function persist(data: RawSave): void {
  _cache = data;
  localStorage.setItem(SAVE_KEY, JSON.stringify(data));
}

// ── Remote config cache (last-known-good; rides the cloud save) ──────────────────

export function getStoredRemoteConfig(): AppConfig | undefined { return load().remoteConfig; }

export function setStoredRemoteConfig(config: AppConfig): void {
  const data = load();
  data.remoteConfig = config;
  persist(data);
}

// ── Reset ─────────────────────────────────────────────────────────────────────

export function resetAllData(): void {
  _cache = null;
  localStorage.removeItem(SAVE_KEY);
}

// ── Player identity ───────────────────────────────────────────────────────────

export function getPlayerGuid(): string { return load().playerGuid; }
export function getPlayerName(): string { return load().playerName; }

export function setPlayerName(name: string): void {
  const trimmed = name.trim().slice(0, MAX_PLAYER_NAME_LEN);
  if (!trimmed) return;
  const data = load();
  data.playerName = trimmed;
  persist(data);
}

export function getGpgsPlayerId(): string | null { return load().gpgsPlayerId ?? null; }

/** The identity all server writes must key on: GPGS id when signed in, else the
 *  local GUID. Scores and cosmetics join on player_id server-side, so every
 *  per-player endpoint must use this — never getPlayerGuid directly. */
export function getEffectivePlayerId(): string { return getGpgsPlayerId() ?? getPlayerGuid(); }

export function setGpgsPlayerId(id: string): void {
  const data = load();
  data.gpgsPlayerId = id;
  persist(data);
}

/** TOFU write-auth token, minted on first use and never shown to the player.
 *  The server stores its hash on first sight and rejects any later mismatch. */
export function getPlayerSecret(): string {
  const s = load();
  if (!s.playerSecret) {
    s.playerSecret = generateGuid();
    persist(s);
  }
  return s.playerSecret;
}

// ── Verbose logging ───────────────────────────────────────────────────────────

export function getVerboseLogging(): boolean { return load().verboseLogging ?? false; }
export function setVerboseLogging(enabled: boolean): void {
  const data = load();
  data.verboseLogging = enabled;
  persist(data);
}

// ── Cloud save merge ──────────────────────────────────────────────────────────

/** Merge the core half. Applied LAST in {@link mergeCloudSave}, so no game rule
 *  can drop a field here. */
function mergeCore(local: RawSave, cloud: RawSave): CoreSave {
  return {
    schemaVersion: CURRENT_SCHEMA,
    playerGuid:    local.playerGuid,   // always keep local GUID
    // Write-auth secret must ride through the merge: prefer local (it matches the
    // hash the server already stored for this device); fall back to cloud so a
    // fresh install recovers the claiming identity. Dropping it here regenerates
    // the secret on next getPlayerSecret() → permanent 403 mismatch.
    playerSecret:  local.playerSecret ?? cloud.playerSecret,
    playerName:    pickPrimary(local, cloud).playerName,
    gpgsPlayerId:  local.gpgsPlayerId ?? cloud.gpgsPlayerId,
    verboseLogging: local.verboseLogging,
    // Sound prefs are per-device; keep local, fall back to cloud on fresh install.
    soundSettings: local.soundSettings ?? cloud.soundSettings,
    controlMode:   local.controlMode,   // device-local — local always wins
    joystickSide:  local.joystickSide,  // device-local — local always wins
    // Config cache: prefer local (this device just fetched it), fall back to
    // cloud so a fresh install starts warm before its own first fetch.
    remoteConfig:  local.remoteConfig ?? cloud.remoteConfig,
  };
}

/** Which save is authoritative for tie-broken fields (the player's name). The
 *  game decides by installing `primaryPicker`; with no game half the local save
 *  wins, which is the only answer that cannot lose a device-local preference. */
let _primaryPicker: ((local: RawSave, cloud: RawSave) => RawSave) | null = null;
export function setPrimaryPicker(fn: (local: RawSave, cloud: RawSave) => RawSave): void {
  _primaryPicker = fn;
}
function pickPrimary(local: RawSave, cloud: RawSave): RawSave {
  return _primaryPicker ? _primaryPicker(local, cloud) : local;
}

export function mergeCloudSave(local: RawSave, cloud: RawSave): RawSave {
  return {
    // Spread local first so any field not explicitly merged below can't silently
    // vanish (device-local prefs, plus future fields). Explicit overrides win.
    ...local,
    ...extMerge(local, cloud),
    ...mergeCore(local, cloud),
  };
}

// ── Cloud save integration helpers ────────────────────────────────────────

export function getRawSaveForCloudSync(): RawSave { return { ...load() }; }

export function applyMergedSave(merged: RawSave): void {
  persist(merged);
}

// ── Control settings (device-local) ─────────────────────────────────────────

export function getControlMode(): 'tilt' | 'joystick' {
  return load().controlMode ?? 'tilt';
}

export function setControlMode(mode: 'tilt' | 'joystick'): void {
  const data = load();
  data.controlMode = mode;
  persist(data);
}

export function getJoystickSide(): 'left' | 'right' {
  return load().joystickSide ?? 'left';
}

export function setJoystickSide(side: 'left' | 'right'): void {
  const data = load();
  data.joystickSide = side;
  persist(data);
}

// Session-only control override. Set when the device cannot deliver orientation
// data, so tilt would leave the player with no usable input. Never persisted —
// the player's saved preference is untouched and is restored the moment tilt is
// proven to work.
let _sessionControlMode: 'tilt' | 'joystick' | null = null;
// Whether the override was chosen by the game (auto) rather than the player. Only
// an auto override may be cleared by clearAutoControlOverride().
let _sessionControlModeIsAuto = false;

export function setSessionControlMode(
  mode: 'tilt' | 'joystick' | null, opts?: { auto?: boolean },
): void {
  _sessionControlMode = mode;
  _sessionControlModeIsAuto = mode !== null && opts?.auto === true;
}

/** Drop an AUTOMATIC override, restoring the saved preference. No-op once the
 *  player has made an explicit choice (Settings toggle, or the tilt prompt), so
 *  late-arriving sensor data can never undo a deliberate pick of the joystick. */
export function clearAutoControlOverride(): void {
  if (!_sessionControlModeIsAuto) return;
  _sessionControlMode = null;
  _sessionControlModeIsAuto = false;
}

/** The control mode in effect right now: the session override if set, else the
 *  saved pref. Everything that mounts/uses the live controls reads this. */
export function getEffectiveControlMode(): 'tilt' | 'joystick' {
  return _sessionControlMode ?? getControlMode();
}

// ── Sound settings ────────────────────────────────────────────────────────────

export function getSoundSettings(): SoundSettings {
  return { ...(load().soundSettings ?? DEFAULT_SOUND_SETTINGS) };
}

export function setSoundVolume(cat: keyof SoundSettings, v: number): void {
  const data = load();
  data.soundSettings = { ...(data.soundSettings ?? DEFAULT_SOUND_SETTINGS), [cat]: v };
  persist(data);
}

// ── Test helpers ──────────────────────────────────────────────────────────────

export function resetCacheForTests(): void {
  _cache = null;
  _sessionControlMode = null;
  _sessionControlModeIsAuto = false;
}

export function getSchemaVersionForTests(): number { return load().schemaVersion; }
