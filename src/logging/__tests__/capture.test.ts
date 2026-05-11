import { describe, it, expect, beforeEach, afterEach, beforeAll } from 'vitest';
import { installGlobalErrorHandlers } from '../capture';
import type { Logger } from '../../../shared/logging/Logger';

function spyLogger(): Logger & { errors: any[]; warns: any[]; events: any[] } {
  const errors: any[] = [];
  const warns: any[] = [];
  const events: any[] = [];
  return {
    errors,
    warns,
    events,
    error: (m, c) => errors.push([m, c]),
    warn: (m, c) => warns.push([m, c]),
    event: (e) => events.push(e),
    setVerbose: () => {},
  };
}

// Stub window event APIs — vitest runs in node environment
const listeners: Record<string, ((ev: any) => void)[]> = {};
beforeAll(() => {
  const win = {
    addEventListener: (type: string, fn: (ev: any) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    removeEventListener: (type: string, fn: (ev: any) => void) => {
      const arr = listeners[type] ?? [];
      const i = arr.indexOf(fn);
      if (i >= 0) arr.splice(i, 1);
    },
    dispatchEvent: (ev: { type: string; [k: string]: any }) => {
      (listeners[ev.type] ?? []).slice().forEach((fn) => fn(ev));
      return true;
    },
  };
  Object.defineProperty(global, 'window', { value: win, configurable: true });
  // Minimal stand-ins for ErrorEvent / Event used by the tests.
  class ErrorEventStub {
    type: string;
    message: string;
    error: any;
    filename: string;
    lineno: number;
    colno: number;
    constructor(type: string, init: any = {}) {
      this.type = type;
      this.message = init.message ?? '';
      this.error = init.error;
      this.filename = init.filename ?? '';
      this.lineno = init.lineno ?? 0;
      this.colno = init.colno ?? 0;
    }
  }
  class EventStub {
    type: string;
    constructor(type: string) {
      this.type = type;
    }
  }
  (global as any).ErrorEvent = ErrorEventStub;
  (global as any).Event = EventStub;
});

describe('installGlobalErrorHandlers', () => {
  let log: ReturnType<typeof spyLogger>;
  let uninstall: () => void;

  beforeEach(() => {
    log = spyLogger();
    uninstall = installGlobalErrorHandlers(log);
  });

  afterEach(() => {
    uninstall();
  });

  it('captures window.onerror as logger.error', () => {
    const err = new Error('kaboom');
    window.dispatchEvent(
      new ErrorEvent('error', {
        message: 'kaboom',
        error: err,
        filename: 'x.js',
        lineno: 1,
        colno: 2,
      })
    );
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0][0]).toBe('kaboom');
    expect(log.errors[0][1]).toMatchObject({
      filename: 'x.js',
      lineno: 1,
      colno: 2,
    });
  });

  it('captures unhandledrejection as logger.error', () => {
    const reason = new Error('rej');
    const ev = new Event('unhandledrejection') as any;
    ev.reason = reason;
    window.dispatchEvent(ev);
    expect(log.errors).toHaveLength(1);
    expect(log.errors[0][0]).toBe('rej');
  });
});
