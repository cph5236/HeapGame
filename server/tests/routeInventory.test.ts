import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { MockHeapDB } from './helpers/mockDb';

/**
 * The platform/game split moved every route file. This pins the mounted route
 * table so a move can never silently change a path or a method — the one way
 * that refactor could break live clients.
 *
 * The table is asserted sorted, not in registration order: splitting createApp
 * means platform routes now register before game routes, so the raw order
 * changed while the set did not. What must NOT change is the order WITHIN a
 * path prefix — a rate limiter or admin gate registered after the handler it is
 * meant to guard would silently stop guarding it — so that is asserted
 * separately below.
 */
function tableOf() {
  const stub: any = new Proxy({}, { get: () => async () => undefined });
  const app = createApp(new MockHeapDB() as any, stub, {
    adminSecret: 'x',
    codeDb: stub, dailyDb: stub, feedbackDb: stub, configDb: stub,
    customizationDb: stub, playerAuthDb: stub, contributionDb: stub,
    playerNameDb: stub, banDb: stub, logSink: stub, sessionSecret: 's',
    limiters: { global: stub },
  });
  return (app as any).routes.map((r: any) => `${r.method} ${r.path}`) as string[];
}

describe('route inventory', () => {
  it('mounts exactly the expected set of routes', () => {
    expect([...tableOf()].sort().join('\n')).toMatchSnapshot();
  });

  it('keeps middleware ahead of its handler within every path prefix', () => {
    const byPrefix: Record<string, string[]> = {};
    for (const r of tableOf()) {
      const p = r.split(' ', 2)[1] ?? '/';
      const key = '/' + (p.split('/')[1] ?? '');
      (byPrefix[key] ??= []).push(r);
    }
    // Captured from main before the split. Order inside each prefix is the part
    // that carries meaning; if one of these changes, a gate may have moved
    // behind the route it guards.
    expect(byPrefix).toMatchSnapshot();
  });
});
