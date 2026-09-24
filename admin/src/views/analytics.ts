// admin/src/views/analytics.ts
//
// One time range scopes every panel on the page. The bucket follows the range
// ("Auto") unless the operator picks one; the choices on offer are only those
// the window can support.

import type { Ctx } from '../ctx';
import {
  getNewPlayers, getFunnel, getCrosstab, CROSSTAB_DIMENSIONS, type CrosstabDimension, type FunnelStages,
} from '../data';
import {
  html, mount, $, toast, fmtNum, fmtPct, deltaText, errMessage, lsGet, lsSet, type Raw,
} from '../ui';
import { seriesChart, seriesTable, bucketLabel, hbars } from '../chart';
import {
  loadRange, resolveWindow, previousWindow, rangeControls, wireRange, BUCKET_NAMES, type RangeState,
} from '../range';
import { aeUnavailable, sampledNote, openPlayer } from './playerDrawer';

const LS_DIM = 'heapAdmin.crosstabDim';

const FUNNEL: [keyof FunnelStages, string][] = [
  ['cohort', 'New players'],
  ['startedRun1', 'Started a run'],
  ['finishedRun1', 'Finished a run'],
  ['startedRun2', 'Started a 2nd run'],
  ['startedRun3', 'Started a 3rd run'],
  ['returnedLater', 'Came back another day'],
];

