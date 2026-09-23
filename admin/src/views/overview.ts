// admin/src/views/overview.ts
//
// The landing page: is the game healthy, is anyone new arriving, and is there
// anything waiting on me? Every tile loads on its own, so one failing read
// (no secret yet, AE not configured) never blanks the rest.

import type { Ctx } from '../ctx';
import { envLabel, secretFor, currentEnv, ApiError } from '../api';
import {
  getTotals, getNewPlayers, getHeaps, listBans, listFeedback, listCodes, heapHeightLabel, heapName,
} from '../data';
import { html, mount, $, fmtNum, deltaText, relTime, errMessage, type Raw } from '../ui';
import { seriesChart } from '../chart';
import { unreadCount, refreshFeedbackBadge } from '../badges';
import { INFINITE_HEAP_ID } from '../../../shared/heapTypes';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

function tile(label: string, value: Raw | string, foot: Raw | string = '', href?: string): Raw {
  const inner = html`<div class="label">${label}</div><div class="value">${value}</div><div class="foot">${foot}</div>`;
  return href ? html`<a class="stat" href="${href}">${inner}</a>` : html`<div class="stat">${inner}</div>`;
}

const pending = (label: string) => tile(label, html`<span class="muted">…</span>`);
const failed = (label: string, e: unknown) => tile(label, html`<span class="muted">—</span>`,
  e instanceof ApiError && e.status === 404
    ? html`<span title="${errMessage(e)}">Needs the newer worker</span>`
    : html`<span title="${errMessage(e)}">Couldn't load</span>`);

