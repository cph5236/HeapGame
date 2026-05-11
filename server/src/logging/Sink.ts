import type { LogEntry } from '../../../shared/logging/Logger';

/** A normalized log entry as it arrives from the route (with server_ts stamped). */
export interface StampedLogEntry extends LogEntry {
  serverTimestamp: number;
}

export interface Sink {
  write(entries: StampedLogEntry[]): Promise<void>;
}
