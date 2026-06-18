import type { FeedbackCategory, FeedbackRow } from '../../shared/feedbackTypes';

/** Validated, normalized insert input (route does the validation). */
export interface NormalizedFeedback {
  category:   FeedbackCategory;
  playerGuid: string;
  sessionId:  string;
  message:    string;
  appVersion: string;
  platform:   string;
  heapId:     string | null;
  userAgent:  string;
}

/** Abstraction over D1 for feedback. Allows MockFeedbackDB in tests. */
export interface FeedbackDB {
  /** Insert one row. created_at is server-stamped; id is DB-assigned. */
  insert(f: NormalizedFeedback, now: string): Promise<void>;
  /** Rows with id > sinceId (or all if null), ascending by id. */
  listSince(sinceId: number | null): Promise<FeedbackRow[]>;
}

/** Production implementation backed by Cloudflare D1. */
export class D1FeedbackDB implements FeedbackDB {
  constructor(private d1: D1Database) {}

  async insert(f: NormalizedFeedback, now: string): Promise<void> {
    await this.d1
      .prepare(
        `INSERT INTO feedback
           (category, player_guid, session_id, message, app_version, platform, heap_id, user_agent, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)`,
      )
      .bind(f.category, f.playerGuid, f.sessionId, f.message, f.appVersion, f.platform, f.heapId, f.userAgent, now)
      .run();
  }

  async listSince(sinceId: number | null): Promise<FeedbackRow[]> {
    const stmt = sinceId == null
      ? this.d1.prepare('SELECT * FROM feedback ORDER BY id ASC')
      : this.d1.prepare('SELECT * FROM feedback WHERE id > ?1 ORDER BY id ASC').bind(sinceId);
    const res = await stmt.all<FeedbackRow>();
    return res.results;
  }
}
