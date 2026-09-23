// admin/src/chart.ts
//
// Hand-rolled SVG charts. A handful of forms, no charting dependency.
//
// Counts per time bucket are drawn as bars, not a line: each bucket is a
// discrete tally, and a line between two buckets implies values in between
// that do not exist.

import { html, mount, fmtNum, type Raw } from './ui';
import { bucketSeconds, type MetricsBucket, type SeriesPoint } from '../../shared/metricsBuckets';

const DAY_S = 86_400;

/** Axis/tooltip label for a bucket start. Sub-day buckets read in local time;
 *  day and week buckets ARE UTC days, so they are labelled as such. */
export function bucketLabel(iso: string, bucket: MetricsBucket, long = false): string {
  const d = new Date(iso);
  const size = bucketSeconds(bucket);
  if (size >= DAY_S) {
    const day = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC', ...(long ? { year: 'numeric' } : {}) });
    return bucket === '1w' && long ? `Week of ${day}` : day;
  }
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  return long ? `${d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}, ${time}` : time;
}

/** A tooltip range, e.g. "Sep 23, 14:00 – 14:15". */
function bucketRange(iso: string, bucket: MetricsBucket): string {
  const size = bucketSeconds(bucket);
  if (size === DAY_S) return bucketLabel(iso, bucket, true) + ' (UTC)';
  if (size > DAY_S) return bucketLabel(iso, bucket, true);
  const end = new Date(Date.parse(iso) + size * 1000);
  return `${bucketLabel(iso, bucket, true)} – ${end.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })}`;
}

