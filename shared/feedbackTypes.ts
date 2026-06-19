export type FeedbackCategory = 'bug' | 'suggestion';

/** Client → server POST body for /feedback. */
export interface FeedbackSubmitRequest {
  category:   FeedbackCategory;
  message:    string;       // trimmed, ≤ 3000 chars
  playerGuid: string;
  sessionId:  string;
  appVersion: string;
  platform:   string;
  userAgent:  string;
  heapId:     string | null;
}

/** Full DB row, as returned by GET /feedback. */
export interface FeedbackRow {
  id:          number;
  category:    FeedbackCategory;
  player_guid: string;
  session_id:  string;
  message:     string;
  app_version: string;
  platform:    string;
  heap_id:     string | null;
  user_agent:  string;
  created_at:  string;      // ISO8601
}
