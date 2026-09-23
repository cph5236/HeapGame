// admin/src/range.ts
//
// The time-range control shared by Overview and Analytics: a preset window
// plus a bucket size, where "Auto" follows the window (1h → per minute,
// 1y → per week) and the manual choices on offer are only the ones that make
// sense for the window — never a 1-point series, never one the server caps.

import { html, lsGet, lsSet, type Raw } from './ui';
import {
  autoBucket, bucketCount, bucketSeconds, isMetricsBucket, BUCKET_ORDER, MAX_SERIES_BUCKETS, type MetricsBucket,
} from '../../shared/metricsBuckets';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

export const PRESETS: readonly (readonly [string, string, number])[] = [
  ['1h', 'Last hour', HOUR],
  ['6h', 'Last 6 hours', 6 * HOUR],
  ['24h', 'Last 24 hours', DAY],
  ['7d', 'Last 7 days', 7 * DAY],
  ['30d', 'Last 30 days', 30 * DAY],
  ['90d', 'Last 90 days', 90 * DAY],
  ['1y', 'Last year', 365 * DAY],
];

export const BUCKET_NAMES: Record<MetricsBucket, string> = {
  '1m': '1 minute', '5m': '5 minutes', '15m': '15 minutes', '1h': '1 hour',
  '3h': '3 hours', '6h': '6 hours', '1d': '1 day', '1w': '1 week',
};

export interface RangeState { preset: string; bucket: MetricsBucket | 'auto' }

export interface Window {
  since: string; until: string; sinceMs: number; untilMs: number;
  /** The concrete bucket after resolving `auto`. */
  bucket: MetricsBucket;
  label: string;
}

const LS_RANGE = 'heapAdmin.range';

export function loadRange(): RangeState {
  try {
    const v = JSON.parse(lsGet(LS_RANGE) ?? 'null');
    if (v && PRESETS.some((p) => p[0] === v.preset) && (v.bucket === 'auto' || isMetricsBucket(v.bucket))) return v;
  } catch { /* fall through */ }
  return { preset: '7d', bucket: 'auto' };
}

export function saveRange(r: RangeState): void { lsSet(LS_RANGE, JSON.stringify(r)); }

function presetMs(preset: string): number {
  return (PRESETS.find((p) => p[0] === preset) ?? PRESETS[3])[2];
}

/** Bucket sizes worth offering for a window: it must span at least two WHOLE
 *  buckets (an unaligned 1h window touches two 6h buckets, but a 6h bucket is
 *  still no view of an hour), and stay under the server's point cap. */
export function bucketChoices(spanMs: number, now = Date.now()): MetricsBucket[] {
  return BUCKET_ORDER.filter((b) =>
    spanMs >= 2 * bucketSeconds(b) * 1000 && bucketCount(now - spanMs, now, b) <= MAX_SERIES_BUCKETS);
}

export function resolveWindow(r: RangeState, now = Date.now()): Window {
  const span = presetMs(r.preset);
  const sinceMs = now - span;
  const bucket = r.bucket !== 'auto' && bucketChoices(span, now).includes(r.bucket)
    ? r.bucket : autoBucket(sinceMs, now);
  return {
    since: new Date(sinceMs).toISOString(), until: new Date(now).toISOString(),
    sinceMs, untilMs: now, bucket,
    label: (PRESETS.find((p) => p[0] === r.preset) ?? PRESETS[3])[1],
  };
}

/** The window of the same length immediately before `w`, same bucket. */
export function previousWindow(w: Window): Window {
  const span = w.untilMs - w.sinceMs;
  return {
    ...w,
    sinceMs: w.sinceMs - span, untilMs: w.sinceMs,
    since: new Date(w.sinceMs - span).toISOString(), until: w.since,
    label: 'previous period',
  };
}

/** Markup for the range row. Wire it with `wireRange`. */
export function rangeControls(r: RangeState): Raw {
  const span = presetMs(r.preset);
  const choices = bucketChoices(span);
  const auto = autoBucket(Date.now() - span, Date.now());
  const selected = r.bucket !== 'auto' && choices.includes(r.bucket) ? r.bucket : 'auto';
  return html`
    <div class="seg" role="group" aria-label="Time range">
      ${PRESETS.map(([k, label]) => html`<button type="button" data-preset="${k}" title="${label}"
        aria-pressed="${k === r.preset ? 'true' : 'false'}">${k}</button>`)}
    </div>
    <label class="field" style="flex-direction:row;align-items:center;gap:8px">
      <span>Bucket</span>
      <select class="input" data-bucket style="width:auto">
        <option value="auto" ${selected === 'auto' ? 'selected' : ''}>Auto (${BUCKET_NAMES[auto]})</option>
        ${choices.map((b) => html`<option value="${b}" ${selected === b ? 'selected' : ''}>${BUCKET_NAMES[b]}</option>`)}
      </select>
    </label>`;
}

/** Wire ONCE a stable container that `rangeControls` is rendered into.
 *  `get` reads the current state, so re-rendering the controls needs no re-wire. */
export function wireRange(host: HTMLElement, get: () => RangeState, onChange: (r: RangeState) => void): void {
  host.addEventListener('click', (ev) => {
    const r = get();
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-preset]');
    if (!b || !host.contains(b)) return;
    const next: RangeState = { preset: b.dataset.preset!, bucket: r.bucket };
    // A manual bucket that no longer fits the new window falls back to auto.
    if (next.bucket !== 'auto' && !bucketChoices(presetMs(next.preset)).includes(next.bucket)) next.bucket = 'auto';
    saveRange(next);
    onChange(next);
  });
  host.addEventListener('change', (ev) => {
    const sel = (ev.target as HTMLElement).closest<HTMLSelectElement>('[data-bucket]');
    if (!sel) return;
    const r = get();
    const v = sel.value;
    const next: RangeState = { preset: r.preset, bucket: v === 'auto' || !isMetricsBucket(v) ? 'auto' : v };
    saveRange(next);
    onChange(next);
  });
}
