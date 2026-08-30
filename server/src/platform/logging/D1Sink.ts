import type { Sink, StampedLogEntry } from './Sink';

const INSERT_SQL = `
  INSERT INTO logs (
    user_guid, session_id, level, event_type, message,
    payload, platform, app_version, user_agent, client_ts, server_ts
  ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

export class D1Sink implements Sink {
  constructor(private db: D1Database) {}

  async write(entries: StampedLogEntry[]): Promise<void> {
    const stmts = entries.map((e) =>
      this.db.prepare(INSERT_SQL).bind(
        e.userGuid,
        e.sessionId,
        e.level,
        e.eventType ?? null,
        e.message ?? null,
        JSON.stringify(e.payload ?? {}),
        e.platform,
        e.appVersion,
        e.userAgent,
        e.timestamp,
        e.serverTimestamp,
      ),
    );
    // Run sequentially via the same prepared statement; tests assert per-bind params.
    for (const s of stmts) {
      await (s as any).run();
    }
  }
}
