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

### Deploying to production

**Step 1** — Uncomment the AE binding in `server/wrangler.toml`:
```toml
[[analytics_engine_datasets]]
binding = "LOGS"
dataset = "heap_logs"
```

**Step 2** — Apply the logs table migration (only needed once):
```bash
cd server && npx wrangler d1 migrations apply heap --remote
```

**Step 3** — Deploy:
```bash
cd server && npx wrangler deploy
```

In production, `env.LOGS` will be set and logs go to **Analytics Engine** (not D1). Query them via the CF SQL API:
```bash
curl "https://api.cloudflare.com/client/v4/accounts/<ACCOUNT_ID>/analytics_engine/sql" \
  -H "Authorization: Bearer <AUTH_TOKEN>" \
  -d "SELECT blob1 as level, blob2 as event_type, double1 as ts FROM heap_logs ORDER BY double1 DESC LIMIT 20"
```

**After testing**, re-comment the AE binding before returning to local dev — otherwise `wrangler dev` will use the AE stub and logs will silently disappear again.

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