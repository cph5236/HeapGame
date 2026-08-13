// shared/scoreTypes.ts

import type { SalvageItem } from './pickupScores';
import type { EquippedLoadout } from './cosmeticCatalog';

export interface LeaderboardEntry {
  rank:     number;
  playerId: string;
  name:     string;
  score:    number;
  /** Equipped cosmetic loadout for avatar display; null when none/invalid. */
  loadout?: EquippedLoadout | null;
}

export interface LeaderboardContext {
  top:    LeaderboardEntry[];
  player: LeaderboardEntry | null;
}

export interface SubmitScoreInputs {
  baseHeightPx: number;
  kills:        { percher: number; ghost: number; jumper?: number };
  elapsedMs:    number;
  isFailure:    boolean;
  /** Salvage pickups carried to the top (id + rarity). Server validates + scores them. */
  salvageItems?: SalvageItem[];
}

export interface SubmitScoreRequest {
  heapId:      string;
  playerId:    string;
  /** Optional — only used to seed a first-seen player's name; never updates an existing one. */
  playerName?: string;
  inputs:      SubmitScoreInputs;
  /** Run-session token from POST /scores/session. Required once SESSION_SECRET is set. */
  sessionToken?: string;
}

export interface OpenSessionRequest {
  playerId: string;
  heapId:   string;
}

export interface OpenSessionResponse {
  /** Opaque HMAC token. Echo back verbatim on score submit. */
  token:    string;
  issuedAt: number;
}

export interface SubmitScoreResponse {
  submitted: boolean;
  context:   LeaderboardContext;
}

export interface PaginatedLeaderboardResponse {
  entries: LeaderboardEntry[];
  total:   number;
  page:    number;
}

export interface PlayerScoreEntry {
  heapId: string;
  rank:   number;
  score:  number;
  name:   string;
}

export interface PlayerScoresResponse {
  entries: PlayerScoreEntry[];
}
