import { SCORE_DISPLAY_DIVISOR } from '../../shared/scoreConstants';

/**
 * Render heap height as a compact "<N> FT" label for UI rows.
 *
 * - `< 10_000 FT`         → exact, e.g. `"529 FT"`, `"5000 FT"`
 * - `>= 10_000 FT`        → rounded thousands, e.g. `"467K FT"`
 * - `>= 1_000_000 FT`     → rounded millions w/ one decimal, e.g. `"1.5M FT"`
 * - `isInfinite`          → `"∞ FT"` (overrides everything; topY ignored)
 * - missing/non-finite topY → `"???"`
 */
export function heightFt(
  worldHeight: number,
  topY: number | null | undefined,
  isInfinite: boolean = false,
): string {
  if (isInfinite) return '∞ FT';
  if (topY == null || !Number.isFinite(topY)) return '???';
  const ft = Math.floor((worldHeight - topY) / SCORE_DISPLAY_DIVISOR);
  if (ft >= 1_000_000) return `${(ft / 1_000_000).toFixed(1)}M FT`;
  if (ft >= 10_000)    return `${Math.round(ft / 1_000)}K FT`;
  return `${ft} FT`;
}