/** A round ceiling for the y axis: 1, 2, 5 × 10^n. */
function niceMax(v: number): number {
  if (v <= 4) return Math.max(1, Math.ceil(v));
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

export interface SeriesChartOpts {
  bucket: MetricsBucket;
  /** Noun for the tooltip, e.g. "new players". */
  unit: string;
  height?: number;
}

/**
 * Bars per bucket with a snapping crosshair tooltip. Re-renders on resize.
 * Keyboard: focus the chart, then ←/→ step through buckets.
 */
export function seriesChart(host: HTMLElement, points: SeriesPoint[], o: SeriesChartOpts): void {
  host.classList.add('chart');
  host.classList.remove('loading');
  const H = o.height ?? 220;
  const PAD_L = 36, PAD_R = 8, PAD_T = 10, PAD_B = 26;
  const n = points.length;
  const max = niceMax(Math.max(0, ...points.map((p) => p.count)));
  let geom = { W: 0, slot: 0, plotH: 0 };
  let active = -1;

  const yOf = (v: number) => PAD_T + geom.plotH - (v / max) * geom.plotH;

  /** Hover state only — the SVG is not rebuilt, so focus survives. */
  const setActive = (i: number) => {
    active = i;
    host.querySelectorAll<SVGPathElement>('path.bar').forEach((b) =>
      b.classList.toggle('dim', active >= 0 && Number(b.dataset.i) !== active));
    const cross = host.querySelector<SVGLineElement>('line.cross')!;
    const tip = host.querySelector<HTMLElement>('.tip')!;
    if (active < 0 || !points[active]) {
      cross.style.display = 'none';
      tip.style.display = 'none';
      return;
    }
    const cx = PAD_L + active * geom.slot + geom.slot / 2;
    cross.setAttribute('x1', String(cx));
    cross.setAttribute('x2', String(cx));
    cross.style.display = '';
    // The SVG is drawn 1:1 with the host's CSS width, so viewBox x == px.
    tip.style.left = `${cx}px`;
    tip.style.top = `${Math.max(PAD_T + 30, yOf(points[active].count))}px`;
    tip.style.display = '';
    mount(tip, html`<b>${fmtNum(points[active].count)}</b><span>${o.unit} · ${bucketRange(points[active].t, o.bucket)}</span>`);
  };

  const draw = () => {
    const W = Math.max(280, host.clientWidth);
    const plotW = W - PAD_L - PAD_R;
    const plotH = H - PAD_T - PAD_B;
    const slot = n ? plotW / n : plotW;
    geom = { W, slot, plotH };
    // A 2px surface gap between bars once they are wide enough to afford it.
    const gap = slot > 6 ? 2 : slot > 3 ? 1 : 0;
    const barW = Math.max(1, slot - gap);

    const ticks = [0, max / 2, max].filter((t, i, a) => a.indexOf(t) === i && Number.isInteger(t));
    const grid = ticks.map((t) => html`
      <line class="grid-line" x1="${PAD_L}" x2="${W - PAD_R}" y1="${yOf(t)}" y2="${yOf(t)}"/>
      <text class="axis-text" x="${PAD_L - 6}" y="${yOf(t) + 4}" text-anchor="end">${fmtNum(t)}</text>`);

    // Labels never closer than ~70px. When a label step spans a day or more
    // of sub-day buckets, a time of day alone repeats ("5 PM, 5 PM, …"), so
    // the label becomes the date instead.
    const every = Math.max(1, Math.ceil(n / Math.max(1, Math.floor(plotW / 70))));
    const size = bucketSeconds(o.bucket);
    const byDate = size < DAY_S && every * size >= DAY_S;
    const axisLabel = (iso: string) => byDate
      ? new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
      : bucketLabel(iso, o.bucket);
    const xl = points.map((p, i) => i % every === 0 ? html`
      <text class="axis-text" x="${PAD_L + i * slot + slot / 2}" y="${H - 8}" text-anchor="middle">${axisLabel(p.t)}</text>` : '');

    const bars = points.map((p, i) => {
      if (p.count === 0) return '';
      const top = yOf(p.count);
      const h = PAD_T + plotH - top;
      const x = PAD_L + i * slot + gap / 2;
      // Rounded data-end, square baseline end.
      const r = Math.min(3, barW / 2, h);
      return html`<path class="bar" data-i="${i}" d="M${x},${PAD_T + plotH}V${top + r}q0,-${r} ${r},-${r}h${barW - 2 * r}q${r},0 ${r},${r}V${PAD_T + plotH}z"/>`;
    });

    mount(host, html`
      <svg viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" tabindex="0" role="img"
           aria-label="${`${o.unit} per bucket — use arrow keys to step through buckets`}">
        ${grid}${bars}
        <line class="baseline" x1="${PAD_L}" x2="${W - PAD_R}" y1="${PAD_T + plotH}" y2="${PAD_T + plotH}"/>
        <line class="cross" y1="${PAD_T}" y2="${PAD_T + plotH}" style="display:none"/>
        ${xl}
        ${points.every((p) => p.count === 0) ? html`<text class="axis-text" x="${PAD_L + plotW / 2}" y="${PAD_T + plotH / 2}"
          text-anchor="middle" style="font-size:13px">No ${o.unit} in this range</text>` : ''}
      </svg>
      <div class="tip" style="display:none"></div>`);

    const svg = host.querySelector('svg')!;
    svg.addEventListener('pointermove', (ev) => {
      const r = svg.getBoundingClientRect();
      const x = ((ev.clientX - r.left) / r.width) * W - PAD_L;
      const i = Math.max(0, Math.min(n - 1, Math.floor(x / slot)));
      if (i !== active) setActive(i);
    });
    svg.addEventListener('pointerleave', () => setActive(-1));
    svg.addEventListener('blur', () => setActive(-1));
    svg.addEventListener('keydown', (ev) => {
      if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
      ev.preventDefault();
      setActive(Math.max(0, Math.min(n - 1, (active < 0 ? (ev.key === 'ArrowLeft' ? n : -1) : active) + (ev.key === 'ArrowLeft' ? -1 : 1))));
    });
    active = -1;
  };

  draw();
  const h = host as HTMLElement & { _ro?: ResizeObserver };
  h._ro?.disconnect();
  let lastW = host.clientWidth;
  const ro = new ResizeObserver(() => {
    if (!host.isConnected) { ro.disconnect(); return; }
    if (host.clientWidth !== lastW) { lastW = host.clientWidth; draw(); }
  });
  ro.observe(host);
  h._ro = ro;
}

/** The accessible table behind a series chart. */
export function seriesTable(points: SeriesPoint[], bucket: MetricsBucket, unit: string): Raw {
  const nonZero = points.filter((p) => p.count > 0);
  return html`<details class="table-view"><summary>Show as table (${nonZero.length} non-empty of ${points.length} buckets)</summary>
    <div class="table-wrap"><table class="t"><thead><tr><th>Bucket</th><th class="num">${unit}</th></tr></thead>
    <tbody>${nonZero.length ? nonZero.map((p) => html`<tr><td>${bucketRange(p.t, bucket)}</td><td class="num">${fmtNum(p.count)}</td></tr>`)
      : html`<tr><td colspan="2" class="empty">Every bucket is zero.</td></tr>`}</tbody></table></div></details>`;
}

export interface HBarRow { name: string; value: number; of: number; note?: string }

/** Horizontal bars, each scaled to `of` (e.g. the cohort), with value and share. */
export function hbars(rows: HBarRow[], scaleMax?: number): Raw {
  const max = scaleMax ?? Math.max(1, ...rows.map((r) => r.value));
  return html`<div class="hbars">${rows.map((r) => html`
    <div class="hbar" title="${`${r.name}: ${r.value} of ${r.of}`}">
      <div class="name">${r.name}</div>
      <div class="track"><div class="fill" style="width:${max > 0 ? (r.value / max) * 100 : 0}%"></div></div>
      <div class="val"><b>${fmtNum(r.value)}</b><span>${r.of > 0 ? ((r.value / r.of) * 100).toFixed(1) : '0.0'}%</span></div>
      ${r.note ? html`<div class="step">${r.note}</div>` : ''}
    </div>`)}</div>`;
}
