/**
 * Format a multiplier for display: up to two decimals, with trailing
 * zeros (and a bare trailing decimal point) stripped.
 *   1.25 → "1.25"   1.5 → "1.5"   2 → "2"   1.05 → "1.05"
 */
export function formatMult(m: number): string {
  return m.toFixed(2).replace(/\.?0+$/, '');
}
