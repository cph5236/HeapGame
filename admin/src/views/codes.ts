// admin/src/views/codes.ts
//
// Reward codes: mint, edit size/cap/expiry, delete.

import type { Ctx } from '../ctx';
import { envLabel } from '../api';
import { listCodes, createCode, patchCode, deleteCode, type CodeRow } from '../data';
import {
  html, mount, $, $input, onAction, openDrawer, toast, errMessage, confirmDialog, fmtNum, fmtDateTime, relTime, icon, lsGet, lsSet,
} from '../ui';
import { ITEM_IDS } from '../../../shared/itemIds';

const LS_EXPIRED = 'heapAdmin.codesShowExpired';

// ── Field readers (each returns the value, or an error string) ───────────

/** Stored UTC ISO → the "YYYY-MM-DDTHH:mm" a datetime-local input expects, in
 *  local time. A plain slice(0,16) would read the UTC clock as local. */
function toLocalInput(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** A partially filled datetime-local (date picked, time blank) reports
 *  value === "" — which used to be read as "never" and silently dropped the
 *  expiry. `badInput` catches it. */
function readExpires(el: HTMLInputElement): string | null | { error: string } {
  if (el.validity.badInput) return { error: 'Expires: pick both a date and a time, or leave both blank' };
  return el.value ? new Date(el.value).toISOString() : null;
}

/** Rejects a typo like "100O" that parseInt would truncate to a plausible 100. */
function strictInt(raw: string): number {
  const n = parseInt(raw, 10);
  return Number.isInteger(n) && String(n) === raw ? n : NaN;
}

function readAmount(el: HTMLInputElement): number | { error: string } {
  const n = strictInt(el.value.trim());
  return Number.isInteger(n) && n > 0 ? n : { error: 'Amount must be a positive whole number' };
}

/** Blank means different things per form: unlimited when minting (per the
 *  field's own hint), "no change" when editing (the field was pre-filled, so
 *  blank can only be an accidental clear). */
function readMax(el: HTMLInputElement, blankMeans: 0 | undefined): number | undefined | { error: string } {
  const raw = el.value.trim();
  if (raw === '') return blankMeans;
  const n = strictInt(raw);
  return Number.isInteger(n) && n >= 0 ? n : { error: 'Max redemptions must be a whole number, 0 for unlimited' };
}

const isErr = (v: unknown): v is { error: string } => typeof v === 'object' && v !== null && 'error' in v;

function status(c: CodeRow, nowIso: string): { label: string; cls: string } {
  if (c.expires_at && c.expires_at <= nowIso) return { label: 'Expired', cls: '' };
  if (c.max_redemptions > 0 && c.redeemed_count >= c.max_redemptions) return { label: 'Used up', cls: 'warn' };
  return { label: 'Live', cls: 'good' };
}

function reward(c: CodeRow): string {
  return c.reward_type === 'coins' ? `${fmtNum(c.reward_amount)} Scrap` : `${fmtNum(c.reward_amount)} × ${c.reward_id ?? '?'}`;
}

export async function codesView(ctx: Ctx): Promise<void> {
  let showExpired = lsGet(LS_EXPIRED) === '1';
  mount(ctx.root, html`
    <div class="page-head"><div><h1>Reward codes</h1><p>Codes players type in to claim Scrap or items.</p></div>
      <div class="actions"><button class="btn primary" data-action="mint">${icon('plus')}Mint code</button></div></div>
    <div class="filters"><label class="check"><input type="checkbox" id="rcExpired" ${showExpired ? 'checked' : ''}> Show expired and used-up codes</label></div>
    <div class="panel"><div id="rcList" class="muted">Loading…</div></div>`);

  let codes: CodeRow[] = [];
  const render = () => {
    const nowIso = new Date().toISOString();
    const list = showExpired ? codes : codes.filter((c) => status(c, nowIso).label === 'Live');
    mount($('#rcList', ctx.root), list.length ? html`<div class="table-wrap"><table class="t">
      <thead><tr><th>Code</th><th>Status</th><th>Reward</th><th class="num">Redeemed</th><th>Expires</th><th>Created</th><th></th></tr></thead>
      <tbody>${list.map((c) => {
        const s = status(c, nowIso);
        return html`<tr>
          <td><code class="mono" style="font-size:13px;font-weight:600">${c.code}</code></td>
          <td><span class="pill ${s.cls}">${s.label}</span></td>
          <td>${reward(c)}</td>
          <td class="num">${fmtNum(c.redeemed_count)} / ${c.max_redemptions === 0 ? '∞' : fmtNum(c.max_redemptions)}</td>
          <td title="${c.expires_at ? fmtDateTime(c.expires_at) : ''}">${c.expires_at ? relTime(c.expires_at) : html`<span class="muted">never</span>`}</td>
          <td class="muted" title="${fmtDateTime(c.created_at)}">${relTime(c.created_at)}</td>
          <td class="actions"><button class="btn sm" data-action="edit" data-code="${c.code}">Edit</button>
            <button class="btn sm danger" data-action="del" data-code="${c.code}">Delete</button></td></tr>`;
      })}</tbody></table></div>`
      : html`<div class="empty">${codes.length ? 'No live codes. Tick the box above to see old ones.' : 'No codes yet. Mint one to reward players.'}</div>`);
  };

  const load = async () => {
    try {
      codes = (await listCodes()).codes ?? [];
      if (ctx.alive()) render();
    } catch (e) {
      if (ctx.alive()) mount($('#rcList', ctx.root), html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
    }
  };

  $('#rcExpired', ctx.root).addEventListener('change', (ev) => {
    showExpired = (ev.target as HTMLInputElement).checked;
    lsSet(LS_EXPIRED, showExpired ? '1' : '0');
    render();
  });

  onAction(ctx.root, {
    mint: () => openMint(load),
    edit: (el) => { const c = codes.find((x) => x.code === el.dataset.code); if (c) openEdit(c, load); },
    del: async (el) => {
      const code = el.dataset.code!;
      if (!await confirmDialog({ title: `Delete ${code} on ${envLabel()}?`, body: 'Players can no longer redeem it. This can\'t be undone.', confirm: 'Delete code', danger: true })) return;
      try { await deleteCode(code); toast(`Deleted ${code}`); load(); }
      catch (e) { toast(errMessage(e), 'err'); }
    },
  });

  await load();
}

function openMint(onDone: () => void): void {
  const { body, close } = openDrawer('Mint a code', html`<form id="mf">
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <label class="field" style="grid-column:1/-1"><span>Code</span><input class="input mono" name="code" placeholder="LAUNCH2026" required
        style="text-transform:uppercase;font-size:14px" autocomplete="off" spellcheck="false"><small>Stored upper-case</small></label>
      <label class="field"><span>Reward</span><select class="input" name="type"><option value="coins">Scrap</option><option value="item">Item</option></select></label>
      <label class="field hidden" id="mfItem"><span>Item</span><select class="input" name="item">${ITEM_IDS.map((i) => html`<option value="${i}">${i}</option>`)}</select></label>
      <label class="field"><span>Amount</span><input class="input" name="amount" type="number" min="1" step="1" value="500"></label>
      <label class="field"><span>Max redemptions</span><input class="input" name="max" type="number" min="0" step="1" value="0"><small>0 or blank = unlimited</small></label>
      <label class="field"><span>Expires</span><input class="input" name="expires" type="datetime-local"><small>Blank = never · your local time</small></label>
    </div>
    <div class="form-actions"><button class="btn primary" type="submit">Mint on ${envLabel()}</button></div></form>`);
  const form = $('#mf', body);
  const typeSel = form.querySelector('[name="type"]') as HTMLSelectElement;
  typeSel.addEventListener('change', () => $('#mfItem', body).classList.toggle('hidden', typeSel.value !== 'item'));
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const code = $input('[name="code"]', form).value.trim().toUpperCase();
    const amount = readAmount($input('[name="amount"]', form));
    const max = readMax($input('[name="max"]', form), 0);
    const expires = readExpires($input('[name="expires"]', form));
    const err = [amount, max, expires].find(isErr);
    if (!code) { toast('Enter a code', 'err'); return; }
    if (err) { toast(err.error, 'err'); return; }
    const req: Record<string, unknown> = { code, rewardType: typeSel.value, rewardAmount: amount, maxRedemptions: max, expiresAt: expires };
    if (typeSel.value === 'item') req.rewardId = (form.querySelector('[name="item"]') as HTMLSelectElement).value;
    try { await createCode(req); toast(`Minted ${code}`); close(); onDone(); }
    catch (e) { toast(errMessage(e), 'err'); }
  });
}

