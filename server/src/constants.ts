// Request-validation limits shared across routes.

/** Max accepted length for client-supplied ids (heap ids, player guids). */
export const MAX_ID_LEN = 64;

/** Analytics Engine dataset the admin query proxy reads. Server-side only —
 *  never accepted from a request. */
export const AE_DATASET = 'heap_logs';
