import { createHash } from 'node:crypto';
import { Vertex } from '../../../shared/heapTypes';
import type { BandRow } from '../../../shared/heapPolygon/bandEnvelope';

/** SHA-256 hash of a vertex array serialized as JSON. */
export function hashVertices(vertices: Vertex[]): string {
  return createHash('sha256').update(JSON.stringify(vertices)).digest('hex');
}

/**
 * Freeze limits as band counts. Chosen to preserve the live-zone span the old
 * vertex limits implied: the measured active band was ~1,533px, which is ~77
 * bands at BAND_SIZE_PX; FREEZE_BATCH_BANDS is half, mirroring 500/250.
 */
export const LIVE_ZONE_MAX_BANDS = 77;
export const FREEZE_BATCH_BANDS = 38;

/**
 * Once the live band count exceeds the limit, freeze the bottom batch — the
 * HIGHEST band indices, since y grows downward. Frozen bands are immutable:
 * placement is gated to y <= liveZoneBottomY, so nothing writes below the freeze
 * line again. Returns null when no freeze is due.
 *
 * `allBands` is every band row the heap currently has: the live set plus any
 * straggler a freeze spared because it was written mid-freeze (see
 * HeapDB.freezeAtomic). Frozen rows are otherwise deleted, so this is NOT the
 * heap's whole history. The live set must still be carved out here with the
 * SAME predicate every other consumer uses: LIVE is `band < freezeBand`.
 * Callers pass `Infinity` for the pre-freeze sentinel (`freeze_y === 0`), never
 * `bandOf(0)`.
 *
 * The direction matters beyond the first freeze. Filtering `band >= freezeBand`
 * instead selects the already-frozen bands, whose count can never exceed
 * FREEZE_BATCH_BANDS — so freeze fires exactly once per heap and the live zone
 * then grows without bound, defeating the whole point of freezing.
 */
export function checkFreezeBands(
  allBands: BandRow[],
  freezeBand: number,
): { newFreezeBand: number; frozen: BandRow[] } | null {
  const live = allBands.filter((b) => b.band < freezeBand).sort((a, b) => a.band - b.band);
  if (live.length <= LIVE_ZONE_MAX_BANDS) return null;
  const frozen = live.slice(-FREEZE_BATCH_BANDS);
  return { newFreezeBand: frozen[0].band, frozen };
}
