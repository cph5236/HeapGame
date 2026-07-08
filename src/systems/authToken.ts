// Client side of player write-auth: attach the private secret to server
// writes and surface rejections in remote telemetry.
// See docs/superpowers/specs/2026-07-07-player-write-auth-design.md

import { getPlayerSecret } from './SaveData';
import { getLogger } from '../logging';

export const PLAYER_TOKEN_HEADER = 'X-Player-Token';

/** Header object to spread into fetch init headers on write requests. */
export function authHeaders(): Record<string, string> {
  return { [PLAYER_TOKEN_HEADER]: getPlayerSecret() };
}

/** Error-level remote log on 403 so lockouts show up in heap_logs triage. */
export function logIfAuthRejected(route: string, status: number): void {
  if (status === 403) {
    getLogger().error('auth:rejected', { route, status });
  }
}