function openEdit(c: CodeRow, onDone: () => void): void {
  const { body, close } = openDrawer(html`Edit <span class="mono" style="font-size:20px">${c.code}</span>`, html`<form id="ef">
    <p class="muted" style="margin-top:0">${reward(c)} · redeemed ${fmtNum(c.redeemed_count)} times. The code and reward type can't change.</p>
    <div class="form-grid" style="grid-template-columns:1fr 1fr">
      <label class="field"><span>Amount</span><input class="input" name="amount" type="number" min="1" step="1" value="${c.reward_amount}"></label>
      <label class="field"><span>Max redemptions</span><input class="input" name="max" type="number" min="0" step="1" value="${c.max_redemptions}"><small>0 = unlimited</small></label>
      <label class="field"><span>Expires</span><input class="input" name="expires" type="datetime-local" value="${toLocalInput(c.expires_at)}"><small>Blank = never</small></label>
    </div>
    <div class="form-actions"><button class="btn primary" type="submit">Save changes</button></div></form>`);
  const form = $('#ef', body);
  form.addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const amount = readAmount($input('[name="amount"]', form));
    const max = readMax($input('[name="max"]', form), undefined);
    const expires = readExpires($input('[name="expires"]', form));
    const err = [amount, max, expires].find(isErr);
    if (err) { toast(err.error, 'err'); return; }
    // Send only what changed: an unconditional include would clobber a
    // concurrent edit with the stale value this form was pre-filled with.
    const patch: Record<string, unknown> = {};
    if (amount !== c.reward_amount) patch.rewardAmount = amount;
    if (max !== undefined && max !== c.max_redemptions) patch.maxRedemptions = max;
    // datetime-local has no seconds — only resend when the minute changed, so
    // editing the amount can't truncate a sub-minute expiry set via the API.
    if (toLocalInput(expires as string | null) !== toLocalInput(c.expires_at)) patch.expiresAt = expires;
    if (!Object.keys(patch).length) { toast('Nothing changed'); return; }
    try { await patchCode(c.code, patch); toast(`Updated ${c.code}`); close(); onDone(); }
    catch (e) { toast(errMessage(e), 'err'); }
  });
}
