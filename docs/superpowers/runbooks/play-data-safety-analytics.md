# Runbook — Play Console Data Safety form for default-on analytics

The `feature/analytics-instrumentation` branch flips gameplay analytics from
opt-in (default off) to opt-out (default on). This changes what the Play
Console **Data safety** form must declare. The form must be updated **in the
same release** that ships the behavior change — not after. Do not merge/release
this branch without doing this.

## Why this matters

Play review checks the Data Safety form against actual app behavior and
against your linked privacy policy. A default-off toggle that becomes
default-on without the form changing is exactly the kind of mismatch that gets
an app flagged or suspended. See `PRIVACY_POLICY.md` (§ "Data collected
automatically", § "Changing or withdrawing your consent") for the copy the
form's answers must agree with — read that file before filling in the form,
and re-check it any time either one changes.

## What changed in the app

- Gameplay analytics (`run:start`, `run:end`, `heap:selected`,
  `placement:made`, `score:submitted`, `share:run`, `upgrade:purchased` — the
  `GameEvent` union in `shared/logging/events.ts`) is now sent **by default**.
  Previously it required the player to opt in via Settings.
- The Settings toggle ("Send anonymous gameplay analytics") still exists and
  still works — it is now an opt-**out**, not an opt-in.
- Every event (analytics and diagnostic) carries the envelope from
  `src/logging/index.ts`: a stable per-device player id, a per-session id, app
  version, platform, and user agent.
- Error/crash reports are unaffected by this change — they were already sent
  unconditionally and still are.

## What to change in the Data Safety form

Go to Play Console → your app → **App content → Data safety**, and update:

1. **Data collection status.** Any data type covered by gameplay analytics
   (App activity / App interactions, and any "in-app actions" or "other user
   generated content" categories you've mapped run/placement/purchase events
   to) must show as **collected**, not "collected only if user opts in." The
   opt-out toggle does not change this — Play's opt-in/opt-out distinction is
   about default state, and the default is now on.
2. **Purpose.** Confirm the declared purpose (analytics / app functionality)
   still matches — it should, this is the same category of data as before,
   just collected by default instead of on request.
3. **"Is this data collection optional?"** Leave this marked **optional** —
   the in-app toggle still lets a player turn it off. What changes is the
   *default*, not whether a control exists. Play's form has no separate field
   for "default state," so this is communicated by the collection status in
   item 1 plus the privacy policy text, not by a form checkbox — see item 4.
4. **Privacy policy link.** No URL change, but the linked page
   (`PRIVACY_POLICY.md`, published wherever it's hosted for the store listing)
   must already describe default-on collection with the Settings opt-out
   before you submit the form. If the hosted copy of the policy lags this
   branch, update it first — the form and the live policy page must agree on
   the day the form is submitted, not just in this repo.

## Do not

- Do not describe the player id as anonymous on the form. It's a stable,
  pseudonymous identifier — same language constraint as the privacy policy.
  Play's own data type taxonomy has a "User IDs" category for exactly this;
  don't downgrade it to a "no PII" framing.
- Do not leave the form saying "collected only if user opts in" after this
  ships — that describes the old behavior and will contradict the app's
  actual behavior on first launch.

## Order of operations for the release

1. Confirm `PRIVACY_POLICY.md` is up to date on this branch (it is, as of the
   commit that added this runbook) and that the hosted copy players actually
   see gets updated in the same deploy.
2. Update the Data Safety form per the steps above.
3. Submit the form. Play may take a review cycle to reflect changes publicly —
   start this before or alongside the release build, not after it's live.
4. Ship the release (see `releasing-heap` skill). Don't let the app update go
   live on Play with the form still describing opt-in-only collection.

## Verifying agreement between the two surfaces

Before submitting the form, read `PRIVACY_POLICY.md` § "Data collected
automatically" and check each claim against:
- `shared/logging/events.ts` — the actual `GameEvent` union sent
- `src/logging/index.ts` — the actual envelope fields attached
- `src/scenes/SettingsScene.ts` (the analytics toggle block) — the actual
  in-game control name and location, and the "errors are always reported"
  claim

If any of those files changes on a future branch, this runbook and
`PRIVACY_POLICY.md` both need a look before the next release — not just the
form.
