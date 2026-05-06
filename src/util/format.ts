import { SCORE_DISPLAY_DIVISOR } from '../../shared/scoreConstants';

/**
 * Render heap height as "<N> FT" (px / SCORE_DISPLAY_DIVISOR, floored).
 * Returns "???" when topY is missing or non-finite (legacy heaps with
 * no recorded top_y, or a server response without the field).
 */
export function heightFt(
  worldHeight: number,
  topY: number | null | undefined,
): string {
  if (topY == null || !Number.isFinite(topY)) return '???';
  const px = worldHeight - topY;
  return `${Math.floor(px / SCORE_DISPLAY_DIVISOR)} FT`;
}
