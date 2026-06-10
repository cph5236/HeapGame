/** Clamp a raw volume to the playable [0,1] range. */
export function clampVolume(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Convert a pointer X over a slider track into a clamped [0,1] volume. */
export function volumeFromTrackX(pointerX: number, trackLeft: number, trackW: number): number {
  return clampVolume((pointerX - trackLeft) / trackW);
}
