// admin/src/views/players.ts

import type { Ctx } from '../ctx';
import { envLabel } from '../api';
import { getHeaps, getAdminScores, listBans } from '../data';
import { html, mount, $, idCell, fmtNum, fmtDateTime, relTime, errMessage, lsGet, lsSet } from '../ui';
import { openPlayer } from './playerDrawer';

const PAGE = 25;
const LS_HEAP = 'heapAdmin.playersHeap';

export async function playersView(ctx: Ctx): Promise<void> {
  const tab = ctx.query.get('tab') === 'banned' ? 'banned' : 'boards';
  mount(ctx.root, html`
    <div class="page-head"><div><h1>Players</h1><p>Look anyone up, see where they stand, and deal with cheaters.</p></div></div>
    <form class="panel" id="lkForm" style="display:flex;gap:8px;flex-wrap:wrap;align-items:center">
      <input class="input" id="lkId" placeholder="Paste a player id" style="flex:1;min-width:240px" spellcheck="false">
      <button class="btn primary" type="submit">Look up</button>
    </form>
    <div class="tabs" role="tablist" style="margin-top:22px">
      <button role="tab" data-tab="boards" aria-selected="${tab === 'boards' ? 'true' : 'false'}">Leaderboards</button>
      <button role="tab" data-tab="banned" aria-selected="${tab === 'banned' ? 'true' : 'false'}">Shadow-banned</button>
    </div>
    <div id="plBody"></div>`);

  $('#lkForm', ctx.root).addEventListener('submit', (ev) => {
    ev.preventDefault();
    const id = (ctx.root.querySelector('#lkId') as HTMLInputElement).value.trim();
    if (id) openPlayer(id, () => ctx.reload());
  });
  $('.tabs', ctx.root).addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (b) ctx.go(b.dataset.tab === 'banned' ? 'players?tab=banned' : 'players');
  });
  ctx.root.addEventListener('click', (ev) => {
    if ((ev.target as HTMLElement).closest('.copy')) return;
    const tr = (ev.target as HTMLElement).closest<HTMLElement>('tr[data-player]');
    if (tr) openPlayer(tr.dataset.player!, () => ctx.reload());
  });

  const host = $('#plBody', ctx.root);
  if (tab === 'banned') return renderBans(ctx, host);

  const heaps = await getHeaps();
  if (!ctx.alive()) return;
  if (!heaps.length) { mount(host, html`<div class="empty">No heaps on ${envLabel()}.</div>`); return; }
  const saved = lsGet(LS_HEAP);
  let heapId = heaps.some((h) => h.id === saved) ? saved! : heaps[0].id;
  let page = 0;

  mount(host, html`<div class="panel">
    <div class="panel-head"><select class="input" id="plHeap" style="width:auto">
      ${heaps.map((h) => html`<option value="${h.id}" ${h.id === heapId ? 'selected' : ''}>${h.params.name}</option>`)}</select>
      <span class="sub">Every score, banned players included, so you can judge in context.</span></div>
    <div id="plTable" class="muted">Loading…</div>
    <div class="pager"><button class="btn sm" id="plPrev">Previous</button><span id="plPage"></span><button class="btn sm" id="plNext">Next</button></div>
  </div>`);

  let total = 0;
  const load = async () => {
    const tbl = $('#plTable', host);
    tbl.style.opacity = '0.5';
    try {
      const d = await getAdminScores(heapId, page, PAGE);
      if (!ctx.alive()) return;
      total = d.total;
      $('#plPage', host).textContent = `Page ${page + 1} of ${Math.max(1, Math.ceil(total / PAGE))} · ${fmtNum(total)} players`;
      ($('#plPrev', host) as HTMLButtonElement).disabled = page === 0;
      ($('#plNext', host) as HTMLButtonElement).disabled = (page + 1) * PAGE >= total;
      mount(tbl, d.entries.length ? html`<div class="table-wrap"><table class="t"><thead><tr>
        <th class="num">Rank</th><th>Name</th><th>Player id</th><th class="num">Score</th><th>Status</th></tr></thead><tbody>
        ${d.entries.map((e) => html`<tr class="clickable" data-player="${e.playerId}">
          <td class="num">#${e.rank}</td><td><b>${e.name}</b></td><td style="max-width:220px">${idCell(e.playerId)}</td>
          <td class="num">${fmtNum(e.score)}</td>
          <td>${e.banned ? html`<span class="pill bad">Banned</span>` : ''}</td></tr>`)}
        </tbody></table></div>` : html`<div class="empty">Nobody has scored on this heap yet.</div>`);
    } catch (e) {
      if (ctx.alive()) mount(tbl, html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
    } finally {
      tbl.style.opacity = '';
    }
  };
  $('#plHeap', host).addEventListener('change', (ev) => {
    heapId = (ev.target as HTMLSelectElement).value; lsSet(LS_HEAP, heapId); page = 0; load();
  });
  $('#plPrev', host).addEventListener('click', () => { if (page > 0) { page--; load(); } });
  $('#plNext', host).addEventListener('click', () => { if ((page + 1) * PAGE < total) { page++; load(); } });
  await load();
}

async function renderBans(ctx: Ctx, host: HTMLElement): Promise<void> {
  mount(host, html`<div class="panel"><div class="muted">Loading…</div></div>`);
  try {
    const { bans } = await listBans();
    if (!ctx.alive()) return;
    mount(host, html`<div class="panel">
      <div class="panel-head"><h2>${fmtNum(bans.length)} shadow-banned</h2><span class="sub">They still play, but nobody else sees their scores.</span></div>
      ${bans.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Player id</th><th>Reason</th><th>Banned</th></tr></thead><tbody>
        ${bans.map((b) => html`<tr class="clickable" data-player="${b.player_id}">
          <td style="max-width:260px">${idCell(b.player_id)}</td>
          <td>${b.reason ?? html`<span class="muted">none given</span>`}</td>
          <td title="${fmtDateTime(b.banned_at)}">${relTime(b.banned_at)}</td></tr>`)}
        </tbody></table></div>` : html`<div class="empty">Nobody is banned.</div>`}</div>`);
  } catch (e) {
    if (ctx.alive()) mount(host, html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
  }
}
