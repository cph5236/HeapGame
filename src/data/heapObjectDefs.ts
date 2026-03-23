import { ObjectDef } from './heapTypes';

/**
 * Maps keyid → physical dimensions.
 * Add new object types here as the heap grows in complexity.
 */
export const OBJECT_DEFS: Record<number, ObjectDef> = {
  0: { width: 80,  height: 40 }, // standard crate
  1: { width: 120, height: 32 }, // wide flat box
  2: { width: 60,  height: 56 }, // tall narrow crate
};
