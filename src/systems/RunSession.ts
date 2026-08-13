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
  private generation = 0;
  private inFlight = false;

  /**
   * Begin acquiring a token. Safe to call again; discards any previous token.
   *
   * Known accepted limitation: the token binds the playerId passed here, while
   * ScoreScene submits under a fresh getEffectivePlayerId() read. If GPGS
   * sign-in resolves mid-run the two disagree and the server rejects the score
   * as session-mismatch. Android-only, requires sign-in to land after the run
   * starts, and deliberately left unhandled — see PR #148 review.
   */
  start(playerId: string, heapId: string): void {
    this.stop();
    this.token = undefined;
    this.inFlight = false;
    const gen = ++this.generation;
    const attempt = (): void => {
      // A slow connection can leave a request outstanding past RETRY_MS.
      // Firing a second one doubles rate-limit consumption for no benefit.
      if (this.inFlight) return;
      this.inFlight = true;
      void ScoreClient.openSession(playerId, heapId)
        .then(({ token, retryable }) => {
          if (gen !== this.generation) return; // superseded by a later start()
          if (token) {
            this.token = token;
            this.stop();
            return;
          }
          // Nothing to retry for — stop rather than poll a server that will
          // keep giving the same answer for the whole scene.
          if (!retryable) this.stop();
        })
        .catch(() => { /* offline — the retry timer handles it */ })
        .finally(() => {
          if (gen === this.generation) this.inFlight = false;
        });
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
