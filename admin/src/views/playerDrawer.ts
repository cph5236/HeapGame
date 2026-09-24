// admin/src/views/playerDrawer.ts
//
// Everything about one player in one place: ban state, standings on every
// heap, their recent event trace, and the two admin actions that act on a
// player (shadow-ban, and releasing a hijacked/locked write-auth claim).

import { currentEnv, envLabel, ApiError } from '../api';
import {
  lookupPlayer, getHeaps, heapName, banPlayer, unbanPlayer, resetPlayerAuth, getTrace,
  type TraceRow,
} from '../data';
import {
  html, mount, openDrawer, idCell, fmtNum, fmtDateTime, relTime, toast, errMessage,
  confirmDialog, promptDialog, onAction, type Raw,
} from '../ui';

const TRACE_DAYS = [1, 7, 30] as const;

export function aeUnavailable(e: unknown): Raw | null {
  if (e instanceof ApiError && e.status === 404) {
    return html`<div class="note"><div>Analytics Engine isn't configured for ${envLabel()}. That's normal for Local and Staging; event data only exists in Production.</div></div>`;
  }
  return null;
}

export function sampledNote(meta: { sampled: boolean; sampleIntervalMax: number; truncated?: boolean }, trace = false): Raw {
  return html`
    ${meta.sampled ? html`<div class="note warn"><div><b>Sampled data (1 in ${meta.sampleIntervalMax}).</b>
      ${trace ? ' Analytics Engine dropped some of this player\'s events, so the list below has gaps.' : ' Analytics Engine downsampled this window, so these are estimates and per-player stages can misclassify.'}</div></div>` : ''}
    ${meta.truncated ? html`<div class="note warn"><div><b>Cohort capped at 2,000 players.</b> Totals undercount this window — narrow the range for exact numbers.</div></div>` : ''}`;
}

export function traceList(rows: TraceRow[]): Raw {
  if (!rows.length) return html`<div class="empty">No events in this window.</div>`;
  return html`<div class="trace">${rows.map((r) => {
    const ts = Number(r.ts);
    // Payload is already a JSON string and player-supplied — shown escaped,
    // never parsed into markup.
    const payload = typeof r.payload === 'string' ? r.payload : JSON.stringify(r.payload);
    return html`<div class="trace-row lv-${r.level}">
      <span class="muted" title="${Number.isFinite(ts) ? new Date(ts).toISOString() : ''}">${Number.isFinite(ts) ? fmtDateTime(ts) : String(r.ts)}</span>
      <span class="ev">${r.eventType || r.level}</span>
      <code>${payload && payload !== '{}' ? payload : ''} ${r.appVersion ? `· v${r.appVersion}` : ''} ${r.platform ? `· ${r.platform}` : ''}</code>
    </div>`;
  })}</div>`;
}

