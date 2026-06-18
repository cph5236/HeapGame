import type { FeedbackDB, NormalizedFeedback } from '../../src/feedbackDb';
import type { FeedbackRow } from '../../../shared/feedbackTypes';

export class MockFeedbackDB implements FeedbackDB {
  private rows: FeedbackRow[] = [];
  private nextId = 1;

  async insert(f: NormalizedFeedback, now: string): Promise<void> {
    this.rows.push({
      id: this.nextId++,
      category: f.category,
      player_guid: f.playerGuid,
      session_id: f.sessionId,
      message: f.message,
      app_version: f.appVersion,
      platform: f.platform,
      heap_id: f.heapId,
      user_agent: f.userAgent,
      created_at: now,
    });
  }

  async listSince(sinceId: number | null): Promise<FeedbackRow[]> {
    const out = sinceId == null ? this.rows : this.rows.filter(r => r.id > sinceId);
    return [...out].sort((a, b) => a.id - b.id);
  }
}
