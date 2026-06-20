## FEATURES

- Live heap section - dont just apply the updates to the live section without the player seeing them allow the player to see them in action or at least some of them. 
- Per-heap placement X bounds — currently hard-coded to `[WORLD_WIDTH * 0.125, WORLD_WIDTH * 0.875]` in the server place handler (mirrors GameScene's center-zone). Promote to a heap parameter so each heap can define its own playable column.

- Play Integrity API
Integration not started
Call the Integrity API at important moments in your app to check that it's your app binary, installed by Google Play, running on a genuine Android device. Your app's backend server can decide what to do next to prevent abuse, unauthorized access, and attacks. Show less

- The claw elevator.

- Make score-screen ad cadence (`AD_CADENCE_MIN`/`AD_CADENCE_MAX` in `src/systems/ads/AdCadence.ts`) DB-controlled (e.g. via `/heaps` config or a dedicated remote-config endpoint) instead of hardcoded constants, so it can be tuned per-build without a release.

### UI

### ENEMIES
-   Jumper cables - spawn on walls and extend in and out slightly, if player touches them, player stunned loses controls

### Stretch goals 
-finish todo_inprogress


### ORDER of importance --- V 0.2.0
Google Play closed beta
