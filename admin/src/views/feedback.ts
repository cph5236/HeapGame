// admin/src/views/feedback.ts
//
// In-game Bug / Suggestion submissions, newest first. Items that arrived since
// this browser last opened the page are marked New; opening the page marks
// them read (per environment).

import type { Ctx } from '../ctx';
import { listFeedback, getHeaps, heapName, type FeedbackRow } from '../data';
import { html, mount, $, relTime, fmtDateTime, fmtNum, errMessage } from '../ui';
import { lastSeenFeedbackId, markFeedbackSeen } from '../badges';
import { openPlayer } from './playerDrawer';

const STEP = 100;

export async function feedbackView(ctx: Ctx): Promise<void> {
  mount(ctx.root, html`
    <div class="page-head"><div><h1>Feedback</h1><p>What players sent from the in-game form.</p></div></div>
    <div class="filters">
      <div class="seg" id="fbCat">
        <button type="button" data-cat="all" aria-pressed="true">All</button>
        <button type="button" data-cat="bug" aria-pressed="false">Bugs</button>
        <button type="button" data-cat="suggestion" aria-pressed="false">Suggestions</button>
      </div>
      <input class="input grow" id="fbSearch" placeholder="Search messages, versions, player ids" style="max-width:420px">
      <label class="check"><input type="checkbox" id="fbUnread"> New only</label>
    </div>
    <div class="panel"><div id="fbList" class="muted">Loading…</div></div>`);

  const [rows, heaps] = await Promise.all([listFeedback(), getHeaps().catch(() => [])]).catch((e) => {
    if (ctx.alive()) mount($('#fbList', ctx.root), html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
    return [null, []] as const;
  });
  if (!ctx.alive() || !rows) return;

  const seen = lastSeenFeedbackId();
  markFeedbackSeen(rows);
  const all = [...rows].sort((a, b) => b.id - a.id);
  let cat = 'all';
  let shown = STEP;

  const render = () => {
    const q = (ctx.root.querySelector('#fbSearch') as HTMLInputElement).value.trim().toLowerCase();
    const unreadOnly = (ctx.root.querySelector('#fbUnread') as HTMLInputElement).checked;
    const match = (r: FeedbackRow) =>
      (cat === 'all' || r.category === cat)
      && (!unreadOnly || r.id > seen)
      && (!q || [r.message, r.app_version, r.platform, r.player_guid, heapName(heaps, r.heap_id)].some((s) => (s ?? '').toLowerCase().includes(q)));
    const list = all.filter(match);
    mount($('#fbList', ctx.root), list.length ? html`
      <div class="muted" style="font-size:12.5px;margin-bottom:4px">${fmtNum(list.length)} of ${fmtNum(all.length)}</div>
      <div class="fb">${list.slice(0, shown).map((r) => html`<article class="fb-item ${r.id > seen ? 'unread' : ''}">
        <div class="fb-meta">
          <span class="pill ${r.category === 'bug' ? 'bad' : 'info'}">${r.category === 'bug' ? 'Bug' : 'Suggestion'}</span>
          ${r.id > seen ? html`<span class="pill warn">New</span>` : ''}
          <span title="${fmtDateTime(r.created_at)}">${relTime(r.created_at)}</span>
          ${r.heap_id ? html`<span>${heapName(heaps, r.heap_id)}</span>` : ''}
          ${r.app_version ? html`<span>v${r.app_version}</span>` : ''}
          ${r.platform ? html`<span>${r.platform}</span>` : ''}
          ${r.player_guid ? html`<button class="linkish" data-player="${r.player_guid}">View player</button>` : ''}
          <span class="muted" style="margin-left:auto">#${r.id}</span>
        </div>
        <p class="fb-msg">${r.message}</p>
      </article>`)}</div>
      ${list.length > shown ? html`<div class="form-actions"><button class="btn" id="fbMore">Show ${Math.min(STEP, list.length - shown)} more</button></div>` : ''}`
      : html`<div class="empty">${all.length ? 'Nothing matches these filters.' : 'No feedback yet.'}</div>`);
  };

  $('#fbCat', ctx.root).addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-cat]');
    if (!b) return;
    cat = b.dataset.cat!;
    ctx.root.querySelectorAll<HTMLElement>('#fbCat [data-cat]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    shown = STEP; render();
  });
  $('#fbSearch', ctx.root).addEventListener('input', () => { shown = STEP; render(); });
  $('#fbUnread', ctx.root).addEventListener('change', () => { shown = STEP; render(); });
  ctx.root.addEventListener('click', (ev) => {
    const t = ev.target as HTMLElement;
    const p = t.closest<HTMLElement>('[data-player]');
    if (p) { openPlayer(p.dataset.player!); return; }
    if (t.closest('#fbMore')) { shown += STEP; render(); }
  });
  render();
}
