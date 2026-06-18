# Stretch Goals — In Progress

Rough ideas captured for future sessions. Each section is a separate feature track.


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