import { ENEMY_CULL_DISTANCE } from '../constants';

/**
 * Pure decision for HeapChunkRenderer.cullChunks: given the band tops that
 * currently have rendered chunk objects and the camera's bottom edge (world Y),
 * return the band tops that have scrolled far enough BELOW the camera to be
 * safely destroyed.
 *
 * World Y grows downward (summit at y=0, floor at large y), so a chunk is
 * "below" the camera when its bandTop exceeds the camera bottom. A cull margin
 * (ENEMY_CULL_DISTANCE) keeps a buffer of just-off-screen chunks alive so a
 * small downward scroll doesn't thrash re-rendering.
 */
export function selectChunksToCull(
  bandTops: Iterable<number>,
  camBottom: number,
): number[] {
  const threshold = camBottom + ENEMY_CULL_DISTANCE;
  const out: number[] = [];
  for (const bandTop of bandTops) {
    if (bandTop > threshold) out.push(bandTop);
  }
  return out;
}
