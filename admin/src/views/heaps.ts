// admin/src/views/heaps.ts
//
// Heap list, creation, and the per-heap detail page (settings, enemies,
// silhouette, danger zone).

import type { Ctx } from '../ctx';
import { envLabel, currentEnv } from '../api';
import {
  getHeaps, invalidateHeaps, heapName, createHeap, putHeapParams, deleteHeap, resetHeap,
  getEnemyParams, putEnemyParams, worldYToFt, type HeapSummary,
} from '../data';
import {
  html, mount, $, $input, onAction, openDrawer, toast, errMessage, confirmDialog, fmtNum, fmtDate,
  idCell, icon, type Raw,
} from '../ui';
import { mountBandEditor } from './bandEditor';
import { INFINITE_HEAP_ID, DEFAULT_HEAP_PARAMS, type HeapEnemyParams } from '../../../shared/heapTypes';
import { ENEMY_DEFS, DEFAULT_ENEMY_PARAMS, type EnemyKind } from '../../../shared/enemyDefs';

interface NumField { key: string; label: string; hint: string; step: number; min?: number; max?: number; int?: boolean }

const PARAM_FIELDS: NumField[] = [
  { key: 'difficulty', label: 'Difficulty', hint: '1 to 5, in steps of 0.5', step: 0.5, min: 1, max: 5 },
  { key: 'spawnRateMult', label: 'Enemy spawn multiplier', hint: 'Scales every enemy spawn chance', step: 0.05, min: 0 },
  { key: 'coinMult', label: 'Scrap multiplier', hint: 'Scrap earned per run', step: 0.05, min: 0 },
  { key: 'scoreMult', label: 'Score multiplier', hint: 'Applied to the final run score', step: 0.05, min: 0 },
  { key: 'ghostPointCount', label: 'Ghost points per placement', hint: 'Extra random silhouette points', step: 1, min: 0, int: true },
  { key: 'baseItemSpawnRate', label: 'Pickup chance', hint: '0–1, per surface candidate', step: 0.05, min: 0, max: 1 },
  { key: 'positiveItemSpawnRate', label: 'Helpful pickup weight', hint: 'Relative to the hindering weight', step: 0.05, min: 0 },
  { key: 'negativeItemSpawnRate', label: 'Hindering pickup weight', hint: 'Relative to the helpful weight', step: 0.05, min: 0 },
];

const ENEMY_FIELDS: NumField[] = [
  { key: 'spawnStartPxAboveFloor', label: 'Starts at', hint: 'px above the floor', step: 100 },
  { key: 'spawnEndPxAboveFloor', label: 'Stops at', hint: 'px above the floor · −1 = never', step: 100 },
  { key: 'spawnRampPxAboveFloor', label: 'Full chance at', hint: 'px above the floor · −1 = flat', step: 100 },
  { key: 'spawnChanceMin', label: 'Chance at start', hint: '0–1', step: 0.01, min: 0, max: 1 },
  { key: 'spawnChanceMax', label: 'Chance at full', hint: '0–1', step: 0.01, min: 0, max: 1 },
];

const KINDS = Object.keys(ENEMY_DEFS) as EnemyKind[];

function numInput(prefix: string, f: NumField, value: unknown): Raw {
  return html`<label class="field"><span>${f.label}</span>
    <input class="input" type="number" name="${prefix}${f.key}" step="${f.step}" ${f.min !== undefined ? html`min="${f.min}"` : ''}
      ${f.max !== undefined ? html`max="${f.max}"` : ''} value="${value ?? ''}">
    <small>${f.hint}</small></label>`;
}

function lockSelect(heaps: HeapSummary[], selfId: string | null, current: string | null | undefined): Raw {
  return html`<label class="field"><span>Unlocked by beating</span>
    <select class="input" name="lockedByHeapId">
      <option value="">Nothing — always open</option>
      ${heaps.filter((h) => h.id !== selfId && h.id !== INFINITE_HEAP_ID).map((h) =>
        html`<option value="${h.id}" ${h.id === current ? 'selected' : ''}>${h.params.name}</option>`)}
    </select><small>Players must beat that heap first</small></label>`;
}

