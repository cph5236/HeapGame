## FEATURES
- Live heap section - dont just apply the updates to the live section without the player seeing them allow the player to see them in action or at least some of them. 
-   Heap selector height displayed as FT When the server gets a new placed point. Shown on the heap selector and in the admin UI. shown in the UI as calculated ft or question marks (???) if the value isnt set in the db.
- API to delete heaps / replace the heap for.
- Admin UI update to add Heap create and delete ability
- Admin add section to input heap Admin Secret 
- Per-heap placement X bounds — currently hard-coded to `[WORLD_WIDTH * 0.125, WORLD_WIDTH * 0.875]` in the server place handler (mirrors GameScene's center-zone). Promote to a heap parameter so each heap can define its own playable column.

### ENEMIES
-   Jumper cables - spawn on walls and extend in and out slightly, if player touches them, player stunned loses controls
