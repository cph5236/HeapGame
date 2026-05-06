// shared/scoreTypes.ts

export interface LeaderboardEntry {
  rank:     number;
  playerId: string;
  name:     string;
  score:    number;
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
