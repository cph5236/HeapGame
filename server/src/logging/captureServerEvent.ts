import type { Sink, StampedLogEntry } from './Sink';
import type { LogLevel } from '../../../shared/logging/Logger';

export async function captureServer(
  sink: Sink,
  level: LogLevel,
  message: string,
  payload: Record<string, unknown>,
): Promise<void> {
  const e: StampedLogEntry = {
    userGuid: 'server',
    sessionId: 'server',
    appVersion: 'server',
    platform: 'web',
    userAgent: 'server',
    level,
    timestamp: Date.now(),
    message,
    payload,
    serverTimestamp: Date.now(),
  };
  try {
    await sink.write([e]);
  } catch {
    /* swallow */
  }
}
