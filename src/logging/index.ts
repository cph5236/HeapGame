import type { Logger } from '../../shared/logging/Logger';
import { NullLogger } from './NullLogger';

let _logger: Logger = new NullLogger();

/** Returns the active Logger. Defaults to NullLogger until initLogger() runs. */
export function getLogger(): Logger {
  return _logger;
}

/** Swap in a real Logger. Called once at boot after SaveData is ready. */
export function setLogger(logger: Logger): void {
  _logger = logger;
}

/** Test helper — reset to NullLogger between tests. */
export function _resetLoggerForTests(): void {
  _logger = new NullLogger();
}
