import type {
  Logger, ErrorContext, WarnContext, LogEntry, LogEnvelope,
} from '../../shared/logging/Logger';
import type { GameEvent } from '../../shared/logging/events';
import { projectEventMetrics } from '../../shared/logging/aeProjection';

export interface RemoteLoggerOptions {
  /**
   * Read at FLUSH time, not at enqueue time, so `userGuid` can hydrate late.
   *
   * This is deliberate and is not a mislabelling bug. `error()`/`warn()` fire
   * during boot, before SaveData is readable, when `getEffectivePlayerId()`
   * still yields `'pre-init'`; and the GPGS gate can settle the effective id
   * up to GPGS_SIGNIN_TIMEOUT_MS later. Stamping per entry would split one
   * physical player's boot across two ids (or orphan it under `'pre-init'`),
   * which is strictly worse for the per-player trace than stamping the whole
   * batch with the id that settled. The id identifies the player, not the
   * instant.
   */
  getEnvelope: () => LogEnvelope;
  /** Returns false to indicate "send queue full" / unsent (currently unused). */
  transport: (entries: LogEntry[]) => boolean;
  flushIntervalMs?: number;
  maxEntries?: number;
  maxBatchBytes?: number;
  maxEntryBytes?: number;
  startVerbose?: boolean;
}

const DEFAULTS = {
  flushIntervalMs: 5000,
  maxEntries: 10,
  maxBatchBytes: 56 * 1024,
  maxEntryBytes: 2 * 1024,
};

type Pending = { entry: Omit<LogEntry, keyof LogEnvelope>; bytes: number };

export class RemoteLogger implements Logger {
  private readonly opts: Required<RemoteLoggerOptions>;
  private buffer: Pending[] = [];
  private bufferedBytes = 0;
  private verbose: boolean;
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(opts: RemoteLoggerOptions) {
    this.opts = {
      ...DEFAULTS,
      startVerbose: false,
      ...opts,
    } as Required<RemoteLoggerOptions>;
    this.verbose = this.opts.startVerbose;
    this.timer = setInterval(() => { this.safeFlush(); }, this.opts.flushIntervalMs);
  }

  dispose(): void {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
  }

  setVerbose(enabled: boolean): void { this.verbose = enabled; }

  error(message: string, context: ErrorContext = {}): void {
    try { this.enqueue('error', { message, payload: context }); } catch { /* swallow */ }
  }

  warn(message: string, context: WarnContext = {}): void {
    try { this.enqueue('warn', { message, payload: context }); } catch { /* swallow */ }
  }

  event<E extends GameEvent>(e: E): void {
    if (!this.verbose) return;
    try {
      const { type, ...payload } = e as any;
      this.enqueue('event', { eventType: type, payload, metrics: projectEventMetrics(e) });
    } catch { /* swallow */ }
  }

  /** Force a flush. Intended for tests and unload handlers. */
  flushNow(): void { this.safeFlush(); }

  private enqueue(
    level: 'error' | 'warn' | 'event',
    parts: {
      message?: string;
      eventType?: string;
      payload: Record<string, unknown>;
      metrics?: { doubles?: number[]; blobs?: string[] };
    },
  ): void {
    const raw = {
      level,
      timestamp: Date.now(),
      message: parts.message,
      eventType: parts.eventType,
      payload: parts.payload,
      metrics: parts.metrics,
    };
    let json = JSON.stringify(raw);
    if (json.length > this.opts.maxEntryBytes) {
      const stub = {
        ...raw,
        payload: {
          truncated: true,
          originalSize: json.length,
          head: json.slice(0, 1024),
        },
      };
      json = JSON.stringify(stub);
      this.pushOrFlush({ entry: stub, bytes: json.length });
      return;
    }
    this.pushOrFlush({ entry: raw, bytes: json.length });
  }

  private pushOrFlush(p: Pending): void {
    const wouldExceedBytes  = this.bufferedBytes + p.bytes > this.opts.maxBatchBytes;
    const wouldExceedCount  = this.buffer.length + 1 > this.opts.maxEntries;
    if (wouldExceedBytes || wouldExceedCount) {
      this.safeFlush();
    }
    this.buffer.push(p);
    this.bufferedBytes += p.bytes;
    if (this.buffer.length >= this.opts.maxEntries
     || this.bufferedBytes >= this.opts.maxBatchBytes) {
      this.safeFlush();
    }
  }

  private safeFlush(): void {
    if (this.buffer.length === 0) return;
    const env = this.opts.getEnvelope();
    const entries: LogEntry[] = this.buffer.map((p) => ({
      ...env,
      level:     (p.entry as any).level,
      timestamp: (p.entry as any).timestamp,
      message:   (p.entry as any).message,
      eventType: (p.entry as any).eventType,
      payload:   (p.entry as any).payload,
      metrics:   (p.entry as any).metrics,
    }));
    this.buffer = [];
    this.bufferedBytes = 0;
    try { this.opts.transport(entries); } catch { /* swallow */ }
  }
}
