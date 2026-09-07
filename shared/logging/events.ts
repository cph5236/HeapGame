// Discriminated union of gameplay events. Each member's payload is statically
// checked at call sites via the `type` discriminator.

export type GameMode = 'normal' | 'infinite';
export type RunEndCause = 'death' | 'quit';
export type Platform = 'web' | 'android' | 'ios';

export type UpgradesSnapshot = Record<string, number>;

/** How a share attempt resolved. Lives here rather than in the client's
 *  shareRun.ts so the event payload below and the runtime that produces it are
 *  checked against one definition. */
export type ShareOutcome = 'shared' | 'copied' | 'dismissed' | 'unavailable';

export type GameEvent =
  | { type: 'user:created' }
  | { type: 'heap:selected'; heapId: string }
  | { type: 'run:start'; heapId: string; mode: GameMode }
  | {
      type: 'run:end';
      heapId: string;
      mode: GameMode;
      score: number;
      height: number;
      kills: number;
      durationMs: number;
      cause: RunEndCause;
      upgrades: UpgradesSnapshot;
    }
  | {
      type: 'score:submitted';
      heapId: string;
      score: number;
      accepted: boolean;
      rejectionReason?: string;
    }
  | { type: 'placement:made'; heapId: string; itemType: string }
  | { type: 'pickup:grab'; itemId: string; bonus: number }
  | {
      /** A player used the score screen's SHARE button. `outcome` separates a
       *  real hand-off from a share sheet they backed out of, so the share loop
       *  can be measured rather than guessed at. */
      type: 'share:run';
      heapId: string;
      score: number;
      outcome: ShareOutcome;
    }
  | {
      type: 'upgrade:purchased';
      itemType: string;
      newLevel: number;
      cost: number;
      balanceAfter: number;
      upgrades: UpgradesSnapshot;
    };

export type EventType = GameEvent['type'];