export function openPlayer(playerId: string, onChange?: () => void): void {
  const env = currentEnv();
  const { body } = openDrawer(html`Player`, html`<div class="muted">Loading…</div>`);
  let traceDays: number = 7;
  const alive = () => body.isConnected && env === currentEnv();

  async function render(): Promise<void> {
    const [p, heaps] = await Promise.all([lookupPlayer(playerId), getHeaps()]);
    if (!alive()) return;
    const best = p.scores.reduce<null | { heapId: string; rank: number }>((b, s) => (!b || s.rank < b.rank ? s : b), null);
    mount(body, html`
      <section>
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <span style="font-size:20px;font-weight:700">${p.name}</span>
          ${p.banned ? html`<span class="pill bad">Shadow-banned</span>` : html`<span class="pill good">In good standing</span>`}
        </div>
        <dl class="kv" style="margin-top:12px">
          <dt>Player id</dt><dd>${idCell(p.playerId)}</dd>
          ${p.banned ? html`<dt>Banned</dt><dd>${fmtDateTime(p.bannedAt)} (${relTime(p.bannedAt)})</dd>
            <dt>Reason</dt><dd>${p.reason ?? html`<span class="muted">none given</span>`}</dd>` : ''}
          ${best ? html`<dt>Best rank</dt><dd>#${best.rank} on ${heapName(heaps, best.heapId)}</dd>` : ''}
        </dl>
        <div class="form-actions">
          ${p.banned
            ? html`<button class="btn" data-action="unban">Lift ban</button>`
            : html`<button class="btn danger" data-action="ban">Shadow-ban</button>`}
        </div>
      </section>
      <section>
        <h3>Scores</h3>
        ${p.scores.length ? html`<div class="table-wrap"><table class="t"><thead><tr><th>Heap</th><th class="num">Score</th><th class="num">Rank</th></tr></thead><tbody>
          ${p.scores.map((s) => html`<tr><td><a href="#/heaps/${encodeURIComponent(s.heapId)}">${heapName(heaps, s.heapId)}</a></td>
            <td class="num">${fmtNum(s.score)}</td><td class="num">#${s.rank}</td></tr>`)}</tbody></table></div>`
          : html`<div class="muted">No scores on any heap.</div>`}
      </section>
      <section>
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <h3 style="margin:0">Recent activity</h3>
          <div class="seg" style="margin-left:auto">${TRACE_DAYS.map((d) => html`<button type="button" data-action="traceDays" data-days="${d}"
            aria-pressed="${d === traceDays ? 'true' : 'false'}">${d}d</button>`)}</div>
        </div>
        <div id="pdTrace"><div class="muted">Loading events…</div></div>
      </section>
      <section>
        <h3>Account rescue</h3>
        <div class="danger-row" style="padding-top:0">
          <div><b>Release write claim</b><p>For a player locked out with 403s, or whose id was claimed by someone else. Their next save re-claims it with whatever device writes first.</p></div>
          <button class="btn danger" data-action="resetAuth">Release claim</button>
        </div>
      </section>`);
    loadTrace();
  }

  async function loadTrace(): Promise<void> {
    const host = body.querySelector<HTMLElement>('#pdTrace');
    if (!host) return;
    const until = new Date();
    const since = new Date(until.getTime() - traceDays * 86_400_000);
    try {
      const t = await getTrace(playerId, since.toISOString(), until.toISOString());
      if (!alive()) return;
      mount(host, html`${sampledNote(t, true)}${traceList(t.rows)}`);
    } catch (e) {
      if (!alive()) return;
      mount(host, aeUnavailable(e) ?? html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
    }
  }

  onAction(body, {
    traceDays: (el) => {
      traceDays = Number(el.dataset.days);
      body.querySelectorAll<HTMLElement>('[data-action="traceDays"]').forEach((b) =>
        b.setAttribute('aria-pressed', String(b === el)));
      loadTrace();
    },
    ban: async () => {
      const reason = await promptDialog({
        title: `Shadow-ban on ${envLabel(env)}?`,
        body: 'They keep playing normally but vanish from every leaderboard for everyone else. Takes up to a minute to reach cached boards.',
        label: 'Reason (optional, only admins see it)', confirm: 'Shadow-ban', danger: true,
      });
      if (reason === null) return;
      try { await banPlayer(playerId, reason); toast('Player shadow-banned'); onChange?.(); render(); }
      catch (e) { toast(errMessage(e), 'err'); }
    },
    unban: async () => {
      if (!await confirmDialog({ title: `Lift the ban on ${envLabel(env)}?`, body: 'They reappear at their real rank once caches turn over (up to a minute).', confirm: 'Lift ban' })) return;
      try { await unbanPlayer(playerId); toast('Ban lifted'); onChange?.(); render(); }
      catch (e) { toast(errMessage(e), 'err'); }
    },
    resetAuth: async () => {
      const ok = await confirmDialog({
        title: 'Release this write claim?',
        body: `Deletes the player_auth row on ${envLabel(env)}. Whoever writes next with this id becomes its owner — only do this when you're confident the real player will be first.`,
        confirm: 'Release claim', danger: true,
        typeToConfirm: env === 'prod' ? 'release' : undefined,
      });
      if (!ok) return;
      try { await resetPlayerAuth(playerId); toast('Write claim released'); }
      catch (e) { toast(errMessage(e), 'err'); }
    },
  });

  render().catch((e) => {
    if (alive()) mount(body, html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
  });
}
