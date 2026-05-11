## REMOTE LOGGING

### Local dev

The `[[analytics_engine_datasets]]` binding in `server/wrangler.toml` is intentionally **commented out**. This forces `wrangler dev` to use the local D1 database as the log sink.

Start the server as normal:
```bash
cd server && npx wrangler dev
```

After playing the game, query logs:
```bash
npx wrangler d1 execute heap --local \
  --command "SELECT level, event_type, message, payload FROM logs ORDER BY id DESC LIMIT 20"
```

Analytics events only appear when **"Send anonymous gameplay analytics"** is toggled ON in Menu → Settings. Errors and warnings always ship regardless.

---

### Production (Cloudflare Analytics Engine)

In the Cloudflare dashboard: **Storage & Databases → Analytics Engine → Studio → heap_logs**

Column mapping (`AnalyticsEngineSink` write order):

| Column | Field |
|---|---|
| `index1` | `user_guid` |
| `blob1` | `level` (`event` / `warn` / `error`) |
| `blob2` | `event_type` or `message` |
| `blob3` | `platform` |
| `blob4` | `app_version` |
| `blob5` | `session_id` |
| `blob6` | `payload` (JSON string) |
| `blob7` | `user_agent` |
| `double1` | `client_ts` (ms) |

```sql
SELECT
  timestamp,
  blob1  AS level,
  blob2  AS event_type,
  blob3  AS platform,
  blob4  AS app_version,
  blob5  AS session_id,
  blob6  AS payload,
  blob7  AS user_agent,
  double1 AS client_ts,
  index1 AS user_guid
FROM heap_logs
WHERE blob1 = 'event'
ORDER BY timestamp DESC
LIMIT 50
```

Swap `WHERE blob1 = 'event'` for `'warn'` or `'error'` to filter by level.

---

## THE Brain PLUGIN
https://github.com/Advenire-Consulting/thebrain

Start a new Claude session — the tool-index, prefrontal rules, and code navigation only load on fresh session starts.

Commands you now have:

Command	When to use it
/hello	Start of a session — orients me on what you've been working on
/continue	After context compaction, or to resume a project
/wrapup	End of a session — saves context for next time
/dopamine +	Something went well — reinforce the pattern
/dopamine -	Something went wrong — flag it
/oxytocin	A collaboration dynamic worth capturing
The brain gets smarter the more you use /dopamine and /oxytocin. Start with /wrapup — that's the most important habit.

Before we wrap, want to do alias triage? The scan found some well-connected files (like GameScene.ts with 15 connections, HeapPolygon.ts with 10) that are good candidates for short conversational names. It makes navigation faster — you can say "show me the heap polygon" instead of remembering the path. Or skip it for now, you can always add aliases later.