function readParams(form: HTMLElement): Record<string, unknown> {
  const get = (k: string) => (form.querySelector(`[name="${k}"]`) as HTMLInputElement).value;
  const out: Record<string, unknown> = { name: get('name') };
  for (const f of PARAM_FIELDS) {
    out[f.key] = f.int ? (v => isNaN(v) ? 1 : v)(parseInt(get(f.key), 10)) : Number(get(f.key));
  }
  out.lockedByHeapId = get('lockedByHeapId') || null;
  return out;
}

// ── List ─────────────────────────────────────────────────────────────────

export async function heapsView(ctx: Ctx): Promise<void> {
  mount(ctx.root, html`
    <div class="page-head"><div><h1>Heaps</h1><p>Every climb players can pick, and how each one plays.</p></div>
      <div class="actions"><button class="btn" data-action="refresh">${icon('refresh')}Refresh</button>
      <button class="btn primary" data-action="create">${icon('plus')}New heap</button></div></div>
    <div class="panel"><div id="hpList" class="muted">Loading…</div></div>`);

  onAction(ctx.root, {
    refresh: () => { invalidateHeaps(); ctx.reload(); },
    create: () => openCreate(ctx),
  });

  const heaps = await getHeaps(true);
  if (!ctx.alive()) return;
  const sorted = [...heaps].sort((a, b) =>
    (a.id === INFINITE_HEAP_ID ? 1 : 0) - (b.id === INFINITE_HEAP_ID ? 1 : 0) || a.params.difficulty - b.params.difficulty);
  mount($('#hpList', ctx.root), sorted.length ? html`<div class="table-wrap"><table class="t">
    <thead><tr><th>Heap</th><th class="num">Difficulty</th><th class="num">Height</th><th class="num">Scrap ×</th><th class="num">Score ×</th><th>Unlocked by</th><th>Created</th></tr></thead>
    <tbody>${sorted.map((h) => html`<tr class="clickable" data-href="#/heaps/${encodeURIComponent(h.id)}">
      <td><b>${h.params.name}</b>${h.id === INFINITE_HEAP_ID ? html` <span class="pill">Infinite</span>` : ''}</td>
      <td class="num">${h.params.difficulty.toFixed(1)}</td>
      <td class="num">${Number.isFinite(h.topY) ? `${fmtNum(worldYToFt(h.topY, h.params.worldHeight))} ft` : '—'}</td>
      <td class="num">${h.params.coinMult}</td><td class="num">${h.params.scoreMult}</td>
      <td>${h.params.lockedByHeapId ? heapName(heaps, h.params.lockedByHeapId) : html`<span class="muted">always open</span>`}</td>
      <td class="muted">${fmtDate(h.createdAt)}</td></tr>`)}</tbody></table></div>`
    : html`<div class="empty">No heaps on ${envLabel()} yet. Create the first one to give players somewhere to climb.</div>`);
  ctx.root.addEventListener('click', (ev) => {
    const tr = (ev.target as HTMLElement).closest<HTMLElement>('tr[data-href]');
    if (tr) location.hash = tr.dataset.href!;
  });
}

async function openCreate(ctx: Ctx): Promise<void> {
  const heaps = await getHeaps();
  const d = DEFAULT_HEAP_PARAMS as unknown as Record<string, unknown>;
  const { body, close } = openDrawer('New heap', html`
    <form id="cf">
      <div class="form-grid" style="grid-template-columns:1fr 1fr">
        <label class="field" style="grid-column:1/-1"><span>Name</span><input class="input" name="name" required placeholder="The Landfill"></label>
        ${PARAM_FIELDS.map((f) => numInput('', f, d[f.key]))}
        <label class="field"><span>World height</span><input class="input" type="number" name="worldHeight" value="${DEFAULT_HEAP_PARAMS.worldHeight}"><small>px · can't change later</small></label>
        ${lockSelect(heaps, null, null)}
        <label class="field"><span>Seed</span><input class="input" type="number" name="seed" placeholder="random"><small>Blank = random shape</small></label>
        <label class="field"><span>Starting blocks</span><input class="input" type="number" name="numBlocks" min="1" step="1" placeholder="50"></label>
      </div>
      <div class="form-actions"><button class="btn primary" type="submit">Create heap on ${envLabel()}</button></div>
    </form>`);
  $('#cf', body).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget as HTMLElement;
    const params = readParams(form);
    if (!params.name) params.name = 'Unnamed Heap';
    params.worldHeight = Number($input('[name="worldHeight"]', form).value);
    const req: Record<string, unknown> = { params };
    const seed = $input('[name="seed"]', form).value;
    const nb = $input('[name="numBlocks"]', form).value;
    if (seed !== '') req.seed = Number(seed);
    if (nb !== '') req.numBlocks = Number(nb);
    try {
      const res = await createHeap(req);
      invalidateHeaps();
      close();
      toast('Heap created');
      ctx.go(`heaps/${encodeURIComponent(res.id)}`);
    } catch (e) { toast(errMessage(e), 'err'); }
  });
}

