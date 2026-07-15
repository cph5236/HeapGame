# Play Store listing assets

Google Play Store store-listing graphics + the ASO copy for Heap.
All images are rendered to Google's **exact** required pixel dimensions.

## Assets

| File | Size | Slot | Headline |
|---|---|---|---|
| `00-feature.png` | 1024×500 | Feature graphic | HEAP wordmark + tagline + junk-tower art |
| `01-climb-A.png` | 1080×1920 | Hero option A (170ft, beside the heap) | CLIMB THE HEAP |
| `01-climb-B.png` | 1080×1920 | Hero option B (437ft, open sky) | CLIMB THE HEAP |
| `02-place.png` | 1080×1920 | Screenshot | BUILD THE HEAP |
| `03-salvage.png` | 1080×1920 | Screenshot | GRAB SALVAGE |
| `04-leaderboard.png` | 1080×1920 | Screenshot | TOP THE LEADERBOARD |
| `05-custom.png` | 1080×1920 | Screenshot | DRESS THE BAG |
| `06-enemy.png` | 1080×1920 | Screenshot | DODGE THE PESTS |
| `07-upgrades.png` | 1080×1920 | Screenshot | UPGRADE & CLIMB |

**Pick ONE of the two `01-climb-*` heroes** for slot 1; the final phone set is 7
screenshots. They're 9:16 and ≥1080px, satisfying Play's promo-eligibility rule
(≥4 screenshots, ≥3 at 1080px+). Same files reusable for the 7"/10" tablet slots.

> Note: the live-play captures (`raw/*.webp`) are 400px-wide downscaled copies, so
> they're slightly soft when scaled into the frame. Replace with full-resolution
> device screenshots (~1080px+) and re-render for crisp final art.

## Design system

- **Sky gradient** night-navy `#0b0b1e` → sunset `#e8622a` (pulled from the in-game sky).
- **Headlines** in **Anton**, using the game's orange `#ff9922` + dark-outline logo
  treatment — keeps the marketing cohesive with the app icon / in-game wordmark.
- **Monospace kickers** echo the in-game HUD (`ft`, `coins`).
- **Signature:** an **altitude rail** down the left edge with a "you are here" `ft`
  marker, derived from the height mechanic. It unifies the set as one climb; on
  `02-leaderboard` the marker is tied to the on-screen `9,819` score.

## Regenerating / editing

Raw game captures live in `raw/` (from `npm run scene-preview`). Fonts in `fonts/`.

```bash
node play-listing/render.mjs   # re-renders all assets into this folder
```

Edit captions/headlines in the `jobs` array at the bottom of `render.mjs`.
To add a screenshot: drop a capture in `raw/`, add a `jobs` entry.

## ASO text copy

**App title** (30 max) — recommend extending from bare "Heap":
> `Heap: Climbing Platformer`

**Short description** (80 max):
> Climb a community-built trash heap in this arcade platformer. Race for high scores!

**Full description** — see the game's store listing; keyword targets woven in
naturally: *climbing game, platformer, arcade, leaderboard, community-built*.
(Avoid "roguelike" in title/short — the game is arcade + run-based upgrades;
"roguelite-style progression" in the body is the accurate, policy-safe framing.)
