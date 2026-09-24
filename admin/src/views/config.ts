// admin/src/views/config.ts
//
// Remote config: JSON values the game reads at boot (e.g. ad_cadence).

import type { Ctx } from '../ctx';
import { envLabel, currentEnv } from '../api';
import { getConfig, putConfig, deleteConfig } from '../data';
import { html, mount, $, onAction, toast, errMessage, confirmDialog } from '../ui';

function parse(text: string): { ok: true; value: unknown } | { ok: false; error: string } {
  try { return { ok: true, value: JSON.parse(text) }; }
  catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
}

export async function configView(ctx: Ctx): Promise<void> {
  mount(ctx.root, html`
    <div class="page-head"><div><h1>Remote config</h1><p>JSON values the game fetches at launch. Changes reach players on their next launch.</p></div></div>
    <div id="cfgList" class="muted">Loading…</div>
    <form class="panel" id="cfgNew" style="margin-top:16px">
      <div class="panel-head"><h2>Add a key</h2></div>
      <div class="form-grid"><label class="field"><span>Key</span><input class="input mono" name="key" placeholder="my_new_key" autocomplete="off" spellcheck="false"></label></div>
      <label class="field" style="margin-top:12px"><span>Value (JSON)</span><textarea class="input" name="value" rows="5" spellcheck="false">{}</textarea>
        <small data-role="err"></small></label>
      <div class="form-actions"><button class="btn primary" type="submit">Add key</button></div>
    </form>`);

  let config: Record<string, unknown> = {};
  try {
    config = (await getConfig()).config ?? {};
  } catch (e) {
    if (ctx.alive()) mount($('#cfgList', ctx.root), html`<div class="note bad"><div>${errMessage(e)}</div></div>`);
    return;
  }
  if (!ctx.alive()) return;
  const keys = Object.keys(config).sort();
  mount($('#cfgList', ctx.root), keys.length ? html`<div class="grid two">${keys.map((k) => {
    const pretty = JSON.stringify(config[k], null, 2);
    return html`<div class="panel" data-key="${k}">
      <div class="panel-head"><h2 class="mono" style="font-size:14px">${k}</h2>
        <div class="tools"><button class="btn sm danger" type="button" data-action="del" data-key="${k}">Delete</button></div></div>
      <textarea class="input" rows="${Math.min(14, Math.max(4, pretty.split('\n').length + 1))}" spellcheck="false" data-orig="${pretty}">${pretty}</textarea>
      <small class="muted" data-role="err" style="display:block;min-height:18px;margin-top:4px"></small>
      <div class="form-actions" style="margin-top:6px"><button class="btn primary sm" type="button" data-action="save" data-key="${k}" disabled>Save</button>
        <button class="btn ghost sm" type="button" data-action="revert" data-key="${k}" disabled>Revert</button></div>
    </div>`;
  })}</div>` : html`<div class="panel"><div class="empty">No config keys yet.</div></div>`);

  // Live validation: Save lights up only for a changed, parseable value.
  ctx.root.addEventListener('input', (ev) => {
    const ta = ev.target as HTMLTextAreaElement;
    if (ta.tagName !== 'TEXTAREA') return;
    const card = ta.closest<HTMLElement>('[data-key], #cfgNew')!;
    const res = parse(ta.value);
    ta.classList.toggle('invalid', !res.ok);
    const err = card.querySelector<HTMLElement>('[data-role="err"]');
    if (err) { err.textContent = res.ok ? '' : `Invalid JSON: ${res.error}`; err.style.color = res.ok ? '' : 'var(--bad)'; }
    const changed = ta.value !== ta.dataset.orig;
    card.querySelectorAll<HTMLButtonElement>('[data-action="save"]').forEach((b) => { b.disabled = !res.ok || !changed; });
    card.querySelectorAll<HTMLButtonElement>('[data-action="revert"]').forEach((b) => { b.disabled = !changed; });
  });

  const save = async (key: string, value: unknown, verb: string) => {
    if (currentEnv() === 'prod' && !await confirmDialog({ title: `${verb} ${key} on Production?`, body: 'Players get the new value on their next launch.', confirm: verb })) return false;
    try { await putConfig(key, value); toast(`${verb === 'Add' ? 'Added' : 'Saved'} ${key}`); ctx.reload(); return true; }
    catch (e) { toast(errMessage(e), 'err'); return false; }
  };

  onAction(ctx.root, {
    save: (el) => {
      const key = el.dataset.key!;
      const ta = ctx.root.querySelector<HTMLTextAreaElement>(`[data-key="${CSS.escape(key)}"] textarea`)!;
      const res = parse(ta.value);
      if (res.ok) save(key, res.value, 'Save');
    },
    revert: (el) => {
      const ta = ctx.root.querySelector<HTMLTextAreaElement>(`[data-key="${CSS.escape(el.dataset.key!)}"] textarea`)!;
      ta.value = ta.dataset.orig ?? '';
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    },
    del: async (el) => {
      const key = el.dataset.key!;
      if (!await confirmDialog({ title: `Delete ${key} on ${envLabel()}?`, body: 'The game falls back to its built-in default. This can\'t be undone.', confirm: 'Delete key', danger: true })) return;
      try { await deleteConfig(key); toast(`Deleted ${key}`); ctx.reload(); }
      catch (e) { toast(errMessage(e), 'err'); }
    },
  });

  $('#cfgNew', ctx.root).addEventListener('submit', (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget as HTMLFormElement;
    const key = (form.querySelector('[name="key"]') as HTMLInputElement).value.trim();
    if (!key) { toast('Enter a key name', 'err'); return; }
    if (Object.prototype.hasOwnProperty.call(config, key)) { toast(`${key} already exists — edit it above`, 'err'); return; }
    const res = parse((form.querySelector('[name="value"]') as HTMLTextAreaElement).value);
    if (!res.ok) { toast(`Invalid JSON: ${res.error}`, 'err'); return; }
    save(key, res.value, 'Add');
  });
}
