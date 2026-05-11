import type { Logger } from '../../shared/logging/Logger';

/** Installs window.error + unhandledrejection handlers. Returns an uninstaller. */
export function installGlobalErrorHandlers(logger: Logger): () => void {
  const onError = (ev: ErrorEvent) => {
    try {
      logger.error(ev.message ?? 'window.error', {
        stack: ev.error?.stack,
        filename: ev.filename,
        lineno: ev.lineno,
        colno: ev.colno,
      });
    } catch { /* swallow */ }
  };
  const onRejection = (ev: PromiseRejectionEvent | any) => {
    try {
      const r = ev?.reason;
      const message =
        r && typeof r === 'object' && 'message' in r
          ? String(r.message)
          : String(r);
      logger.error(message, { stack: r?.stack });
    } catch { /* swallow */ }
  };
  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection as any);
  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection as any);
  };
}