// ── Detail ───────────────────────────────────────────────────────────────

const TABS = [['settings', 'Settings'], ['enemies', 'Enemies'], ['silhouette', 'Silhouette'], ['danger', 'Danger zone']] as const;

export async function heapDetailView(ctx: Ctx): Promise<void> {
  const id = ctx.params[0];
  const heaps = await getHeaps(true);
  if (!ctx.alive()) return;
  const heap = heaps.find((h) => h.id === id);
  if (!heap) {
    mount(ctx.root, html`<a class="crumb" href="#/heaps">← Heaps</a>
      <div class="empty">No heap with id ${id} on ${envLabel()}.</div>`);
    return;
  }
  const tab = TABS.some(([k]) => k === ctx.query.get('tab')) ? ctx.query.get('tab')! : 'settings';
  const p = heap.params;
  mount(ctx.root, html`
    <a class="crumb" href="#/heaps">← Heaps</a>
    <div class="page-head" style="margin-top:6px"><div><h1>${p.name}</h1>
      <p>${idCell(heap.id)} · v${fmtNum(heap.version)} · ${Number.isFinite(heap.topY) ? `${fmtNum(worldYToFt(heap.topY, p.worldHeight))} ft tall` : 'height unknown'} · created ${fmtDate(heap.createdAt)}</p></div></div>
    <div class="tabs" role="tablist">${TABS.map(([k, label]) => html`<button role="tab" aria-selected="${k === tab ? 'true' : 'false'}"
      data-tab="${k}">${label}</button>`)}</div>
    <div id="hdBody"></div>`);

  $('.tabs', ctx.root).addEventListener('click', (ev) => {
    const b = (ev.target as HTMLElement).closest<HTMLElement>('[data-tab]');
    if (b) ctx.go(`heaps/${encodeURIComponent(id)}?tab=${b.dataset.tab}`);
  });

  const host = $('#hdBody', ctx.root);
  if (tab === 'settings') renderSettings(ctx, host, heap, heaps);
  else if (tab === 'enemies') await renderEnemies(ctx, host, heap);
  else if (tab === 'silhouette') {
    mount(host, html`<div class="panel" id="bandHost"></div>`);
    mountBandEditor($('#bandHost', host), heap.id, ctx.alive);
  } else renderDanger(ctx, host, heap);
}

function renderSettings(ctx: Ctx, host: HTMLElement, heap: HeapSummary, heaps: HeapSummary[]): void {
  const p = heap.params as unknown as Record<string, unknown>;
  mount(host, html`<form class="panel" id="sf">
    <div class="form-grid">
      <label class="field"><span>Name</span><input class="input" name="name" value="${heap.params.name}"></label>
      ${PARAM_FIELDS.map((f) => numInput('', f, p[f.key] ?? (DEFAULT_HEAP_PARAMS as unknown as Record<string, unknown>)[f.key]))}
      ${lockSelect(heaps, heap.id, heap.params.lockedByHeapId)}
      <label class="field"><span>World height</span><input class="input" value="${heap.params.worldHeight}" disabled><small>Fixed at creation</small></label>
    </div>
    <div class="form-actions"><button class="btn primary" type="submit">Save settings</button>
      <span class="muted" style="font-size:12.5px">Players pick this up the next time they load the heap.</span></div>
  </form>`);
  $('#sf', host).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    try {
      await putHeapParams(heap.id, readParams(ev.currentTarget as HTMLElement));
      invalidateHeaps();
      toast('Settings saved');
      ctx.reload();
    } catch (e) { toast(errMessage(e), 'err'); }
  });
}

