# Stretch Goals — In Progress

Rough ideas captured for future sessions. Each section is a separate feature track.

---

## R8 Obfuscation + Deobfuscation Mappings

**The Play Console warning**
- Warning: "no deobfuscation file associated with this App Bundle"
- Cause: release builds have `minifyEnabled = true` (R8 runs), but `mapping.txt` isn't being uploaded to Play Console
- `mapping.txt` is generated at `android/app/build/outputs/mapping/release/mapping.txt`
- Without it, crash reports and ANRs in Play Console show obfuscated stack traces — hard to debug

**Fix: upload mapping.txt with each release**
- Short-term: upload manually in Play Console alongside the AAB (Releases → select release → upload mapping file)
- Long-term: automate via `mobile.yml` CI workflow using the Google Play Developer API or `gradle-play-publisher` plugin

**Verify R8 rules are correct**
- `android/app/proguard-rules.pro` is currently empty/default — needs review
- Capacitor's AAR likely bundles its own consumer ProGuard rules (keeps WebView bridge intact), but this should be confirmed
- If crash reports show broken stack traces for Capacitor bridge classes, add explicit `-keep` rules for those
- Phaser/TypeScript game runs in the WebView as JavaScript — R8 does not touch it, Vite handles JS minification separately

**Tasks**
- [ ] Upload current `mapping.txt` to Play Console to clear the existing warning
- [ ] Verify ProGuard rules are sufficient for Capacitor (test a release build, check a crash trace)
- [ ] Decide: manual mapping upload per release, or automate in CI

---

## Google Play Games Services - Complete

**Identity**
- Sign in with Google Play account → persistent player ID across devices
- Replaces/augments the current UUID-based SaveData identity
- Capacitor: needs a community plugin or native Android module wrapping GPGS SDK
- `google-services.json` needed (build.gradle already has conditional hook for it)

**Cloud Saves**
- Google Play Games Snapshots API — stores JSON blobs in Google Drive
- SaveData is already a clean JSON structure — good fit
- Key challenge: conflict resolution (which device wins when same account plays offline on two devices)
- Strategy TBD: last-write-wins, highest score wins, or manual merge prompt

**Achievements**
- Define in Play Console, unlock via SDK call in client code
- Stub with 1 achievement first (e.g., "First Climb" — complete your first run)
- Add more over time: reach a height milestone, place first item, unlock all upgrades, etc.

**Leaderboards**
- Google Play has its own leaderboard UI baked into the OS
- Hybrid approach: server validates score (already does this), then Android client submits to Google Play using player's auth token
- Our own `/scores` leaderboard stays for web/anonymous players — the two coexist
- Server-side submission via Management API is possible but complex (service account + OAuth2 on Worker) — probably not worth it

---

## YouTube Playables / Arcade Game Websites

**YouTube Playables**
- YouTube's HTML5 game embed feature (relatively new, 2023–2024) — not fully open access, must apply to the program first
- Requirements: self-contained build, file size limits, content policies — keyboard/mouse controls already covered
- External API calls (Cloudflare Worker) appear to be allowed — live heaps should work as-is
- SDK docs: https://developers.google.com/youtube/gaming/playables/reference/sdk
- Full docs to be reviewed when planning begins
- Next step: apply to YouTube Playables developer program

**Arcade / HTML5 game sites**
- itch.io — upload web build, done. Great for discoverability and dev community
- GameDistribution — ad-revenue sharing, large network of casual game sites
- CrazyGames, Poki, Newgrounds — similar distribution but selective/curated
- Web build already deploys to GitHub Pages via CI — just needs packaging review for each platform
- External API calls to Cloudflare Worker should be fine for these platforms

---

## SEO & Discoverability

**Web SEO (GitHub Pages / self-hosted)**
- Canvas games have no crawlable content — search engines see an empty page
- Fix with a proper landing page: hero image, description, screenshots, call-to-action (Play Now)
- Meta tags to add: `<title>`, `<meta description>`, Open Graph (`og:title`, `og:image`, `og:description`), Twitter Card
- Structured data: JSON-LD `VideoGame` schema — Google can show rich results for games
- Add `sitemap.xml` and `robots.txt` — currently neither exists
- Social share image (OG image) matters most for discoverability via links/shares

