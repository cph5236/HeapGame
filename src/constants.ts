export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 854;
export const WORLD_WIDTH = 960;           // wider than the 480px canvas

export const PLAYER_WIDTH = 40;
export const PLAYER_HEIGHT = 46;
export const PLAYER_SPEED = 200;          // px/sec horizontal
export const PLAYER_JUMP_VELOCITY = -550; // px/sec vertical (negative = up)

export const PLATFORM_MIN_WIDTH = 80;
export const PLATFORM_MAX_WIDTH = 200;
export const PLATFORM_MIN_HEIGHT = 16;
export const PLATFORM_MAX_HEIGHT = 56;

// Column-based heap generation
export const NUM_HEAP_COLUMNS = 16;       // 960 / 16 = 60px per column
export const STACK_GAP_MIN = 2;           // px gap between stacked blocks
export const STACK_GAP_MAX = 16;

// How many pixels above the camera top edge to keep generated
export const GEN_LOOKAHEAD = 1200;

// Mock global heap state — replace with backend later
export const MOCK_HEAP_HEIGHT_PX = 50_000;
export const MOCK_SEED = 12;

// How many pixels above the heap's topmost block that activates the placement zone
export const HEAP_TOP_ZONE_PX = 300;

// Air jumps available before landing; base value — actual value comes from SaveData/upgrades
export const MAX_AIR_JUMPS = 1;

// Score-to-coins conversion and upgrade tuning
export const SCORE_TO_COINS_DIVISOR = 100;
export const PLAYER_DASH_VELOCITY   = 500; // px/sec horizontal burst
export const DASH_COOLDOWN_MS       = 800; // ms between dashes
export const DASH_DURATION_MS       = 200; // ms the dash velocity is protected from movement override
export const PLAYER_MAX_FALL_SPEED  = 800; // px/s; reached after ~1.5 s at gravity 800
export const PLAYER_DIVE_SPEED      = 1200; // px/s; instant downward velocity while diving
export const WALL_SLIDE_SPEED       = 80;  // px/s downward cap while touching a wall

// Placement rules
export const PEAK_BONUS_ZONE_PX   = 80;   // px above heap topY that qualifies for peak bonus
export const PEAK_COIN_MULTIPLIER = 1.25; // coin multiplier for placing at the peak
export const PLACE_HOLD_DURATION_MS = 1000; // ms player must hold to confirm placement

// Mobile controls tuning
export const TILT_DEAD_ZONE_DEG    = 5;   // gamma degrees to ignore near center
export const TILT_MAX_DEG          = 25;  // gamma at which full speed is applied
export const SWIPE_MIN_DISTANCE_PX = 60;  // min horizontal travel to register a dash swipe
export const SWIPE_MAX_TIME_MS     = 350; // swipes faster than this trigger a dash
export const SWIPE_DIRECTION_RATIO = 2.0; // |dx|/|dy| must exceed this to be a horizontal swipe

// Heap visual chunking
export const CHUNK_BAND_HEIGHT = 500; // px per visual silhouette band
export const HEAP_FILL_TEXTURE = 'composite-heap';

// ── Parallax Background ───────────────────────────────────────────────────────
export const CLOUD_POOL_SIZE        = 14;     // max number of clouds at once; set based on density and screen height
export const CLOUD_PARALLAX_FACTOR  = 0.15;   // clouds move at 30% of camera speed
export const CLOUD_START_WORLD_Y    = 50_000; // show clouds everywhere; lower (e.g. 40_000) to gate by height
export const GROUND_LAYER_HEIGHT    = 180;    // total depth of dirt cross-section in px

// Enemies
export const ENEMY_CULL_DISTANCE        = 2000; // px below camera before destroy
export const PLAYER_INVINCIBLE_MS       = 400;  // post-stomp / post-spawn invincibility

// Heap edge collider slabs
export const FLOOR_BODY_HEIGHT = 8;   // short in Y
export const MAX_WALKABLE_SLOPE_DEG  = 35;  // surfaces steeper than this are treated as walls
export const MOUNTAIN_CLIMBER_INCREMENT = 3; // degrees added per upgrade level — set by designer

// Place-Ables
export const LADDER_HEIGHT  = 230;  // ~5× PLAYER_HEIGHT; designer-tunable
export const LADDER_WIDTH   = 20;
export const IBEAM_WIDTH    = 120;  // designer-tunable
export const IBEAM_HEIGHT   = 12;
export const SNAP_RADIUS    = 80;   // px below pointer to search for a walkable surface
