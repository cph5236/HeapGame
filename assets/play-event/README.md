# Play Console promotional content — "Grand Opening: Founder's Scrap Drop"

The launch event that advertises the `HEAPDAY` reward code. Created in Play Console
under **Grow → Promotional content**, not via GPP — none of this publishes with the
AAB or the store listing.

## Event setup

| Field | Value |
|---|---|
| Event name | `Grand Opening: Founder's Scrap Drop` |
| Type | **Special offer** (it carries a reward code; "Major update" is the launch-flavoured alternative) |
| Primary image | `grand-opening-clean.jpg` |

**Tagline** (46 / 80 — under the 48-char English threshold, so it stays eligible
for the Spotlight format):

```
300 free Scrap with code HEAPDAY, launch week.
```

**Description** (459 / 500):

```
Heap is officially open. To mark launch, every climber can claim a founder's bundle of 300 Scrap — the currency you spend on upgrades and cosmetics.

To claim: install Heap, open Settings > Player > REDEEM CODE and enter HEAPDAY. Your Scrap lands instantly.

Spend it on higher jumps, longer dashes or 50+ cosmetics, then climb the community-built trash heap and race the global leaderboard.

One redemption per player. Code expires at the end of launch week.
```

### Why the copy is shaped this way

Google's [promotional content requirements](https://support.google.com/googleplay/android-developer/answer/12929944)
drive most of it:

- **Value in the first 40 characters** — "300 free Scrap" leads.
- **No call to action or generic descriptive text** in the tagline, which is why it
  isn't "Redeem code…" or "Heap is officially open".
- **All-caps is allowed for a coupon code**, so `HEAPDAY` is fine. The Console shows
  a standing "only use capital letters if they are part of your brand name" advisory
  on the field regardless — it is not a complaint about this text.
- **Emphasise the limited-time nature** — "launch week".
- **Don't duplicate messaging between tagline and description**, so the description
  opens on the launch framing rather than restating the offer.
- **≤48 chars (English) keeps Spotlight-format eligibility** — worth protecting if
  the tagline is ever edited.

## The reward code

Mint in the admin UI before the event goes live. It is not created by this repo.

| Param | Value |
|---|---|
| `code` | `HEAPDAY` (redemption uppercases input, so player-side casing doesn't matter) |
| `rewardType` | `coins` |
| `rewardAmount` | `300` |
| `maxRedemptions` | `0` for unlimited, or a cap if the spend needs bounding |
| `expiresAt` | ISO8601 end of launch week — the description promises an expiry, so set one |

Players redeem at **Settings → Player → REDEEM CODE**. One redemption per player is
enforced server-side, so the description's claim holds without extra config.

> The currency is called **Scrap** in marketing only — the game still says "coins"
> in its UI. Tracked in `Todo/Todo.md` under Marketing.

## Images

```bash
node assets/play-event/render-event.mjs
```

| File | Use |
|---|---|
| `grand-opening-clean.jpg` | **Upload this to Play.** Smallest file, and JPEG is unambiguously accepted |
| `grand-opening-clean.png` | Same art. Verified 24-bit (colour type 2, 8-bit — no alpha channel), so it is equally valid if a PNG is preferred |
| `grand-opening-safezone.png` | Safe-zone guides overlaid. **Debug only — never upload** |
| `grand-opening-code.png` | Code stamped on the art. **itch / Discord / social only — never upload to Play** |

### Primary-image rules the clean render is built around

1920×1080, 16:9, JPG or 24-bit PNG. Safe zone is **15% top, 20% bottom, 10% each
side**; the image may be cropped to that on some form factors, so the focal point
(the player + coin burst) is centred on it at (960, 513). Verify with
`grand-opening-safezone.png` after any composition change.

The hard one: **no text of any kind** — not logos, slogans, or the event name. The
message is the tagline's job. Also no border frames and no shapes resembling
buttons or tap targets. That is why the code cannot go on the Play image, and why
`grand-opening-code.png` exists as a separate off-Play asset.

### Art notes

Everything is pulled from the real game so the event reads as the same product:

- **Junk** — the four `src/assets/composite-heap-*.png` tiles, laid as a 2×2 grid
  with alternating mirroring. A single repeating tile puts an obvious seam straight
  down the middle of a 1920-wide canvas; four distinct tiles break the repeat.
- **Silhouette** — a stepped staircase, matching the game's scanline-slab heap edge,
  with an asymmetric falloff and a secondary shoulder so it doesn't read as a
  pyramid. Same treatment as `HeapChunkRenderer`: halo, AO passes, two-tone bevel
  outline (`#241307` / `#7c4a23`), rim light on up-facing edges only.
- **Characters** — the trash-bag player, `vulture-fly-*` frames and the `rat` sheet,
  cropped to single frames via nested-SVG viewBoxes and kept `image-rendering:
  pixelated`. Rats are planted on step tops by `ratOnStep` so they never float.
- **Coins** — struck edge, milled rim and a hard specular notch. Without those they
  read as bubbles rather than currency. Some rest on the junk (`coinsOnSteps`)
  because a burst floating entirely in open sky loses its sense of weight. No
  stamped glyph: a number or letter would count as text in the image.
- **Sky** — the store-listing night→sunset gradient, so the event sits in the same
  design system as `assets/play-listing/`.

All randomness is seeded, so re-rendering is byte-stable.
