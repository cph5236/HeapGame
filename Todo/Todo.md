## FEATURES
- Live heap section - dont just apply the updates to the live section without the player seeing them allow the player to see them in action or at least some of them. 
- Per-heap placement X bounds — currently hard-coded to `[WORLD_WIDTH * 0.125, WORLD_WIDTH * 0.875]` in the server place handler (mirrors GameScene's center-zone). Promote to a heap parameter so each heap can define its own playable column.

- Play Integrity API
Integration not started
Call the Integrity API at important moments in your app to check that it's your app binary, installed by Google Play, running on a genuine Android device. Your app's backend server can decide what to do next to prevent abuse, unauthorized access, and attacks. Show less

- Place random extra point when player adds to heap.
- The claw elevator.
- Extra sky space wider world space.
- allow player to place specific objects on heap 
- make cloudflare analytics engine delete data over 90 days
- simple sound effects
### ENEMIES
-   Jumper cables - spawn on walls and extend in and out slightly, if player touches them, player stunned loses controls

### Stretch goals 
-finish todo_inprogress


### ORDER of importance --- V 0.2.0
Place extra point when player adds to heap — gameplay reward
Per-heap placement X bounds — promote to heap parameter
Sound effects
Google Play closed beta
itch.io upload
Ad integration

### CI / DevOps
- Upgrade GitHub Actions to Node.js 24-native versions (forced migration June 2, 2026)
  - actions/checkout@v4 → latest v4 or v5 with Node.js 24 support
  - actions/setup-node@v4 → latest with Node.js 24 support
  - actions/setup-java@v4 → latest with Node.js 24 support
  - FORCE_JAVASCRIPT_ACTIONS_TO_NODE24=true already added as stopgap
