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
  kills:        { percher: number; ghost: number };
  elapsedMs:    number;
  isFailure:    boolean;
  /** Salvage pickups carried to the top (id + rarity). Server validates + scores them. */
  salvageItems?: SalvageItem[];
}

export interface SubmitScoreRequest {
  heapId:     string;
  playerId:   string;
  playerName: string;
  inputs:     SubmitScoreInputs;
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
