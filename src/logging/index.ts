import type { Logger, LogEnvelope } from '../../shared/logging/Logger';
import type { Platform } from '../../shared/logging/events';
import { NullLogger } from './NullLogger';
import { RemoteLogger } from './RemoteLogger';
import { defaultTransport } from './transport';
import { getEffectivePlayerId, getVerboseLogging } from '../systems/SaveData';
import { installGlobalErrorHandlers } from './capture';
import { Capacitor } from '@capacitor/core';
import { version as APP_VERSION } from '../../package.json';

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
  // The effective player id (GPGS id when signed in, else the GUID) — the same
  // key player_auth uses, so events can be joined to a new-player cohort. A
  // bare getPlayerGuid() here would silently orphan every signed-in player's
  // events; see PR #93 for the same mistake in the cosmetics path.
  let userGuid = 'pre-init';
  try { userGuid = getEffectivePlayerId() || 'pre-init'; } catch { /* SaveData not ready */ }
  return {
    userGuid,
    sessionId: SESSION_ID,
    appVersion: APP_VERSION,
    platform: detectPlatform(),
    userAgent: (typeof navigator !== 'undefined' ? navigator.userAgent : '').slice(0, 200),
  };
}

export function getLogger(): Logger { return _logger; }
export function setLogger(l: Logger): void { _logger = l; }
export function _resetLoggerForTests(): void { _logger = new NullLogger(); }

/** Public accessor for the logging envelope, reused by non-logging callers (feedback). */
export function getLogEnvelope(): LogEnvelope { return getEnvelope(); }

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
