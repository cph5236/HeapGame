/**
 * Ad unit IDs arrive as build-time env (`VITE_ADMOB_*`), sourced from CI secrets.
 * A secret set from a file — or pasted with its line ending — carries a trailing
 * newline, and Vite bakes that straight into the bundle. The GMA SDK then rejects
 * every load with "Cannot determine request type. Is your ad unit id correct?"
 * (ERROR_CODE_INVALID_REQUEST), which the AdMob console reports as no request at
 * all, so the failure is invisible from both sides.
 *
 * Normalizing here makes the whole class of whitespace-in-secret bug a non-event.
 */
export function normalizeAdId(raw: string | undefined): string {
  return (raw ?? '').trim();
}
