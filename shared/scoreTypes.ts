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

export interface SubmitScoreRequest {
  heapId:     string;
  playerId:   string;
  playerName: string;
  score:      number;
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
