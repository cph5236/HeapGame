import type { GameEvent, Platform } from './events';

export type LogLevel = 'error' | 'warn' | 'event';

/** Envelope fields the logger attaches automatically. Read at flush time. */
export interface LogEnvelope {
  userGuid: string;      // 'pre-init' until SaveData hydrates
  sessionId: string;
  appVersion: string;
  platform: Platform;
  userAgent: string;
}

/** One serialized log entry as sent over the wire. */
export interface LogEntry {
  userGuid: string;
  sessionId: string;
  appVersion: string;
  platform: Platform;
  userAgent: string;
  level: LogLevel;
  timestamp: number;
  eventType?: string;
  message?: string;
  payload: Record<string, unknown>;
}

export interface ErrorContext {
  stack?: string;
  url?: string;
  status?: number;
  durationMs?: number;
  bodySnippet?: string;
  [k: string]: unknown;
}

export interface WarnContext {
  [k: string]: unknown;
}

export interface Logger {
  error(message: string, context?: ErrorContext): void;
  warn(message: string, context?: WarnContext): void;
  event<E extends GameEvent>(event: E): void;
  /** Toggle event-level reporting. Errors and warns are always sent. */
  setVerbose(enabled: boolean): void;
}
