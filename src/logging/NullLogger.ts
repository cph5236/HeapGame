import type { Logger, ErrorContext, WarnContext } from '../../shared/logging/Logger';
import type { GameEvent } from '../../shared/logging/events';

export class NullLogger implements Logger {
  error(_message: string, _context?: ErrorContext): void {}
  warn(_message: string, _context?: WarnContext): void {}
  event<E extends GameEvent>(_event: E): void {}
  setVerbose(_enabled: boolean): void {}
}
