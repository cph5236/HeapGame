import { describe, it, expect } from 'vitest';
import {
  funnelQuery, crosstabQuery, traceQuery, isCrosstabDimension,
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
