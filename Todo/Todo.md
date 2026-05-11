## FEATURES
- Live heap section - dont just apply the updates to the live section without the player seeing them allow the player to see them in action or at least some of them. 
- Per-heap placement X bounds — currently hard-coded to `[WORLD_WIDTH * 0.125, WORLD_WIDTH * 0.875]` in the server place handler (mirrors GameScene's center-zone). Promote to a heap parameter so each heap can define its own playable column.

- Play Integrity API
Integration not started
Call the Integrity API at important moments in your app to check that it's your app binary, installed by Google Play, running on a genuine Android device. Your app's backend server can decide what to do next to prevent abuse, unauthorized access, and attacks. Show less

- Place random extra point when player adds to heap.
- The claw elevator.
- Extra sky space wider world space.

### ENEMIES
-   Jumper cables - spawn on walls and extend in and out slightly, if player touches them, player stunned loses controls

### Stretch goals 
- Google play integration with Game profiles? 
- google Ad integration
- SEO optimization
- Youtube playables or other arcade game websites
- fix play Console Warning - There is no deobfuscation file associated with this App Bundle. If you use obfuscated code (R8/proguard), uploading a deobfuscation file will make crashes and ANRs easier to analyze and debug. Using R8/proguard can help reduce app size. Learn More