export async function analyticsView(ctx: Ctx): Promise<void> {
  let range: RangeState = loadRange();
  let dim = (lsGet(LS_DIM) ?? 'duration') as CrosstabDimension;
  if (!CROSSTAB_DIMENSIONS.some(([k]) => k === dim)) dim = 'duration';

  mount(ctx.root, html`
    <div class="page-head"><div><h1>Analytics</h1>
      <p>Who's arriving and whether they stick. The range below applies to every panel.</p></div></div>
    <div class="filters" id="anRange"></div>

    <div class="panel">
      <div class="panel-head"><h2>New players</h2><span class="sub" id="acqSub"></span></div>
      <div class="stats" id="acqStats" style="margin-bottom:18px"></div>
      <div id="acqChart" class="chart loading" style="min-height:240px"></div>
      <div id="acqTable"></div>
      <p class="muted" style="margin:12px 0 0;font-size:12.5px">Counted at a player's first authenticated save, not at install — someone who never saves never appears, and signing in to Play Games later counts the same person twice.</p>
    </div>

    <div class="grid two">
      <div class="panel">
        <div class="panel-head"><h2>First-session funnel</h2><span class="sub">players who arrived in this range</span></div>
        <div id="fnBody" class="muted">Loading…</div>
      </div>
      <div class="panel">
        <div class="panel-head"><h2>What predicts a second run</h2>
          <div class="tools"><select class="input" id="ctDim" style="width:auto">
            ${CROSSTAB_DIMENSIONS.map(([k, label]) => html`<option value="${k}" ${k === dim ? 'selected' : ''}>${label}</option>`)}
          </select></div></div>
        <div id="ctBody" class="muted">Loading…</div>
      </div>
    </div>

    <div class="panel">
      <div class="panel-head"><h2>Player trace</h2><span class="sub">every event one player sent, newest first</span></div>
      <form id="trForm" style="display:flex;gap:8px;flex-wrap:wrap">
        <input class="input" id="trId" placeholder="Player id (GUID or Play Games id)" style="flex:1;min-width:240px" spellcheck="false">
        <button class="btn primary" type="submit">Open player</button>
      </form>
    </div>`);

  const rangeHost = $('#anRange', ctx.root);
  const renderRange = () => mount(rangeHost, rangeControls(range));
  renderRange();
  wireRange(rangeHost, () => range, (r) => { range = r; renderRange(); loadAll(); });

  $('#ctDim', ctx.root).addEventListener('change', (ev) => {
    dim = (ev.target as HTMLSelectElement).value as CrosstabDimension;
    lsSet(LS_DIM, dim);
    loadCrosstab();
  });
  $('#trForm', ctx.root).addEventListener('submit', (ev) => {
    ev.preventDefault();
    const id = (ctx.root.querySelector('#trId') as HTMLInputElement).value.trim();
    if (!id) { toast('Paste a player id to open', 'err'); return; }
    openPlayer(id);
  });

  // Each loader stamps a token; a response for a superseded range is dropped.
  let token = 0;

  async function loadAcquisition(t: number): Promise<void> {
    const w = resolveWindow(range);
    const chartHost = $('#acqChart', ctx.root);
    chartHost.classList.add('loading');
    mount($('#acqSub', ctx.root), html`${w.label}, per ${BUCKET_NAMES[w.bucket]}`);
    try {
      const prev = previousWindow(w);
      const [cur, before] = await Promise.all([
        getNewPlayers(w.since, w.until, w.bucket),
        getNewPlayers(prev.since, prev.until, w.bucket),
      ]);
      if (!ctx.alive() || t !== token) return;
      const peak = cur.rows.reduce((b, r) => (r.count > b.count ? r : b), cur.rows[0] ?? { t: w.since, count: 0 });
      const days = (w.untilMs - w.sinceMs) / 86_400_000;
      const perDay = cur.total / days;
      mount($('#acqStats', ctx.root), html`
        ${stat('New players', fmtNum(cur.total), html`${deltaText(cur.total, before.total)} vs previous period (${fmtNum(before.total)})`)}
        ${stat('Per day', perDay >= 10 ? fmtNum(Math.round(perDay)) : perDay.toFixed(1), days < 1 ? 'extrapolated from this range' : `average over ${Math.round(days)} days`)}
        ${stat('Busiest bucket', peak.count ? fmtNum(peak.count) : '—', peak.count ? bucketLabel(peak.t, cur.bucket, true) : 'nobody new yet')}`);
      // A pre-adaptive worker may have served a coarser bucket than asked for.
      mount($('#acqSub', ctx.root), html`${w.label}, per ${BUCKET_NAMES[cur.bucket]}`);
      seriesChart(chartHost, cur.rows, { bucket: cur.bucket, unit: 'new players', height: 240 });
      mount($('#acqTable', ctx.root), html`${cur.legacy ? html`<div class="note warn" style="margin-top:12px"><div>
        <b>This environment runs an older worker.</b> Counts are exact, but buckets finer than 1 hour aren't available
        until it's redeployed from main.</div></div>` : ''}${seriesTable(cur.rows, cur.bucket, 'New players')}`);
    } catch (e) {
      if (!ctx.alive() || t !== token) return;
      chartHost.classList.remove('loading');
      mount($('#acqStats', ctx.root), html``);
      mount(chartHost, html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
      mount($('#acqTable', ctx.root), html``);
    }
  }

  async function loadFunnel(t: number): Promise<void> {
    const w = resolveWindow(range);
    const host = $('#fnBody', ctx.root);
    host.style.opacity = '0.5';
    try {
      const d = await getFunnel(w.since, w.until);
      if (!ctx.alive() || t !== token) return;
      const s = d.stages;
      const rows = FUNNEL.map(([k, label], i) => {
        const prevVal = i > 0 ? s[FUNNEL[i - 1][0]] : 0;
        return {
          name: label, value: s[k], of: s.cohort,
          note: i > 0 && k !== 'returnedLater' && prevVal > 0 ? `${fmtPct(s[k] / prevVal, 0)} of the step above` : undefined,
        };
      });
      mount(host, s.cohort
        ? html`${sampledNote(d)}<div style="margin-top:${d.sampled || d.truncated ? '12px' : '0'}">${hbars(rows, s.cohort)}</div>`
        : html`<div class="empty">Nobody new arrived in this range.</div>`);
    } catch (e) {
      if (!ctx.alive() || t !== token) return;
      mount(host, aeUnavailable(e) ?? html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
    } finally {
      host.style.opacity = '';
    }
  }

  async function loadCrosstab(t = token): Promise<void> {
    const w = resolveWindow(range);
    const host = $('#ctBody', ctx.root);
    host.style.opacity = '0.5';
    const asked = dim;
    try {
      const d = await getCrosstab(asked, w.since, w.until);
      if (!ctx.alive() || t !== token || asked !== dim) return;
      mount(host, d.rows.length ? html`${sampledNote(d)}
        <p class="muted" style="margin:0 0 12px;font-size:12.5px">Share of each group that started a second run.</p>
        ${rateBars(d.rows)}` : html`<div class="empty">Nobody new arrived in this range.</div>`);
    } catch (e) {
      if (!ctx.alive() || t !== token) return;
      mount(host, aeUnavailable(e) ?? html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
    } finally {
      host.style.opacity = '';
    }
  }

  function loadAll(): void {
    const t = ++token;
    void loadAcquisition(t);
    void loadFunnel(t);
    void loadCrosstab(t);
  }
  loadAll();
}

function stat(label: string, value: string, foot: Raw | string): Raw {
  return html`<div class="stat" style="background:var(--panel-2)"><div class="label">${label}</div><div class="value">${value}</div><div class="foot">${foot}</div></div>`;
}

/** Rate bars: the fill is the rate (0–100%), the label carries the group size,
 *  so a 100% from a group of 1 reads as the anecdote it is. */
function rateBars(rows: { bucket: string; cohort: number; returned: number }[]): Raw {
  return html`<div class="hbars">${rows.map((r) => {
    const rate = r.cohort > 0 ? r.returned / r.cohort : 0;
    return html`<div class="hbar" title="${`${r.bucket}: ${r.returned} of ${r.cohort}`}">
      <div class="name">${r.bucket || '(none)'}</div>
      <div class="track"><div class="fill" style="width:${rate * 100}%"></div></div>
      <div class="val"><b>${fmtPct(rate, 0)}</b><span>of ${fmtNum(r.cohort)}</span></div></div>`;
  })}</div>`;
}
