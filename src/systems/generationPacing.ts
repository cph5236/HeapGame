import { GENERATION_BAKE_SAFETY_PX } from '../constants';

export interface BakeGateInputs {
  /** Is the player currently on the ground (or a ladder)? */
  onGround: boolean;
  /** Are there worker results waiting to be applied/baked? */
  hasPending: boolean;
  /** Player world Y (grows downward; smaller = higher up the climb). */
  playerY: number;
  /**
   * Highest baked band top for the column (smallest world Y). +Infinity when
   * nothing is baked yet. The baked runway above the player is
   * (playerY - bakedTopY).
   */
  bakedTopY: number;
}

/**
 * Decide whether Infinite mode should apply/bake pending worker results this
 * frame. The bake is synchronous (canvas draw + collider build) and hitches, so
 * we defer it off jumps/fast movement: bake when grounded, otherwise only when
 * the baked ceiling is within GENERATION_BAKE_SAFETY_PX of the player (a safety
 * valve so a long airborne stretch can never let the player reach un-baked
 * heap). See generationPacing.test.ts for the world-Y orientation.
 */
export function shouldBakeBands({ onGround, hasPending, playerY, bakedTopY }: BakeGateInputs): boolean {
  if (!hasPending) return false;
  if (onGround) return true;
  return playerY - bakedTopY < GENERATION_BAKE_SAFETY_PX;
}
