// Holds the run-session token for one game-scene lifetime.
// See docs/superpowers/specs/2026-08-12-run-session-tokens-design.md
//
// Issuance is fire-and-forget and must never block a frame. On failure it
// retries for the life of the scene, because a run that never obtains a token
// cannot submit a score at all.

import { ScoreClient } from './ScoreClient';

export const RETRY_MS = 15_000;

export class RunSession {
  private token?: string;
  private timer: ReturnType<typeof setInterval> | null = null;

  /** Begin acquiring a token. Safe to call again; discards any previous token. */
  start(playerId: string, heapId: string): void {
    this.stop();
    this.token = undefined;
    const attempt = (): void => {
      void ScoreClient.openSession(playerId, heapId)
        .then((token) => {
          if (!token) return;
          this.token = token;
          this.stop();
        })
        .catch(() => { /* offline — the retry timer handles it */ });
    };
    attempt();
    this.timer = setInterval(attempt, RETRY_MS);
  }

  /** Halt retries. Call from scene shutdown; the held token stays readable. */
  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getToken(): string | undefined {
    return this.token;
  }
}
