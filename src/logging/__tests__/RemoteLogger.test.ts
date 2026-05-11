import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';
import { RemoteLogger } from '../RemoteLogger';
import type { LogEntry, LogEnvelope } from '../../../shared/logging/Logger';

function makeEnv(over: Partial<LogEnvelope> = {}): LogEnvelope {
  return {
    userGuid: 'guid-1',
    sessionId: 'sess-1',
    appVersion: '1.2.3',
    platform: 'web',
    userAgent: 'Mozilla/5.0',
    ...over,
  };
}

describe('RemoteLogger', () => {
  let sent: LogEntry[][];
  let env: LogEnvelope;
  let logger: RemoteLogger;
  let transport: (entries: LogEntry[]) => void;

  beforeEach(() => {
    vi.useFakeTimers();
    sent = [];
    env = makeEnv();
    transport = (entries) => { sent.push(entries); };
    logger = new RemoteLogger({
      getEnvelope: () => env,
      transport: (e) => { transport(e); return true; },
      flushIntervalMs: 5000,
      maxEntries: 10,
      maxBatchBytes: 56 * 1024,
      maxEntryBytes: 2 * 1024,
    });
  });

  afterEach(() => { logger.dispose(); vi.useRealTimers(); });

  it('attaches envelope fields to every entry', () => {
    logger.error('boom', { stack: 'x' });
    logger.flushNow();
    expect(sent).toHaveLength(1);
    expect(sent[0][0]).toMatchObject({
      userGuid: 'guid-1', sessionId: 'sess-1',
      appVersion: '1.2.3', platform: 'web',
      userAgent: 'Mozilla/5.0', level: 'error', message: 'boom',
    });
    expect(sent[0][0].payload).toEqual({ stack: 'x' });
    expect(typeof sent[0][0].timestamp).toBe('number');
  });

  it('drops events when setVerbose(false), sends errors/warns', () => {
    logger.setVerbose(false);
    logger.event({ type: 'user:created' });
    logger.error('e');
    logger.warn('w');
    logger.flushNow();
    expect(sent[0].map((e) => e.level)).toEqual(['error', 'warn']);
  });

  it('sends events when setVerbose(true)', () => {
    logger.setVerbose(true);
    logger.event({ type: 'heap:selected', heapId: 'h1' });
    logger.flushNow();
    expect(sent[0]).toHaveLength(1);
    expect(sent[0][0].level).toBe('event');
    expect(sent[0][0].eventType).toBe('heap:selected');
    expect(sent[0][0].payload).toEqual({ heapId: 'h1' });
  });

  it('flushes after flushIntervalMs', () => {
    logger.error('a');
    expect(sent).toHaveLength(0);
    vi.advanceTimersByTime(5000);
    expect(sent).toHaveLength(1);
  });

  it('flushes when buffer hits maxEntries', () => {
    for (let i = 0; i < 10; i++) logger.error(`e${i}`);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(10);
  });

  it('flushes before adding when next entry would exceed byte budget', () => {
    logger = new RemoteLogger({
      getEnvelope: () => env,
      transport: (e) => { transport(e); return true; },
      flushIntervalMs: 99999,
      maxEntries: 1000,
      maxBatchBytes: 1000,
      maxEntryBytes: 800,
    });
    logger.error('a', { blob: 'x'.repeat(600) });
    logger.error('b', { blob: 'y'.repeat(600) });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toHaveLength(1);
  });

  it('truncates an oversize entry to a stub', () => {
    logger.error('big', { blob: 'x'.repeat(3000) });
    logger.flushNow();
    const e = sent[0][0];
    expect(e.payload).toMatchObject({ truncated: true });
    expect(typeof (e.payload as any).originalSize).toBe('number');
  });

  it('swallows transport throws and clears buffer', () => {
    const throwingLogger = new RemoteLogger({
      getEnvelope: () => env,
      transport: () => { throw new Error('net'); },
      flushIntervalMs: 99999,
      maxEntries: 10,
      maxBatchBytes: 9999,
      maxEntryBytes: 9999,
    });
    expect(() => { throwingLogger.error('x'); throwingLogger.flushNow(); }).not.toThrow();
    // After failed flush, a subsequent flushNow has nothing to send.
    throwingLogger.flushNow();
    throwingLogger.dispose();
  });

  it('reads envelope at flush time (allows late userGuid hydration)', () => {
    let guid = 'pre-init';
    const lateLogger = new RemoteLogger({
      getEnvelope: () => ({ ...env, userGuid: guid }),
      transport: (e) => { sent.push(e); return true; },
      flushIntervalMs: 99999, maxEntries: 10, maxBatchBytes: 9999, maxEntryBytes: 9999,
    });
    lateLogger.error('a');                // buffered with pre-init guid
    guid = 'real-guid';
    lateLogger.flushNow();
    expect(sent[0][0].userGuid).toBe('real-guid');
    lateLogger.dispose();
  });
});
