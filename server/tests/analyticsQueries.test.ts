import { describe, it, expect } from 'vitest';
import {
  funnelQuery, crosstabQuery, traceQuery, isCrosstabDimension,
  aeDateTime, CROSSTAB_DIMENSIONS,
} from '../src/platform/analytics/queries';

const IDS = ['p1', 'p2'];
const SINCE = '2026-09-01T00:00:00.000Z';
const UNTIL = '2026-10-01T00:00:00.000Z';

describe('query construction', () => {
  it('never interpolates player ids into the SQL text', () => {
    const { sql, params } = funnelQuery('heap_logs', IDS, SINCE, UNTIL);
    expect(sql).not.toContain('p1');
    expect(params).toContain('p1');
  });

  it('filters on timestamp and never puts double1 in WHERE or ORDER BY', () => {
    // AE quirk: double1 is SELECTable but not usable in WHERE/ORDER BY, and the
    // auto `timestamp` column is filterable but not SELECTable.
    for (const { sql } of [
      funnelQuery('heap_logs', IDS, SINCE, UNTIL),
      crosstabQuery('heap_logs', 'duration', IDS, SINCE, UNTIL),
      traceQuery('heap_logs', 'p1', SINCE, UNTIL, 100),
    ]) {
      const where = sql.slice(sql.indexOf('WHERE'));
      const orderBy = sql.includes('ORDER BY') ? sql.slice(sql.indexOf('ORDER BY')) : '';
      expect(where.split('GROUP BY')[0]).not.toContain('double1');
      expect(orderBy).not.toMatch(/ORDER BY[^)]*\btimestamp\b/);
    }
  });

  it('uses no JOIN or UNION — AE supports neither', () => {
    for (const { sql } of [
      funnelQuery('heap_logs', IDS, SINCE, UNTIL),
      crosstabQuery('heap_logs', 'cause', IDS, SINCE, UNTIL),
    ]) {
      expect(sql).not.toMatch(/\bJOIN\b/i);
      expect(sql).not.toMatch(/\bUNION\b/i);
    }
  });

  it('counts events with SUM(_sample_interval), never bare COUNT of events', () => {
    const { sql } = funnelQuery('heap_logs', IDS, SINCE, UNTIL);
    expect(sql).toContain('_sample_interval');
  });

  it('targets the dataset it is given', () => {
    expect(funnelQuery('heap_logs_staging', IDS, SINCE, UNTIL).sql).toContain('heap_logs_staging');
  });

  it('rejects an unknown crosstab dimension', () => {
    expect(isCrosstabDimension('duration')).toBe(true);
    expect(isCrosstabDimension('; DROP TABLE')).toBe(false);
    expect(isCrosstabDimension('payload')).toBe(false);
  });

  it('builds a different bucket expression per dimension', () => {
    const a = crosstabQuery('heap_logs', 'duration', IDS, SINCE, UNTIL).sql;
    const b = crosstabQuery('heap_logs', 'cause', IDS, SINCE, UNTIL).sql;
    expect(a).not.toBe(b);
    expect(a).toContain('double5');  // durationMs
    expect(b).toContain('blob8');    // cause
  });

  it('scopes a trace to exactly one player', () => {
    const { sql, params } = traceQuery('heap_logs', 'p9', SINCE, UNTIL, 50);
    expect(sql).toContain('index1 = ?');
    expect(params).toContain('p9');
  });
});

// ── Dialect invariants ──────────────────────────────────────────────────────
// Everything below encodes something learned by running these queries against
// the REAL Analytics Engine SQL API (2026-09-21). Each was a 422 at some point
// during that session. A stub client cannot catch any of them, so they are
// pinned here as shape assertions instead.

