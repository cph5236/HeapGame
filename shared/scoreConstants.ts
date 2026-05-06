// shared/scoreConstants.ts
// Single source of truth for score-formula constants. Imported by both
// shared/buildRunScore.ts (used on client and server) and re-exported from
// src/constants.ts so existing client code keeps working.
export const PACE_BONUS_CONST       = 10; // multiplier on px/s pace component
export const SCORE_DISPLAY_DIVISOR  = 10; // px ÷ 10 = ft for HUD display
