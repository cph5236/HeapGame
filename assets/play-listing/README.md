# Play Store listing assets

Google Play Store store-listing graphics + the ASO copy for Heap.
All images are rendered to Google's **exact** required pixel dimensions.

## Assets

| File | Size | Slot | Headline |
|---|---|---|---|
| `00-feature.png` | 1024×500 | Feature graphic | HEAP wordmark + tagline + junk-tower art |
| `01-climb.png` | 1080×1920 | Screenshot 1 (hero) | CLIMB THE HEAP |
| `02-place.png` | 1080×1920 | Screenshot 2 | BUILD THE HEAP |
| `03-salvage.png` | 1080×1920 | Screenshot 3 | GRAB SALVAGE |
| `04-leaderboard.png` | 1080×1920 | Screenshot 4 | TOP THE LEADERBOARD |
| `05-custom.png` | 1080×1920 | Screenshot 5 | DRESS THE BAG |
| `06-enemy.png` | 1080×1920 | Screenshot 6 | DODGE THE PESTS |
| `07-upgrades.png` | 1080×1920 | Screenshot 7 | UPGRADE & CLIMB |

The 7 phone screenshots are 9:16 and ≥1080px, satisfying Play's promo-eligibility
rule (≥4 screenshots, ≥3 at 1080px+). Same files reusable for the 7"/10" tablet
slots. (`raw/climb2` is kept as a spare open-sky hero alternative.)

> Note: the live-play captures are 400px-wide downscaled copies (`raw/*.webp`
> originals, converted to the `raw/*.png` the renderer actually reads), so they're
> slightly soft when scaled into the frame. Replace with full-resolution device
> screenshots (~1080px+) and re-render for crisp final art.

## Design system

- **Sky gradient** night-navy `#0b0b1e` → sunset `#e8622a` (pulled from the in-game sky).
- **Headlines** in **Anton**, using the game's orange `#ff9922` + dark-outline logo
  treatment — keeps the marketing cohesive with the app icon / in-game wordmark.
- **Monospace kickers** echo the in-game HUD (`ft`, `coins`).
- **Signature:** an **altitude rail** down the left edge with a "you are here" `ft`
  marker, derived from the height mechanic. It unifies the set as one climb; on
  `04-leaderboard` the marker is tied to the on-screen `9,819` score.

## Regenerating / editing

Raw game captures live in `raw/` (from `npm run scene-preview`). Fonts in `fonts/`.

```bash
node assets/play-listing/render.mjs   # re-renders all assets into this folder
```

Edit captions/headlines in the `jobs` array at the bottom of `render.mjs`.
To add a screenshot: drop a capture in `raw/`, add a `jobs` entry.

## Publishing to Google Play

The live listing is sourced from `android/app/src/main/play/` (text in
`listings/en-US/*.txt`, graphics in `listings/en-US/graphics/**`). The final
assets from this folder are copied there with GPP's numeric names
(`feature-graphic/1.png`, `phone-screenshots/1..7.png`, both tablet folders).

Publish via the **manual** `Publish Play Listing` GitHub Action
(`.github/workflows/publish-listing.yml`, `workflow_dispatch`). It runs
`./gradlew publishReleaseListing`, which **overwrites** the live listing with the
repo contents — so run it deliberately. The regular release (`publishReleaseBundle`)
still only ships the AAB; it does not touch the listing.

> If the job 403s, grant the Play service account the **Store presence / graphic
> assets** permission in Play Console → Users & permissions.

## ASO text copy

**App title** (30 max) — recommend extending from bare "Heap":
> `Heap: Climbing Platformer`

**Short description** (80 max):
> Climb a community trash heap in this arcade platformer. Race for high scores!

**Full description** — see the game's store listing; keyword targets woven in
naturally: *climbing game, platformer, arcade, leaderboard, community-built*.
(Avoid "roguelike" in title/short — the game is arcade + run-based upgrades;
"roguelite-style progression" in the body is the accurate, policy-safe framing.)
