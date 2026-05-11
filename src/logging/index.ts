import type { Logger, LogEnvelope } from '../../shared/logging/Logger';
import type { Platform } from '../../shared/logging/events';
import { NullLogger } from './NullLogger';
import { RemoteLogger } from './RemoteLogger';
import { defaultTransport } from './transport';
import { getPlayerGuid, getVerboseLogging } from '../systems/SaveData';
import { installGlobalErrorHandlers } from './capture';
import { Capacitor } from '@capacitor/core';

let _logger: Logger = new NullLogger();

function genSessionId(): string {
  try {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
      return crypto.randomUUID();
    }
  } catch { /* fall through */ }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

const SESSION_ID = genSessionId();

function detectPlatform(): Platform {
  try {
    const p = Capacitor.getPlatform();
    if (p === 'android' || p === 'ios') return p;
  } catch { /* not a Capacitor build */ }
  return 'web';
}

function getEnvelope(): LogEnvelope {
  let userGuid = 'pre-init';
  try { userGuid = getPlayerGuid() || 'pre-init'; } catch { /* SaveData not ready */ }
  return {
    userGuid,
    sessionId: SESSION_ID,
    appVersion: (import.meta.env.VITE_APP_VERSION as string | undefined) ?? '0.0.0',
    platform: detectPlatform(),
    userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 200),
  };
}

export function getLogger(): Logger { return _logger; }
export function setLogger(l: Logger): void { _logger = l; }
export function _resetLoggerForTests(): void { _logger = new NullLogger(); }

/** Call once at app boot (BootScene), after SaveData module is importable. */
export function initLogger(): void {
  const logger = new RemoteLogger({
    getEnvelope,
    transport: defaultTransport,
    startVerbose: (() => { try { return getVerboseLogging(); } catch { return false; } })(),
  });
  // Flush on page hide / visibility change — final batch before unload.
  if (typeof window !== 'undefined') {
    const flush = () => { try { (logger as any).flushNow(); } catch { /* swallow */ } };
    window.addEventListener('pagehide', flush);
    window.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') flush();
    });
  }
  setLogger(logger);
  if (typeof window !== 'undefined') {
    installGlobalErrorHandlers(logger);
  }
}