async function renderEnemies(ctx: Ctx, host: HTMLElement, heap: HeapSummary): Promise<void> {
  mount(host, html`<div class="muted">Loading…</div>`);
  const stored = await getEnemyParams(heap.id).catch((e) => { toast('Couldn\'t load enemy settings: ' + errMessage(e), 'err'); return null; });
  if (!ctx.alive() || !stored) return;
  // Layer stored values over the kind's defaults, so a kind the heap has never
  // saved (e.g. jumper, added after the sentinel row was seeded) pre-fills
  // with its runtime default instead of blanks that would persist as −1
  // (disabled) on the next save.
  const merged: HeapEnemyParams = {};
  for (const k of KINDS) merged[k] = { ...DEFAULT_ENEMY_PARAMS[k], ...(stored[k] ?? {}) };
  mount(host, html`<form id="ef">
    <div class="enemy-grid">${KINDS.map((k) => html`<div class="panel">
      <h3>${ENEMY_DEFS[k].displayName}</h3><div class="muted" style="font-size:12.5px">${k}${ENEMY_DEFS[k].spawnOnHeapWall ? ' · spawns on walls' : ''}${stored[k] ? '' : ' · using defaults'}</div>
      <div class="form-grid">${ENEMY_FIELDS.map((f) => numInput(`${k}.`, f, (merged[k] as unknown as Record<string, number>)[f.key]))}</div>
    </div>`)}</div>
    <div class="form-actions"><button class="btn primary" type="submit">Save enemy settings</button>
      <span class="muted" style="font-size:12.5px">1 ft in game = 10 px.</span></div>
  </form>`);
  $('#ef', host).addEventListener('submit', async (ev) => {
    ev.preventDefault();
    const form = ev.currentTarget as HTMLElement;
    const out: HeapEnemyParams = {};
    for (const k of KINDS) {
      const row: Record<string, number> = {};
      for (const f of ENEMY_FIELDS) {
        const v = parseFloat($input(`[name="${k}.${f.key}"]`, form).value);
        row[f.key] = isNaN(v) ? -1 : v;
      }
      out[k] = row as unknown as HeapEnemyParams[string];
    }
    try { await putEnemyParams(heap.id, out); toast('Enemy settings saved'); }
    catch (e) { toast(errMessage(e), 'err'); }
  });
}

function renderDanger(ctx: Ctx, host: HTMLElement, heap: HeapSummary): void {
  const env = currentEnv();
  mount(host, html`<div class="panel danger-zone">
    <div class="danger-row"><div><b>Reset the live zone</b>
      <p>Clears every player placement above the freeze line and sets the version back to 1. The frozen base stays. Scores are untouched.</p></div>
      <button class="btn danger" data-action="reset">Reset live zone</button></div>
    <div class="danger-row"><div><b>Delete this heap</b>
      <p>Removes the heap for every player. This can't be undone.</p></div>
      <button class="btn danger solid" data-action="delete">Delete heap</button></div>
  </div>`);
  const typed = env === 'prod' ? heap.params.name : undefined;
  onAction(host, {
    reset: async () => {
      if (!await confirmDialog({ title: `Reset "${heap.params.name}" on ${envLabel(env)}?`, body: 'Every placement above the freeze line is removed.', confirm: 'Reset live zone', danger: true, typeToConfirm: typed })) return;
      try { const r = await resetHeap(heap.id); invalidateHeaps(); toast(`Reset — was v${r.previousVersion}, now v${r.version}`); ctx.reload(); }
      catch (e) { toast(errMessage(e), 'err'); }
    },
    delete: async () => {
      if (!await confirmDialog({ title: `Delete "${heap.params.name}" on ${envLabel(env)}?`, body: 'This can\'t be undone.', confirm: 'Delete heap', danger: true, typeToConfirm: typed })) return;
      try { await deleteHeap(heap.id); invalidateHeaps(); toast('Heap deleted'); ctx.go('heaps'); }
      catch (e) { toast(errMessage(e), 'err'); }
    },
  });
}
