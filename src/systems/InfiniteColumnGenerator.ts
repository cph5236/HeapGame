import { HeapEntry } from '../data/heapTypes';
import { OBJECT_DEFS } from '../data/heapObjectDefs';
import { HeapState } from './HeapState';
import { findSurfaceY } from './HeapSurface';
import { MOCK_HEAP_HEIGHT_PX, CHUNK_BAND_HEIGHT } from '../constants';


/**
 * Procedurally generates HeapEntry[] for one column of the infinite heap.
 * Entries are stacked using findSurfaceY so blocks sit on each other naturally.
 *
 * @param seed      - Deterministic PRNG seed (different per run per column)
 * @param xMin      - Left edge of column in world coords
 * @param xMax      - Right edge of column in world coords
 * @param numBlocks - Number of blocks to generate
 */
export function buildColumnEntries(
  seed: number,
  xMin: number,
  xMax: number,
  numBlocks: number,
): HeapEntry[] {
  return appendColumnEntries(seed, xMin, xMax, 0, [], numBlocks);
}

/**
 * Generates additional HeapEntry[] continuing from a previous buildColumnEntries call.
 * Uses the same seed + block-index math so the PRNG sequence is seamless.
 *
 * @param seed           - Same seed used for the original buildColumnEntries call
 * @param xMin           - Left edge of column in world coords
 * @param xMax           - Right edge of column in world coords
 * @param startIndex     - Block index to start from (= total blocks already generated)
 * @param existingEntries - All previously generated entries (used for surface detection)
 * @param numBlocks      - Number of additional blocks to generate
 * @returns Only the newly generated entries (not the existing ones)
 */
export function appendColumnEntries(
  seed: number,
  xMin: number,
  xMax: number,
  startIndex: number,
  existingEntries: readonly HeapEntry[],
  numBlocks: number,
  knownHeapTopY?: number,
): HeapEntry[] {
  const state = new HeapState(seed);
  // seededRandom is stateless (pure function of index + seed), so we can
  // start directly at startIndex without replaying prior blocks.
  const allEntries: HeapEntry[] = [...existingEntries];
  const newEntries: HeapEntry[] = [];

  // Extension mode: use the caller-supplied heap top when available (avoids
  // an O(n) scan). Fall back to scanning if not provided.
  const isExtension = existingEntries.length > 0;
  let heapTopY = MOCK_HEAP_HEIGHT_PX;
  if (isExtension) {
    if (knownHeapTopY !== undefined) {
      heapTopY = knownHeapTopY;
    } else {
      for (const e of existingEntries) {
        const d = OBJECT_DEFS[e.keyid] ?? OBJECT_DEFS[0];
        const top = e.y - d.height / 2;
        if (top < heapTopY) heapTopY = top;
      }
    }
  }

  for (let i = startIndex; i < startIndex + numBlocks; i++) {
    const h  = 30 + Math.floor(state.seededRandom(i * 3)     * 71); // 30–100
    const w  = 50 + Math.floor(state.seededRandom(i * 3 + 2) * 76); // 50–125
    
    //Calculate xmin and max given the object width, to ensure it fits within the column bounds
    const objXMin = xMin + w / 2;
    const objXMax = xMax - w / 2;

    const cx = objXMin + state.seededRandom(i * 3 + 1) * (objXMax - objXMin);

    let surfaceY = findSurfaceY(cx, w, allEntries);    

    const y = surfaceY - h / 2;

    const entry: HeapEntry = { x: cx, y, keyid: 0, w, h };
    allEntries.push(entry);
    newEntries.push(entry);
  }

  return newEntries;
}
