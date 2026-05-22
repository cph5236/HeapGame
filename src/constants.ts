// ── Canvas / World ──────────────────────────────────────────────────────────────
export const GAME_WIDTH  = 480;
export const GAME_HEIGHT = 854;
export const WORLD_WIDTH = 960;           // wider than the 480px canvas
export const SKY_PAD     = 0.25;          // fraction of WORLD_WIDTH open sky beyond each edge
export const SKY_INSET   = 0.00;          // fraction of WORLD_WIDTH inward from each edge where wrap lands

export const MOCK_HEAP_HEIGHT_PX = 5_000_000;
export const MOCK_SEED           = 12;

// ── Infinite mode ──────────────────────────────────────────────────────────────
export const INFINITE_EDGE_PAD         = 100;         // open space on left/right edges before world wrap
export const INFINITE_GAP_WIDTH        = 350;         // gap between each heap column
export const INFINITE_WORLD_WIDTH      = WORLD_WIDTH * 3 + INFINITE_GAP_WIDTH * 2 + INFINITE_EDGE_PAD * 2;
export const INFINITE_LOOKAHEAD_CHUNKS = 10;          // chunks generated ahead of player
export const INFINITE_MIN_WIDTH        = 150;         // tightest squeeze (~4× player width)
export const INFINITE_MAX_WIDTH        = 900;         // widest open section
export const INFINITE_CENTER_DRIFT_MAX = 200;         // max px center shifts from column midpoint
export const INFINITE_NOISE_SCALE      = 300;         // Y pixels per noise wave (at start)
export const INFINITE_DIFFICULTY_RANGE = 4_000_000;   // Y pixels for easy→hard ramp

// ── Player ─────────────────────────────────────────────────────────────────────
export const PLAYER_WIDTH  = 40;
export const PLAYER_HEIGHT = 46;
export const PLAYER_SPEED         = 250;  // px/s ground horizontal
export const PLAYER_JUMP_VELOCITY = -550; // px/s vertical (negative = up)
export const PLAYER_DASH_VELOCITY = 500;  // px/s horizontal burst
export const PLAYER_AIR_MAX_SPEED = 500;  // px/s max horizontal speed while airborne (allows dash/swipe-jump to exceed PLAYER_SPEED)
export const PLAYER_MAX_FALL_SPEED = 800; // px/s; reached after ~1.5 s at gravity 800
export const PLAYER_DIVE_SPEED    = 1200; // px/s; instant downward velocity while diving
export const WALL_SLIDE_SPEED     = 80;   // px/s downward cap while touching a wall
export const PLAYER_INVINCIBLE_MS = 400;  // post-stomp / post-spawn invincibility
export const MAX_AIR_JUMPS        = 1;    // base value — actual value comes from SaveData/upgrades
export const DASH_COOLDOWN_MS     = 800;  // ms between dashes
export const DASH_DURATION_MS     = 200;  // ms the dash velocity is protected from movement override

export const TERRAIN_STICK_SPEED      = 100;  // px/s downward velocity applied while grounded — 300/60fps=5px/frame > 4px SCAN_STEP, bridges slab gaps in ≤1 frame
export const PLACEMENT_MOVE_SPEED     = 50;   // px/s max horizontal speed while placing an item

// ── Air momentum ───────────────────────────────────────────────────────────────
export const AIR_TILT_FORCE           = 0.8;  // px/s added per ms at full tilt — reach PLAYER_SPEED in ~250ms
export const AIR_MOMENTUM_DECAY       = 0.997; // per-ms decay factor when input is ~zero
export const MOMENTUM_STOP_ADV_FACTOR = 1.5;  // multiplier when input opposes current momentum