export async function overviewView(ctx: Ctx): Promise<void> {
  const env = currentEnv();
  mount(ctx.root, html`
    <div class="page-head"><div><h1>Overview</h1>
      <p>${envLabel(env)} at a glance.</p></div></div>
    ${!secretFor(env) && env !== 'local' ? html`<div class="note warn" style="margin-bottom:16px"><div><b>No admin secret saved for ${envLabel(env)}.</b> Most numbers below need one — open the environment switcher at the bottom of the sidebar.</div></div>` : ''}
    <div class="stats" id="ovStats">
      <div id="t-new24">${pending('New players · 24h')}</div>
      <div id="t-new7">${pending('New players · 7 days')}</div>
      <div id="t-total">${pending('Players all time')}</div>
      <div id="t-fb">${pending('Unread feedback')}</div>
      <div id="t-bans">${pending('Shadow-banned')}</div>
      <div id="t-codes">${pending('Live reward codes')}</div>
    </div>
    <div class="grid side-wide" style="margin-top:16px">
      <div class="panel"><div class="panel-head"><h2>New players</h2><span class="sub">last 7 days, every 3 hours</span>
        <div class="tools"><a class="btn sm" href="#/analytics">Open analytics</a></div></div>
        <div id="ovChart" class="chart loading" style="height:200px"></div></div>
      <div class="panel"><div class="panel-head"><h2>Latest feedback</h2><div class="tools"><a class="btn sm" href="#/feedback">All feedback</a></div></div>
        <div id="ovFb" class="muted">Loading…</div></div>
    </div>
    <div class="panel"><div class="panel-head"><h2>Heaps</h2><div class="tools"><a class="btn sm" href="#/heaps">Manage heaps</a></div></div>
      <div id="ovHeaps" class="muted">Loading…</div></div>`);

  const put = (id: string, content: Raw) => { if (ctx.alive()) mount($(`#${id}`, ctx.root), content); };
  const now = Date.now();
  const iso = (ms: number) => new Date(ms).toISOString();

  const newPlayers = async (span: number, id: string, label: string) => {
    try {
      const [cur, prev] = await Promise.all([
        getNewPlayers(iso(now - span), iso(now), span === DAY ? '1h' : '3h'),
        getNewPlayers(iso(now - 2 * span), iso(now - span), span === DAY ? '1h' : '3h'),
      ]);
      put(id, tile(label, fmtNum(cur.total), html`${deltaText(cur.total, prev.total)} vs previous ${span === DAY ? '24h' : '7 days'}`, '#/analytics'));
      if (span === 7 * DAY && ctx.alive()) seriesChart($('#ovChart', ctx.root), cur.rows, { bucket: cur.bucket, unit: 'new players', height: 200 });
    } catch (e) {
      put(id, failed(label, e));
      if (span === 7 * DAY) put('ovChart', html`<div class="note"><div>${errMessage(e)}</div></div>`);
    }
  };

  void newPlayers(DAY, 't-new24', 'New players · 24h');
  void newPlayers(7 * DAY, 't-new7', 'New players · 7 days');

  getTotals()
    .then((t) => put('t-total', tile('Players all time', fmtNum(t.players), 'first authenticated save')))
    .catch((e) => put('t-total', failed('Players all time', e)));

  listBans()
    .then((b) => put('t-bans', tile('Shadow-banned', fmtNum(b.bans.length),
      b.bans[0] ? `latest ${relTime(b.bans[0].banned_at)}` : 'none', '#/players?tab=banned')))
    .catch((e) => put('t-bans', failed('Shadow-banned', e)));

  listCodes()
    .then((c) => {
      const nowIso = new Date().toISOString();
      const live = c.codes.filter((x) => !(x.expires_at && x.expires_at <= nowIso)
        && !(x.max_redemptions > 0 && x.redeemed_count >= x.max_redemptions));
      const redeemed = c.codes.reduce((n, x) => n + x.redeemed_count, 0);
      put('t-codes', tile('Live reward codes', fmtNum(live.length), `${fmtNum(redeemed)} redemptions all time`, '#/codes'));
    })
    .catch((e) => put('t-codes', failed('Live reward codes', e)));

  // One fresh GET /heaps, shared by the feedback panel (for heap names) and
  // the heaps table.
  const heapsP = getHeaps(true);

  Promise.all([listFeedback(), heapsP])
    .then(([rows, heaps]) => {
      refreshFeedbackBadge(rows);
      const unread = unreadCount(rows);
      const bugs = rows.filter((r) => r.category === 'bug').length;
      put('t-fb', tile('Unread feedback', fmtNum(unread), `${fmtNum(rows.length)} total · ${fmtNum(bugs)} bugs`, '#/feedback'));
      const latest = [...rows].sort((a, b) => b.id - a.id).slice(0, 4);
      put('ovFb', latest.length ? html`<div class="fb">${latest.map((r) => html`<div class="fb-item">
          <div class="fb-meta"><span class="pill ${r.category === 'bug' ? 'bad' : 'info'}">${r.category === 'bug' ? 'Bug' : 'Suggestion'}</span>
            <span>${relTime(r.created_at)}</span>${r.heap_id ? html`<span>${heapName(heaps, r.heap_id)}</span>` : ''}</div>
          <p class="fb-msg" style="display:-webkit-box;-webkit-line-clamp:3;-webkit-box-orient:vertical;overflow:hidden">${r.message}</p></div>`)}</div>`
        : html`<div class="empty">No feedback yet.</div>`);
    })
    .catch((e) => { put('t-fb', failed('Unread feedback', e)); put('ovFb', html`<div class="muted">${errMessage(e)}</div>`); });

  heapsP
    .then((heaps) => {
      const rows = [...heaps].sort((a, b) => (a.id === INFINITE_HEAP_ID ? 1 : 0) - (b.id === INFINITE_HEAP_ID ? 1 : 0) || a.params.difficulty - b.params.difficulty);
      put('ovHeaps', rows.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Heap</th><th class="num">Difficulty</th><th class="num">Height</th><th>Unlocked by</th><th class="num">Version</th></tr></thead><tbody>
        ${rows.map((h) => html`<tr class="clickable" data-href="#/heaps/${encodeURIComponent(h.id)}">
          <td><b>${h.params.name}</b>${h.id === INFINITE_HEAP_ID ? html` <span class="pill">Infinite</span>` : ''}</td>
          <td class="num">${h.params.difficulty.toFixed(1)}</td>
          <td class="num">${heapHeightLabel(h.params.worldHeight, h.topY, h.id === INFINITE_HEAP_ID)}</td>
          <td>${h.params.lockedByHeapId ? heapName(heaps, h.params.lockedByHeapId) : html`<span class="muted">always open</span>`}</td>
          <td class="num">${fmtNum(h.version)}</td></tr>`)}</tbody></table></div>`
        : html`<div class="empty">No heaps on this server. <a href="#/heaps">Create one</a>.</div>`);
    })
    .catch((e) => put('ovHeaps', html`<div class="note bad"><div>${errMessage(e)}</div></div>`));

  ctx.root.addEventListener('click', (ev) => {
    const tr = (ev.target as HTMLElement).closest<HTMLElement>('tr[data-href]');
    if (tr) location.hash = tr.dataset.href!;
  });
}
