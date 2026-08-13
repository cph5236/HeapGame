// Holds the run-session token for one game-scene lifetime.
// See docs/superpowers/specs/2026-08-12-run-session-tokens-design.md
//
// Issuance is fire-and-forget and must never block a frame. On failure it
// retries for the life of the scene, because a run that never obtains a token
// cannot submit a score at all.

import { ScoreClient } from './ScoreClient';

/** Steady-state gap between retries once the early attempts are spent. */
export const RETRY_MS = 15_000;

/**
 * Delays before the 2nd and 3rd attempts, in order; every later attempt waits
 * RETRY_MS.
 *
 * A flat 15s schedule left a real hole: the happy path resolves in a few
 * hundred ms, but if the very first attempt fails on a flaky connection there
 * is then no token for 15 full seconds — long enough to cover an entire short
 * run. A run that ends tokenless is rejected outright rather than clamped, so
 * that run's score is lost. Retrying quickly twice closes almost all of that
 * window; backing off afterwards keeps a long run from hammering the endpoint.
 */
export const EARLY_RETRY_MS: readonly number[] = [1_000, 3_000];

export class RunSession {
  private token?: string;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private generation = 0;
  private attempts = 0;
  /**
   * False once stop() runs. Retries are scheduled by a settling request, not by
   * a standing interval, so clearing the timer is not enough on its own: a
   * request already in flight when the scene shuts down would otherwise settle
   * afterwards and start the loop up again behind a dead scene.
   */
  private active = false;

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
    this.attempts = 0;
    this.active = true;
    const gen = ++this.generation;

    // Each attempt schedules the next one only once it has settled, so a
    // request slower than its retry gap can never stack a second concurrent
    // request on top of itself and double rate-limit consumption. This replaces
    // the explicit in-flight flag the standing-interval version needed.
    const attempt = (): void => {
      const delay = EARLY_RETRY_MS[this.attempts] ?? RETRY_MS;
      this.attempts++;

      void ScoreClient.openSession(playerId, heapId)
        .then(({ token, retryable }) => {
          if (gen !== this.generation) return; // superseded by a later start()
          if (token) {
            this.token = token;
            return;
          }
          // Nothing to retry for — give up rather than poll a server that will
          // keep giving the same answer for the whole scene.
          if (retryable && this.active) this.timer = setTimeout(attempt, delay);
        })
        .catch(() => {
          // Offline. fetch rejected, which is transient by nature — keep going.
          if (gen === this.generation && this.active) this.timer = setTimeout(attempt, delay);
        });
    };
    attempt();
  }

  /** Halt retries. Call from scene shutdown; the held token stays readable. */
  stop(): void {
    this.active = false;
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  getToken(): string | undefined {
    return this.token;
  }
}