**Play Store ASO (App Store Optimization)**
- Play Store has its own search algorithm — separate from Google web search
- Key levers: app title, short description, long description (keyword-rich), screenshots, feature graphic
- Category selection and ratings also affect ranking
- Things to explore: what keywords players search for (vertical platformer, climbing game, community game, etc.)
- Review cadence matters — prompt players to rate after a good run

**Arcade / game site listings**
- Each platform (itch.io, GameDistribution, CrazyGames) has its own metadata: title, tags, thumbnail, description
- Thumbnail/icon quality drives click-through rate significantly on these platforms
- itch.io: tags like `platformer`, `html5`, `casual` affect discovery within the site
- GameDistribution / CrazyGames: discovery is largely platform-curated, less keyword-driven

**Things to explore**
- [ ] What does the current `index.html` look like to a crawler? (check with an SEO audit tool)
- [ ] Design a landing page or at least a pre-game splash that gives crawlers something to index
- [ ] Research Play Store keywords for this game category
- [ ] Create a proper OG/social share image for the game

---

## Ad Integration - Complete

**Shipped (feature/ad-integration, PR #33)**
- `AdProvider` interface + `NullProvider` (web/dev) and `AdMobProvider` (Android, `@capacitor-community/admob`)
- Build-time provider selection: `build:android` sets `VITE_AD_PROVIDER=admob`; web/dev defaults to NullProvider; unused provider is tree-shaken
- Interstitial on leaving ScoreScene; opt-in rewarded "2× coins" button doubles the run's coins
- AdMob test ad-unit IDs default via `.env`; CI overrides with real unit IDs from secrets
- Note: `tagForChildDirectedTreatment` ships as `false` (the spec note below predates the AdMob policy finding that `true` blocks rewarded ads)

**Architecture — Ad Provider Pattern**
- Define a single `AdProvider` interface in the game (`showInterstitial()`, `showRewarded()`)
- Each platform gets its own implementation; game only calls the interface, never an SDK directly
- Vite `define` + env vars swap the active provider at build time — unused SDK code is tree-shaken out
- Adding a new platform = one new provider class + one build script, no game logic changes

| Build | Provider | Target |
|---|---|---|
| `npm run build` | `NullProvider` | itch.io |
| `npm run build:android` | `AdMobProvider` | Play Store (Capacitor) |
| `npm run build:gamedistribution` | `GameDistributionProvider` | GD network |
| `npm run build:crazygames` | `CrazyGamesProvider` | CrazyGames / Poki |
| `npm run build:youtube` | `YouTubePlayablesProvider` | YouTube Playables |

**Platform notes**
- **Android (AdMob):** `@capacitor-community/admob` plugin; needs `google-services.json` (same file as Play Games — one setup unblocks both)
- **GameDistribution / CrazyGames / Poki:** Platform-managed ads, revenue share — they provide the SDK
- **YouTube Playables:** Has its own SDK (see SDK docs link in YouTube section above)
- **itch.io:** No in-game ads; monetize via pay-what-you-want or premium pricing

**Ad placement UX**
- Show interstitials between runs only — never mid-run
- Frequency cap: every 3 runs or so (AdMob supports this natively in the console, no code needed)
- Rewarded video (e.g. double coins) is opt-in — most game-friendly format
- Banner ads: skip entirely, poor fit for a fullscreen game

**Families Policy / child-directed treatment (AdMob)**
- App targets a general audience that includes children — Google Play Families Policy applies
- When initializing AdMob, set `tagForChildDirectedTreatment(true)` on the `RequestConfiguration` before loading any ads
- This flags all ad requests as COPPA-compliant, restricting targeting to child-appropriate ads regardless of who is playing
- AdMob is a Google Play certified ad network so it satisfies the Families Policy requirement on its own
- For GameDistribution / CrazyGames: check their child-directed / COPPA flag equivalents when integrating their SDKs — each has one
