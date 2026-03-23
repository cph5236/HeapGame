export const GAME_WIDTH = 480;
export const GAME_HEIGHT = 854;
export const WORLD_WIDTH = 960;           // wider than the 480px canvas

export const PLAYER_WIDTH = 32;
export const PLAYER_HEIGHT = 48;
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
export const MOCK_SEED = 42;

// How many pixels above the heap's topmost block that activates the placement zone
export const HEAP_TOP_ZONE_PX = 300;

// Air jumps available before landing; base value — actual value comes from SaveData/upgrades
export const MAX_AIR_JUMPS = 1;

// Score-to-coins conversion and upgrade tuning
export const SCORE_TO_COINS_DIVISOR = 100;
export const PLAYER_DASH_VELOCITY   = 500; // px/sec horizontal burst
export const DASH_COOLDOWN_MS       = 800; // ms between dashes
export const DASH_DURATION_MS       = 200; // ms the dash velocity is protected from movement override
export const PLAYER_MAX_FALL_SPEED  = 1200; // px/s; reached after ~1.5 s at gravity 800
export const WALL_SLIDE_SPEED       = 80;  // px/s downward cap while touching a wall
