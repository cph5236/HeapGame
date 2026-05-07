/**
 * Weighted random sample without replacement.
 *
 * Uses the Efraimidis–Spirakis "weighted reservoir" algorithm: each item gets
 * a key u^(1/w), where u ∈ (0,1] is uniform random and w is the item's weight.
 * Sort descending by key, take the top `count`. Result is statistically a
 * weighted-without-replacement sample.
 *
 * @param defs   Source items, each with a `rarity` ∈ (0, 1] used as weight.
 * @param count  Desired pool size. Result is clipped to `defs.length`.
 * @param rng    () => number in [0, 1). Defaults to `Math.random`. Pass a
 *               seeded rng in tests for determinism.
 */
export function pickTrashWallPool<T extends { rarity: number }>(
  defs: readonly T[],
  count: number,
  rng: () => number = Math.random,
): T[] {
  if (count <= 0 || defs.length === 0) return [];
  const n = Math.min(count, defs.length);

  const keyed = defs.map((def) => {
    const w = def.rarity > 0 ? def.rarity : 1e-9;
    // Avoid Math.log(0) — clamp uniform sample slightly above 0.
    const u = Math.max(rng(), 1e-12);
    return { def, key: Math.log(u) / w };  // equivalent to u^(1/w), monotonic
  });

  keyed.sort((a, b) => b.key - a.key);
  return keyed.slice(0, n).map((k) => k.def);
}