describe('AE dialect invariants', () => {
  const all = () => [
    funnelQuery('heap_logs', IDS, SINCE, UNTIL).sql,
    ...CROSSTAB_DIMENSIONS.map((d) => crosstabQuery('heap_logs', d, IDS, SINCE, UNTIL).sql),
    traceQuery('heap_logs', 'p1', SINCE, UNTIL, 10).sql,
  ];

  it('uses no function the dialect rejects', () => {
    // Verified absent from this dialect: multiIf, argMinIf, minIf, maxIf,
    // uniq, toUInt64, toFloat64, and CASE WHEN.
    for (const sql of all()) {
      expect(sql).not.toMatch(/\bmultiIf\b/i);
      expect(sql).not.toMatch(/\bargMinIf\b/i);
      expect(sql).not.toMatch(/\bminIf\b|\bmaxIf\b/i);
      expect(sql).not.toMatch(/\buniq\b/i);
      expect(sql).not.toMatch(/\btoUInt64\b|\btoFloat64\b/i);
      expect(sql).not.toMatch(/\bCASE\s+WHEN\b/i);
    }
  });

  it('never multiplies a sample interval by a boolean', () => {
    // `_sample_interval * (blob2 = 'x')` is rejected: "cannot combine the
    // Integer and Boolean types with the * operator". sumIf is the supported
    // spelling and is what these queries use.
    for (const sql of all()) {
      expect(sql).not.toMatch(/_sample_interval\s*\*\s*\(/);
    }
  });

  it('never calls toDate() on a millisecond double', () => {
    // toDate() rejects a DOUBLE argument outright; the day label goes through
    // formatDateTime(toDateTime(...)) instead.
    for (const sql of all()) expect(sql).not.toMatch(/\btoDate\s*\(/);
  });

  it('writes every LARGE numeric literal with a non-zero fraction', () => {
    // A large numeric literal whose fraction is zero comes back typed UInt64
    // no matter how it is written, and then clashes with the DOUBLE it sits
    // beside in an if(). `99999999999999.0` fails; `99999999999999.5` works.
    // Small literals (the `0.0` fallbacks) are unaffected and stay Float64,
    // so the rule is about magnitude, not about every literal.
    const LARGE = 1e6;
    for (const d of CROSSTAB_DIMENSIONS) {
      const sql = crosstabQuery('heap_logs', d, IDS, SINCE, UNTIL).sql;
      for (const lit of sql.match(/\d+\.\d+/g) ?? []) {
        if (Number(lit) < LARGE) continue;
        expect(lit, `large literal ${lit} in dimension ${d} must not end in .0`)
          .not.toMatch(/\.0+$/);
      }
    }
  });

  it('nests at most one subquery deep', () => {
    // "cannot nest subqueries inside subqueries" — two levels total is the
    // ceiling, which is why the crosstab inlines its aggregates rather than
    // aliasing them in a middle layer.
    for (const sql of all()) {
      const depth = (() => {
        let cur = 0, max = 0;
        for (const m of sql.matchAll(/FROM\s*\(|\)/g)) {
          if (m[0].startsWith('FROM')) max = Math.max(max, ++cur);
          else if (cur > 0 && /^\)$/.test(m[0]) === false) { /* noop */ }
        }
        return max;
      })();
      expect(depth).toBeLessThanOrEqual(1);
    }
  });

  it('formats timestamps the only way toDateTime accepts', () => {
    // Fractional seconds and the trailing Z are both rejected.
    expect(aeDateTime('2026-09-21T00:00:00.000Z')).toBe('2026-09-21 00:00:00');
    expect(aeDateTime('2026-09-21T13:45:09.999Z')).toBe('2026-09-21 13:45:09');
    expect(() => aeDateTime('not-a-date')).toThrow();

    for (const sql of all()) expect(sql).toContain('toDateTime(?)');
    for (const p of funnelQuery('heap_logs', IDS, SINCE, UNTIL).params.slice(0, 2)) {
      expect(String(p)).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
    }
  });

  it('measures the funnel day-span over gameplay rows only', () => {
    // `error`/`warn` bypass the analytics opt-out and land in this dataset with
    // the same double1 timestamp as events, so a bare min/max(double1) counted
    // a player whose client merely crashed on two days as having "returned".
    // Both extremes must therefore be conditional — and there is no minIf/maxIf
    // in this dialect, hence argMin/argMax with an unreachable sort position.
    const { sql } = funnelQuery('heap_logs', IDS, SINCE, UNTIL);
    expect(sql).not.toMatch(/\bmin\(double1\)/);
    expect(sql).not.toMatch(/\bmax\(double1\)/);
    for (const day of ['firstDay', 'lastDay']) {
      const expr = sql.slice(0, sql.indexOf(`AS ${day}`));
      expect(expr.slice(expr.lastIndexOf('formatDateTime'))).toContain(`blob1 = 'event'`);
    }
    // The argMax ordering floor must stay positive-side; see ORDER_FLOOR.
    expect(sql).not.toContain('-99999999999999');
  });

  it('gives players with no finished run their own bucket', () => {
    // argMinWhere's fallback is 0 / '' for a player with no run:end. Without
    // the guard they would land in the lowest bucket ('0-15s', '0-100') and
    // inflate exactly the bucket the churn analysis cares most about.
    for (const d of ['duration', 'height', 'score', 'cause'] as const) {
      expect(crosstabQuery('heap_logs', d, IDS, SINCE, UNTIL).sql).toContain('no finished run');
    }
  });
});
