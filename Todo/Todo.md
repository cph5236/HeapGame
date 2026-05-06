## FEATURES
- Live heap section - dont just apply the updates to the live section without the player seeing them allow the player to see them in action or at least some of them. 
-   Heap selector height displayed as FT When the server gets a new placed point. Shown on the heap selector and in the admin UI. shown in the UI as calculated ft using top_y from db.
- API to delete heaps / replace the heap for.
- Admin UI update to add Heap create and delete ability
- Admin add section to input heap Admin Secret 
- Admin UI should be able to edit all heap values 
- Per-heap placement X bounds — currently hard-coded to `[WORLD_WIDTH * 0.125, WORLD_WIDTH * 0.875]` in the server place handler (mirrors GameScene's center-zone). Promote to a heap parameter so each heap can define its own playable column.

- 

### ENEMIES
-   Jumper cables - spawn on walls and extend in and out slightly, if player touches them, player stunned loses controls

### Stretch goals 
- Google play integration with Game profiles? 
- Ad integration
- SEO optimization
- Youtube playables or other arcade game websites
