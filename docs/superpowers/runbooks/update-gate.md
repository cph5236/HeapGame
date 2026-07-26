# Runbook — Minimum-version update gate (`min_version`)

Blocks clients older than a published floor at boot. **This locks players out of
the game**, so it is reserved for the two cases that actually justify it:

- a **breaking API change** older clients can no longer talk to, or
- a **severe client bug** that makes the old build harmful to keep playing.

Routine "a newer build exists" nudging is *not* this — that belongs to Play's
in-app update flow, which knows the published versionCode without being told.

## How it behaves

`GET /config` carries a `min_version` key. `LoadingScene` compares this build's
`VITE_APP_VERSION` (from `package.json`) against it and, if lower, opens
`UpdateRequiredScene` instead of the menu — a terminal screen with no way back.

Two safety properties, both deliberate (`src/systems/UpdateGate.ts`):

- **It only fires on config fetched this launch.** A stale last-known-good value
  never blocks. An offline player can't reach the store to update anyway, and
  acting on cached config would keep them locked out after the gate was lifted.
- **It fails open on every uncertainty** — key absent, value malformed, version
  unparseable, fetch failed. The gate blocks only when it is certain.

When last-known-good already indicates a gate, the loader waits for the fetch to
confirm (bounded by `CONFIG_FETCH_TIMEOUT_MS`) rather than blocking on the stale
value or skipping the check.

## Set the gate

`PUT /config/min_version`, admin-gated via the `x-admin-secret` header.

```bash
curl -X PUT "$HEAP_SERVER_URL/config/min_version" \
  -H "x-admin-secret: $ADMIN_SECRET" \
  -H 'Content-Type: application/json' \
  -d '{"value":{"version":"0.2.21","message":"Score submission is broken on this version. Update to keep your runs counted."}}'
```

- `version` — **exact** `major.minor.patch`. Partials (`0.2`), prefixes
  (`v0.2.21`), and ranges (`>=0.2.21`) are rejected with 400.
- `message` — optional, ≤200 chars, shown on the gate screen. Say *why*, so the
  screen doesn't read as an arbitrary wall. Omit it for a generic message.

The floor is **inclusive**: `0.2.21` allows 0.2.21 and blocks 0.2.20.

## Lift the gate

```bash
curl -X DELETE "$HEAP_SERVER_URL/config/min_version" -H "x-admin-secret: $ADMIN_SECRET"
```

Deleting is idempotent. Players are ungated on their next launch, once their
client refetches config.

## Before you set it

1. **The replacement build must already be live on Play.** Gating on a version
   nobody can install yet strands every player with no way out. Confirm the
   rollout has actually reached users — a staged rollout at 10% means 90% of
   players will hit a wall they cannot clear.
2. **Check the number you're publishing** against `package.json` / the gradle
   `versionName`. A floor one release too high locks out everyone, including
   players who just updated. The write-time validator catches malformed values,
   not wrong ones.
3. Remember web builds (itch.io / Pages) share this config. They always serve
   the newest bundle, so the gate should be a no-op there; its button offers a
   reload rather than a store link.

## Verify

```bash
curl -s "$HEAP_SERVER_URL/config" | jq .config.min_version
```

To see the screen itself without publishing anything (dev server on :3000):

```bash
npm run scene-preview -- UpdateRequiredScene \
  '{"gate":{"version":"0.2.21","message":"Score submission is broken."}}' pixel7
```

The `gate` preview param is dev-only — it is ignored in production builds, where
the scene reads remote config.
