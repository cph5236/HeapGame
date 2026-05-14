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

### ENEMIES
-   Jumper cables - spawn on walls and extend in and out slightly, if player touches them, player stunned loses controls

### Stretch goals 
-finish todo_inprogress

- Ensure compliance with Family's policy https://support.google.com/googleplay/android-developer/answer/9893335 
 Making sure that any content in your app that could be seen by children is appropriate for them
Only displaying ads that are appropriate for children, whenever your app is being used by a child
Only displaying ads that are from Google Play certified ad networks , or ads served by you, whenever your app is being used by a child. This includes ads for your own apps, or from partnerships with other brands
Making sure your app (including all APIs, SDKs, and ads) complies with all applicable laws and regulations relating to children, such as the US Children's Online Privacy Protection Act COPPA, and the EU General Data Protection Regulation GDPR