// ── Mobile controls ────────────────────────────────────────────────────────────
export const TILT_DEAD_ZONE_DEG        = 4;   // gamma degrees to ignore near center
export const TILT_MAX_DEG              = 25;  // gamma at which full speed is applied
export const TILT_CURVE_EXP            = 0.3; // power curve exponent for tilt factor — 1.0=linear, lower=more speed at small tilt angles
export const SWIPE_MIN_DISTANCE_PX     = 30;  // min travel to register a swipe
export const SWIPE_MAX_TIME_MS         = 750; // swipes faster than this are recognized
export const DRAG_THRESHOLD_PX         = 15;  // min vertical displacement to commit to drag mode
export const SWIPE_JUMP_HORIZONTAL_MAX = 400; // max horizontal px/s seeded by a diagonal swipe-up
export const SWIPE_JUMP_CURVE_EXP      = 0.5; // power curve exponent for swipe Vx — 1.0=linear sin, lower=more Vx at small angles

// ── Heap generation ────────────────────────────────────────────────────────────
export const NUM_HEAP_COLUMNS  = 16;    // 960 / 16 = 60px per column
export const STACK_GAP_MIN     = 2;    // px gap between stacked blocks
export const STACK_GAP_MAX     = 16;
export const GEN_LOOKAHEAD     = 1200; // px above camera top to keep generated
export const HEAP_TOP_ZONE_PX  = 300;  // px above topmost block that activates placement zone
export const CHUNK_BAND_HEIGHT = 500;  // px per visual silhouette band
export const LAYER_STEP        = 4;    // px between layer lines — matches SCAN_STEP
export const LEDGE_STEP        = 60;   // px per staircase step — controls ledge height and wall frequency
export const LEDGE_BLEND       = 0.60; // 0 = fully smooth curves, 1 = fully blocky staircases
export const HEAP_FILL_TEXTURE = 'composite-heap';

export const PLATFORM_MIN_WIDTH  = 80;
export const PLATFORM_MAX_WIDTH  = 200;
export const PLATFORM_MIN_HEIGHT = 16;
export const PLATFORM_MAX_HEIGHT = 56;

// ── Collision ──────────────────────────────────────────────────────────────────
export const FLOOR_BODY_HEIGHT          = 8;  // short in Y
export const MAX_WALKABLE_SLOPE_DEG     = 35; // surfaces steeper than this are walls
export const MOUNTAIN_CLIMBER_INCREMENT = 3;  // degrees added per upgrade level

// ── Placement ─────────────────────────────────────────────────────────────────
export const PEAK_BONUS_ZONE_PX    = 80;    // px above heap topY that qualifies for peak bonus
export const PEAK_COIN_MULTIPLIER  = 1.25;  // coin multiplier for placing at the peak
export const PLACE_HOLD_DURATION_MS = 1000; // ms player must hold to confirm placement
export const SNAP_RADIUS           = 80;    // px below pointer to search for a walkable surface

// ── Place-Ables ────────────────────────────────────────────────────────────────
export const LADDER_HEIGHT = 230;  // ~5× PLAYER_HEIGHT; designer-tunable
export const LADDER_WIDTH  = 35;
export const IBEAM_WIDTH   = 120;  // designer-tunable
export const IBEAM_HEIGHT  = 16;

// ── Parallax Background ────────────────────────────────────────────────────────
export const CLOUD_POOL_SIZE       = 14;        // max number of clouds at once
export const CLOUD_PARALLAX_FACTOR = 0.30;      // clouds move at 15% of camera speed
export const CLOUD_START_WORLD_Y   = 5_000_000; // show clouds everywhere; lower to gate by height
export const GROUND_LAYER_HEIGHT   = 180;       // total depth of dirt cross-section in px

// ── Enemies ────────────────────────────────────────────────────────────────────
export const ENEMY_CULL_DISTANCE = 2000; // px below camera before destroy
export const MAX_WALL_AUDIBLE_DISTANCE = 1200; // px gap at which wall rumble starts

// ── Score / Economy ────────────────────────────────────────────────────────────
export const SCORE_TO_COINS_DIVISOR = 100;
export { PACE_BONUS_CONST, SCORE_DISPLAY_DIVISOR } from '../shared/scoreConstants';
export const LEADERBOARD_TOP_N      = 5;  // number of top entries shown in leaderboard panel

// ── Portals ────────────────────────────────────────────────────────────────────
export const RECYCLE_ITEM_COUNT = 16;
