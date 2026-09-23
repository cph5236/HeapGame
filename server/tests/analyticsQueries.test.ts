import { describe, it, expect } from 'vitest';
import {
  funnelQuery, crosstabQuery, traceQuery, isCrosstabDimension,
  aeDateTime, CROSSTAB_DIMENSIONS, compareBuckets, BUCKET_ORDER, NO_RUN_BUCKET,
} from '../src/platform/analytics/queries';
import { projectEventMetrics } from '../../shared/logging/aeProjection';

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

// ── Bucket display order ────────────────────────────────────────────────────
// Bucket labels are strings, and sorting them as strings scrambles every scale
// with a mixed-width number in it. The crosstab card exists to show a
// progression, so the order is part of its correctness, not a cosmetic detail.

describe('bucket ordering', () => {
  const RANGED = ['duration', 'height', 'score'] as const;

  it('orders ranged buckets by magnitude, not alphabetically', () => {
    for (const d of RANGED) {
      const order = BUCKET_ORDER[d]!;
      const shuffled = [...order].reverse();
      expect(shuffled.sort((a, b) => compareBuckets(d, a, b))).toEqual([...order]);
    }
  });

  it('fixes the specific inversions plain string sort produces', () => {
    // These are the two scales that actually broke: '120s+' sorted second and
    // '2000+' sorted third.
    expect([...BUCKET_ORDER.duration!].sort((a, b) => a.localeCompare(b))[1]).toBe('120s+');
    expect([...BUCKET_ORDER.duration!].sort((a, b) => compareBuckets('duration', a, b)).at(-1))
      .toBe('120s+');
    expect([...BUCKET_ORDER.height!].sort((a, b) => compareBuckets('height', a, b)).at(-1))
      .toBe('2000+');
  });

  it('sorts "no finished run" last and unknown labels after the scale', () => {
    const sorted = ['120s+', NO_RUN_BUCKET, '0-15s', 'mystery']
      .sort((a, b) => compareBuckets('duration', a, b));
    expect(sorted).toEqual(['0-15s', '120s+', 'mystery', NO_RUN_BUCKET]);
  });

  it('falls back to alphabetical for open-ended dimensions', () => {
    // cause/platform/appVersion have no natural scale, so they are absent from
    // BUCKET_ORDER by design.
    for (const d of ['cause', 'platform', 'appVersion'] as const) {
      expect(BUCKET_ORDER[d]).toBeUndefined();
      expect(['b', 'a'].sort((x, y) => compareBuckets(d, x, y))).toEqual(['a', 'b']);
    }
  });

  it('lists every label the SQL can actually emit', () => {
    // BUCKET_ORDER lives apart from bucketExpr, so it can drift. Any ranged
    // label present in the generated SQL but missing here would silently sort
    // to the end of the chart instead of its place on the scale.
    for (const d of [...RANGED, 'placed', 'submitted'] as const) {
      // Strip the literals that are MATCHED rather than emitted — the level
      // and event-name comparisons — so what remains is the label set.
      const sql = crosstabQuery('heap_logs', d, IDS, SINCE, UNTIL).sql
        .replace(/blob\d+ = '[^']*'/g, '');
      const emitted = (sql.match(/'[^']*'/g) ?? [])
        .map((s) => s.slice(1, -1))
        .filter((s) => s && s !== NO_RUN_BUCKET);
      for (const label of emitted) {
        expect(BUCKET_ORDER[d], `dimension ${d} emits '${label}'`).toContain(label);
      }
    }
  });
});

// ── Column contract ─────────────────────────────────────────────────────────
// aeProjection.ts decides which run fact goes in which AE slot, positionally;
// queries.ts hardcodes the resulting column names into SQL text. Nothing ties
// them together — AE columns are untyped strings interpolated into a query, so
// reordering the projection array compiles fine and silently makes every
// crosstab read the wrong number. AE data is append-only, so it cannot be
// renumbered after the fact either.

describe('AE column contract', () => {
  // Distinct values so each field's slot is identifiable by value.
  const RUN_END = {
    type: 'run:end', heapId: 'h', mode: 'classic', cause: 'death',
    score: 1001, height: 1002, kills: 1003, durationMs: 1004, pickupBonus: 1005,
    upgrades: {}, pickups: {},
  } as unknown as Parameters<typeof projectEventMetrics>[0];

  /** The AE column a projected double lands in: doubles[0] is double2, because
   *  the sink writes the envelope timestamp into double1 first. */
  const columnOf = (value: number): string => {
    const doubles = projectEventMetrics(RUN_END)?.doubles ?? [];
    const i = doubles.indexOf(value);
    expect(i, `projection no longer emits ${value}`).toBeGreaterThanOrEqual(0);
    return `double${i + 2}`;
  };

  it('reads each dimension from the column the projection actually writes', () => {
    const sqlFor = (d: 'duration' | 'height' | 'score') =>
      crosstabQuery('heap_logs', d, IDS, SINCE, UNTIL).sql;
    expect(sqlFor('duration')).toContain(columnOf(1004));  // durationMs
    expect(sqlFor('height')).toContain(columnOf(1002));    // height
    expect(sqlFor('score')).toContain(columnOf(1001));     // score
  });

  it('reads cause from the column the projection writes it to', () => {
    const blobs = projectEventMetrics(RUN_END)?.blobs ?? [];
    // blobs[0] is blob8 — the sink fills blob1..blob7 with envelope fields.
    expect(blobs.indexOf('death')).toBe(0);
    expect(crosstabQuery('heap_logs', 'cause', IDS, SINCE, UNTIL).sql).toContain('blob8');
  });
});

// ── First-run guard ─────────────────────────────────────────────────────────

describe('first-run dimensions', () => {
  it('wraps every FIRST_OF_RUN dimension in the no-finished-run guard', () => {
    // A dimension built from the player's first run:end must handle a player
    // who has none — argMinWhere's fallback would otherwise put them in the
    // lowest bucket, as though they had finished a very bad run. The current
    // four all do; this makes it structural for the next one added rather than
    // a convention someone has to remember.
    for (const d of CROSSTAB_DIMENSIONS) {
      const sql = crosstabQuery('heap_logs', d, IDS, SINCE, UNTIL).sql;
      const usesFirstRun = sql.includes("argMin(if(blob1 = 'event' AND blob2 = 'run:end'");
      if (!usesFirstRun) continue;
      expect(sql, `dimension '${d}' reads the first run without a no-run guard`)
        .toContain(NO_RUN_BUCKET);
    }
  });
});

describe('event matching is discriminated by level', () => {
  // The sink writes `blob2 = eventType ?? message ?? ''` for EVERY row, so an
  // error/warn row's free-text message lands in the same column these queries
  // match event names against. /log is unauthenticated, so a posted
  // {level:'error', message:'run:start'} is a reachable way to inflate a
  // funnel stage. Every blob2 comparison must be paired with blob1 = 'event'.
  const bareBlob2 = /(?<!blob1 = 'event' AND )blob2 = '/g;

  it('funnel never matches blob2 without the event level', () => {
    const sql = funnelQuery('heap_logs', IDS, SINCE, UNTIL).sql;
    expect(sql.match(bareBlob2)).toBeNull();
  });

  it('every crosstab dimension never matches blob2 without the event level', () => {
    for (const d of CROSSTAB_DIMENSIONS) {
      const sql = crosstabQuery('heap_logs', d, IDS, SINCE, UNTIL).sql;
      expect(sql.match(bareBlob2), `dimension '${d}' matches blob2 unguarded`).toBeNull();
    }
  });
});
