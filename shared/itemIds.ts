// shared/itemIds.ts
//
// Canonical list of rewardable / valid item ids. This is the single source the
// SERVER can import (it cannot see the client-only src/data/itemDefs.ts) for
// mint-time reward_id validation. A unit test asserts this stays in sync with
// ITEM_DEFS.

export const ITEM_IDS = [
  'ladder',
  'ibeam',
  'checkpoint',
  'shield',
  'revive',
  'adrenaline',
  'pogo',
  'stall',
] as const;

export type ItemId = (typeof ITEM_IDS)[number];

export function isItemId(s: string): s is ItemId {
  return (ITEM_IDS as readonly string[]).includes(s);
}
