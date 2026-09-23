// admin/src/views/bandEditor.ts
//
// The heap silhouette editor.
//
// The heap's shape lives in two layers and the game renders their UNION:
// HeapClient builds its polygon as [...base, ...liveVertices] and buckets to
// bands afterwards. So this editor shows the merged envelope — what players
// actually see — and colours each band by which layer(s) hold it. The server
// decides where an edit is written; the operator never picks a layer.

import { envLabel, ApiError } from '../api';
import { getBands, putBands, worldYToFt } from '../data';
import { html, mount, $, $input, toast, errMessage, confirmDialog, fmtNum } from '../ui';
import { BAND_SIZE_PX } from '../../../shared/heapPolygon/bandEnvelope';

/** Bands visible in the detail pane at once. */
const BAND_WIN = 40;
const COLORS = { live: '#3fb27f', base: '#3987e5', both: '#7fc4c0', dirty: '#f5c518' };

/** Detail-pane geometry, in viewBox units. Shared by the renderer and the
 *  drag's inverse mapping, which must subtract the same gutter the renderer
 *  added or handles stop tracking the pointer. */
const SVG_W = 600;
const ROW_H = 16;
const GUTTER = 88;

/** Max bands per PUT — mirrors MAX_ADMIN_BANDS in server/src/game/routes/heap.ts.
 *  Checked here so a large staged set fails with a clear message instead of
 *  an opaque 400 from the worker. */
const SAVE_CAP = 500;

type Extent = { minX: number; maxX: number };

interface State {
  version: number; baseId: string; freezeY: number; worldHeight: number;
  base: Map<number, Extent>; live: Map<number, Extent>;
  dom: { lo: number; hi: number };
}

export function mountBandEditor(host: HTMLElement, heapId: string, alive: () => boolean): void {
  let st: State | null = null;
  let edits = new Map<number, Extent>();   // staged, unsaved
  let sel: number | null = null;
  let winTop = 0;

  mount(host, html`
    <div class="panel-head" style="margin-bottom:10px">
      <div class="sub">Drag a handle to move a band's edge. The game draws the union of the frozen base and the live zone.</div>
      <div class="tools"><button class="btn" data-role="load">Load silhouette</button></div>
    </div>
    <div data-role="editor" class="hidden">
      <div class="band-layout">
        <div><div class="muted" style="font-size:12px;margin-bottom:4px">All</div>
          <canvas data-role="overview" width="64" height="640" style="width:100%;height:640px;cursor:ns-resize"></canvas></div>
        <div style="min-width:0"><div class="muted" style="font-size:12px;margin-bottom:4px">Bands <span data-role="winLabel" class="dim"></span></div>
          <svg data-role="detail" viewBox="0 0 ${SVG_W} ${BAND_WIN * ROW_H}" style="width:100%;touch-action:none"></svg></div>
        <div class="panel" style="padding:14px">
          <div data-role="meta" class="muted" style="font-size:12.5px;margin-bottom:10px">Select a band.</div>
          <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
            <label class="field"><span>min_x</span><input class="input" type="number" step="1" data-role="minX"></label>
            <label class="field"><span>max_x</span><input class="input" type="number" step="1" data-role="maxX"></label>
          </div>
          <button class="btn sm" data-role="apply" style="margin-top:10px">Apply to band</button>
          <h3 style="margin:18px 0 4px;font-size:13px">Re-derive a range</h3>
          <p class="muted" style="margin:0 0 8px;font-size:12px">Interpolate between the nearest good bands on each side.</p>
          <div class="form-grid" style="grid-template-columns:1fr 1fr;gap:10px">
            <label class="field"><span>From band</span><input class="input" type="number" step="1" data-role="from"></label>
            <label class="field"><span>To band</span><input class="input" type="number" step="1" data-role="to"></label>
          </div>
          <button class="btn sm" data-role="rederive" style="margin-top:10px">Re-derive</button>
        </div>
      </div>
      <div class="band-legend">
        <span class="pill" data-role="dirty">No unsaved edits</span>
        <span class="pill"><span class="sw" style="background:${COLORS.live}"></span>Live zone</span>
        <span class="pill"><span class="sw" style="background:${COLORS.base}"></span>Base</span>
        <span class="pill"><span class="sw" style="background:${COLORS.both}"></span>Both</span>
        <span class="pill"><span class="sw" style="background:${COLORS.dirty}"></span>Edited</span>
        <span class="pill"><span class="sw" style="background:repeating-linear-gradient(90deg,#f5c518 0 3px,transparent 3px 5px)"></span>Freeze line</span>
        <span style="margin-left:auto;display:flex;gap:8px">
          <button class="btn danger" data-role="discard">Discard edits</button>
          <button class="btn primary" data-role="save">Save bands</button>
        </span>
      </div>
    </div>`);

  const q = (role: string) => $(`[data-role="${role}"]`, host);
  const overview = q('overview') as unknown as HTMLCanvasElement;
  const detail = q('detail') as unknown as SVGSVGElement;

  const bandFt = (band: number) => st ? worldYToFt(band * BAND_SIZE_PX + BAND_SIZE_PX / 2, st.worldHeight) : 0;

  /** The union of both layers, with staged edits REPLACING it. An edit is the
   *  operator's intent for the band, not another extent to union in. */
  function merged(): Map<number, Extent> {
    const m = new Map<number, Extent>();
    const put = (b: number, e: Extent) => {
      const cur = m.get(b);
      m.set(b, cur ? { minX: Math.min(cur.minX, e.minX), maxX: Math.max(cur.maxX, e.maxX) } : { ...e });
    };
    for (const [b, e] of st!.base) put(b, e);
    for (const [b, e] of st!.live) put(b, e);
    for (const [b, e] of edits) m.set(b, { ...e });
    return m;
  }
  const layers = (b: number) => {
    const inBase = st!.base.has(b), inLive = st!.live.has(b);
    return inBase && inLive ? 'both' : inBase ? 'base' : 'live';
  };
  const keys = () => [...merged().keys()].sort((a, b) => a - b);

  /** Hold a window top inside the loaded range, so the last window ends on the
   *  last band instead of scrolling off into empty rows. */
  function clampTop(v: number): number {
    const ks = keys();
    if (!ks.length) return 0;
    const first = ks[0], last = ks[ks.length - 1];
    return Math.max(first, Math.min(v, Math.max(first, last - BAND_WIN + 1)));
  }

  /** Fixed once per load. Recomputing during a drag would rescale the pane
   *  under the pointer, so the handle would not follow the cursor. */
  function domain(m: Map<number, Extent>) {
    let lo = Infinity, hi = -Infinity;
    for (const e of m.values()) { lo = Math.min(lo, e.minX); hi = Math.max(hi, e.maxX); }
    if (!isFinite(lo)) return { lo: 0, hi: 1 };
    const pad = Math.max(1, (hi - lo) * 0.2);
    return { lo: lo - pad, hi: hi + pad };
  }

  /** Stage an edit, keeping minX <= maxX. Clamps rather than swapping: the
   *  dragged handle stops at its partner. Omit `side` when both values are
   *  authored at once (the inspector), where ordering them is the sane read. */
  function stage(band: number, next: Extent, side?: 'minX' | 'maxX'): void {
    let { minX, maxX } = next;
    if (side === 'minX') minX = Math.min(minX, maxX);
    else if (side === 'maxX') maxX = Math.max(minX, maxX);
    else { const lo = Math.min(minX, maxX); maxX = Math.max(minX, maxX); minX = lo; }
    edits.set(band, { minX, maxX });
  }

  function renderOverview(): void {
    const ctx = overview.getContext('2d')!;
    const W = overview.width, H = overview.height;
    ctx.clearRect(0, 0, W, H);
    const m = merged(), ks = keys();
    if (!ks.length) return;
    const first = ks[0], rows = ks[ks.length - 1] - first + 1;
    const { lo, hi } = st!.dom;
    const sx = (x: number) => ((x - lo) / (hi - lo)) * W;
    const sy = (b: number) => ((b - first) / rows) * H;
    const rowH = Math.max(1, H / rows);
    for (const b of ks) {
      const e = m.get(b)!;
      ctx.fillStyle = edits.has(b) ? COLORS.dirty : COLORS[layers(b)];
      ctx.fillRect(sx(e.minX), sy(b), Math.max(1, sx(e.maxX) - sx(e.minX)), rowH);
    }
    if (st!.freezeY > 0) {
      const fy = sy(Math.floor(st!.freezeY / BAND_SIZE_PX));
      ctx.strokeStyle = COLORS.dirty; ctx.setLineDash([4, 3]);
      ctx.beginPath(); ctx.moveTo(0, fy); ctx.lineTo(W, fy); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.strokeStyle = '#ffffff';
    ctx.strokeRect(0.5, sy(clampTop(winTop)), W - 1, Math.max(2, rowH * BAND_WIN));
  }

  function renderDetail(): void {
    const m = merged(), ks = keys();
    if (!ks.length) { detail.innerHTML = ''; return; }
    const top = clampTop(winTop);
    const { lo, hi } = st!.dom;
    const sx = (x: number) => GUTTER + ((x - lo) / (hi - lo)) * (SVG_W - GUTTER);
    const cy = (b: number) => (b - top) * ROW_H + ROW_H / 2;

    // Left axis for every row in the window — a gap has to be locatable too.
    // Every fifth row carries the ft reading and a rule across the plot.
    const axis: string[] = [`<line x1="${GUTTER - 5}" y1="0" x2="${GUTTER - 5}" y2="${BAND_WIN * ROW_H}" stroke="#2a3034"/>`];
    for (let b = top; b < top + BAND_WIN; b++) {
      const y = cy(b), major = b % 5 === 0;
      axis.push(`<text x="6" y="${y + 3}" font-size="9" font-family="monospace" fill="${major ? '#8b9195' : '#4a5155'}">${b}</text>`);
      if (!major) continue;
      axis.push(`<text x="${GUTTER - 10}" y="${y + 3}" text-anchor="end" font-size="9" font-family="monospace" fill="#7fc4c0">${bandFt(b)}ft</text>`);
      axis.push(`<line x1="${GUTTER}" y1="${y}" x2="${SVG_W}" y2="${y}" stroke="#1c2124"/>`);
    }

    const bars: string[] = [], edges: string[] = [], handles: string[] = [];
    let prev: { band: number; x0: number; x1: number; y: number } | null = null;
    for (let b = top; b < top + BAND_WIN; b++) {
      const e = m.get(b);
      if (!e) continue;                       // genuinely empty band — a gap
      const col = edits.has(b) ? COLORS.dirty : COLORS[layers(b)];
      const y = cy(b), x0 = sx(e.minX), x1 = sx(e.maxX);
      bars.push(`<rect x="${x0}" y="${y - 5}" width="${Math.max(1, x1 - x0)}" height="10" fill="${col}" opacity="0.45" data-band="${b}"/>`);
      // A segment spanning a missing band is dashed: that dashed run IS the
      // forward-fill sawtooth, and the only way a gap is visible at all.
      if (prev) {
        const dash = b !== prev.band + 1 ? ' stroke-dasharray="4 3" opacity="0.5"' : '';
        edges.push(`<line x1="${prev.x0}" y1="${prev.y}" x2="${x0}" y2="${y}" stroke="${col}" stroke-width="1.2"${dash}/>`);
        edges.push(`<line x1="${prev.x1}" y1="${prev.y}" x2="${x1}" y2="${y}" stroke="${col}" stroke-width="1.2"${dash}/>`);
      }
      prev = { band: b, x0, x1, y };
      const ring = b === sel ? '#ffffff' : col;
      for (const side of ['minX', 'maxX'] as const) {
        handles.push(`<rect data-band="${b}" data-side="${side}" x="${sx(e[side]) - 4}" y="${y - 4}" width="8" height="8"
          fill="#0c0e0f" stroke="${ring}" stroke-width="1.5" style="cursor:ew-resize"/>`);
      }
    }
    let freeze = '';
    if (st!.freezeY > 0) {
      const fb = Math.floor(st!.freezeY / BAND_SIZE_PX);
      if (fb >= top && fb < top + BAND_WIN) {
        const fy = cy(fb) - ROW_H / 2;
        freeze = `<line x1="${GUTTER}" y1="${fy}" x2="${SVG_W}" y2="${fy}" stroke="${COLORS.dirty}" stroke-dasharray="4 3"/>`;
      }
    }
    // Every value above is a number or a fixed constant — no string from the
    // server reaches this markup, so it is assembled directly.
    detail.innerHTML = axis.join('') + bars.join('') + edges.join('') + freeze + handles.join('');
    q('winLabel').textContent = `${top}–${top + BAND_WIN - 1} · ${fmtNum(bandFt(top))} → ${fmtNum(bandFt(top + BAND_WIN - 1))} ft`;
  }

  function renderInspector(): void {
    const minI = $input('[data-role="minX"]', host), maxI = $input('[data-role="maxX"]', host);
    if (sel === null) { q('meta').textContent = 'Select a band.'; minI.value = ''; maxI.value = ''; return; }
    const e = merged().get(sel);
    if (!e) { q('meta').textContent = `Band ${sel} is empty.`; return; }
    const y0 = sel * BAND_SIZE_PX;
    mount(q('meta'), html`Band <b>${sel}</b> · y ${y0}–${y0 + BAND_SIZE_PX} · <b>${fmtNum(bandFt(sel))} ft</b> in game<br>${layers(sel)} · width ${Math.round(e.maxX - e.minX)}`);
    minI.value = String(e.minX);
    maxI.value = String(e.maxX);
  }

  function renderAll(): void {
    if (!st) return;
    renderOverview(); renderDetail(); renderInspector();
    q('dirty').textContent = edits.size ? `${edits.size} unsaved band edit${edits.size === 1 ? '' : 's'}` : 'No unsaved edits';
    q('dirty').className = edits.size ? 'pill warn' : 'pill';
  }

  async function load(): Promise<void> {
    try {
      const d = await getBands(heapId);
      if (!alive()) return;
      st = {
        version: d.version, baseId: d.baseId, freezeY: d.freezeY, worldHeight: d.worldHeight,
        base: new Map(d.baseBands.map((b) => [b.band, { minX: b.minX, maxX: b.maxX }])),
        live: new Map(d.liveBands.map((b) => [b.band, { minX: b.minX, maxX: b.maxX }])),
        dom: { lo: 0, hi: 1 },
      };
      edits = new Map(); sel = null;
      st.dom = domain(merged());
      const ks = keys();
      winTop = ks.length ? ks[0] : 0;
      q('editor').classList.remove('hidden');
      q('load').textContent = 'Reload';
      renderAll();
      toast(`Silhouette loaded — v${d.version}, ${ks.length} bands`);
    } catch (e) {
      toast('Couldn\'t load the silhouette: ' + errMessage(e), 'err');
    }
  }

  q('load').addEventListener('click', async () => {
    if (edits.size && !await confirmDialog({ title: 'Reload the silhouette?', body: `This discards ${edits.size} unsaved band edit(s).`, confirm: 'Discard and reload', danger: true })) return;
    load();
  });

  // Overview: drag to scrub the window.
  let scrubbing = false;
  const scrub = (ev: PointerEvent) => {
    if (!st) return;
    const ks = keys();
    if (!ks.length) return;
    const r = overview.getBoundingClientRect();
    const frac = Math.min(1, Math.max(0, (ev.clientY - r.top) / r.height));
    winTop = clampTop(Math.round(ks[0] + frac * (ks[ks.length - 1] - ks[0] + 1)) - Math.floor(BAND_WIN / 2));
    renderAll();
  };
  overview.addEventListener('pointerdown', (ev) => { scrubbing = true; overview.setPointerCapture(ev.pointerId); scrub(ev); });
  overview.addEventListener('pointermove', (ev) => { if (scrubbing) scrub(ev); });
  overview.addEventListener('pointerup', (ev) => { scrubbing = false; overview.releasePointerCapture(ev.pointerId); });

  // Wheel pans by rows. The overview moves ~6 bands per pixel on a big heap —
  // far too coarse to land on one — so the wheel is the fine control.
  const onWheel = (ev: WheelEvent) => {
    if (!st) return;
    ev.preventDefault();
    const rows = ev.deltaMode === 1 ? ev.deltaY * 3 : ev.deltaMode === 2 ? ev.deltaY * BAND_WIN : ev.deltaY / ROW_H;
    // Round away from zero so a small trackpad nudge still moves.
    const step = rows > 0 ? Math.max(1, Math.round(rows)) : Math.min(-1, Math.round(rows));
    const next = clampTop(winTop + step);
    if (next !== winTop) { winTop = next; renderAll(); }
  };
  detail.addEventListener('wheel', onWheel, { passive: false });
  overview.addEventListener('wheel', onWheel, { passive: false });

  // Detail: click a bar to select, drag a handle to move an edge.
  let drag: { band: number; side: 'minX' | 'maxX'; start: Extent } | null = null;
  /** Pointer x -> world x, whole pixels. Inverts renderDetail's sx, gutter included. */
  const worldX = (ev: PointerEvent) => {
    const { lo, hi } = st!.dom;
    const r = detail.getBoundingClientRect();
    const vx = ((ev.clientX - r.left) / r.width) * SVG_W;
    return Math.round(lo + ((vx - GUTTER) / (SVG_W - GUTTER)) * (hi - lo));
  };
  detail.addEventListener('pointerdown', (ev) => {
    if (!st) return;
    const ds = (ev.target as SVGElement).dataset;
    if (!ds || ds.band === undefined) return;
    sel = Number(ds.band);
    if (ds.side) {
      const cur = edits.get(sel) ?? merged().get(sel);
      if (cur) {
        drag = { band: sel, side: ds.side as 'minX' | 'maxX', start: { ...cur } };
        detail.setPointerCapture(ev.pointerId);
      }
    }
    renderAll();
    ev.preventDefault();
  });
  detail.addEventListener('pointermove', (ev) => {
    if (!drag) return;
    const next = { ...drag.start };
    next[drag.side] = worldX(ev);
    stage(drag.band, next, drag.side);
    renderAll();
  });
  const endDrag = (ev: PointerEvent) => {
    if (!drag) return;
    drag = null;
    try { detail.releasePointerCapture(ev.pointerId); } catch { /* already released */ }
  };
  detail.addEventListener('pointerup', endDrag);
  detail.addEventListener('pointercancel', endDrag);

  q('apply').addEventListener('click', () => {
    if (sel === null || !st) return;
    const minX = parseFloat($input('[data-role="minX"]', host).value);
    const maxX = parseFloat($input('[data-role="maxX"]', host).value);
    if (!isFinite(minX) || !isFinite(maxX)) { toast('min_x and max_x must be numbers', 'err'); return; }
    stage(sel, { minX, maxX });
    renderAll();
  });

  /**
   * Recompute a band range by interpolating between the nearest good bands on
   * either side. Two rules borrowed from interpolateBandSeed in shared/: a
   * single-extent band is skipped as a seed (its unknown side is itself a
   * forward-filled guess), and a seed is required on BOTH sides. Runs here so
   * the result is visible before it is saved — the preview is the check.
   */
  q('rederive').addEventListener('click', () => {
    if (!st) return;
    const from = parseInt($input('[data-role="from"]', host).value, 10);
    const to = parseInt($input('[data-role="to"]', host).value, 10);
    if (!Number.isInteger(from) || !Number.isInteger(to) || to < from) {
      toast('Re-derive needs a whole-number band range with from ≤ to', 'err'); return;
    }
    const m = merged();
    let above: number | null = null, below: number | null = null;
    for (const [b, e] of m) {
      if (e.minX === e.maxX) continue;
      if (b < from && (above === null || b > above)) above = b;
      if (b > to && (below === null || b < below)) below = b;
    }
    if (above === null || below === null) { toast('Re-derive needs a two-sided band both above and below the range', 'err'); return; }
    const a = m.get(above)!, z = m.get(below)!;
    for (let b = from; b <= to; b++) {
      const t = (b - above) / (below - above);
      stage(b, { minX: Math.round(a.minX + (z.minX - a.minX) * t), maxX: Math.round(a.maxX + (z.maxX - a.maxX) * t) });
    }
    renderAll();
    toast(`Re-derived bands ${from}–${to} from ${above} and ${below}`);
  });

  /** True when saving would rewrite base geometry. Mirrors the server's
   *  routing rule: the base carries a band it already holds, and takes a
   *  brand-new band at or below the freeze line. */
  const touchesBase = () => {
    const freezeBand = st!.freezeY > 0 ? Math.floor(st!.freezeY / BAND_SIZE_PX) : Infinity;
    for (const b of edits.keys()) {
      if (st!.base.has(b)) return true;
      if (!st!.live.has(b) && b >= freezeBand) return true;
    }
    return false;
  };

  q('save').addEventListener('click', async () => {
    if (!st || !edits.size) { toast('Nothing to save'); return; }
    const bands = [...edits.entries()].map(([band, e]) => ({ band, minX: e.minX, maxX: e.maxX }));
    if (bands.length > SAVE_CAP) {
      toast(`${bands.length} staged edits exceeds the ${SAVE_CAP}-band save cap — discard some or save in batches`, 'err');
      return;
    }
    // Every save mints a fresh baseId, so every player's client re-downloads
    // the base for this heap. Only base-layer edits change base GEOMETRY. Both
    // costs are real; say both, or a live-only save reads as free.
    const ok = await confirmDialog({
      title: `Save ${bands.length} band(s) to ${envLabel()}?`,
      body: touchesBase()
        ? 'This rewrites base geometry and makes every player\'s client re-download the base.'
        : 'Base geometry is unchanged, but this still mints a new base id — every player\'s client will re-download the base.',
      confirm: 'Save bands',
    });
    if (!ok || !alive()) return;
    try {
      const res = await putBands(heapId, { expectedVersion: st.version, expectedBaseId: st.baseId, bands });
      if (!alive()) return;
      toast(`Saved ${bands.length} band(s) — now v${res.version}`);
      await load();
    } catch (e) {
      if (!alive()) return;
      if (e instanceof ApiError && e.status === 409) {
        const v = (e.body as { version?: number } | null)?.version;
        toast(`The heap changed on the server${v ? ` (now v${v})` : ''} — reload the silhouette and re-apply`, 'err');
        return;
      }
      toast('Save failed: ' + errMessage(e), 'err');
    }
  });

  q('discard').addEventListener('click', async () => {
    if (!edits.size) return;
    if (!await confirmDialog({ title: `Discard ${edits.size} band edit(s)?`, confirm: 'Discard', danger: true })) return;
    edits = new Map();
    renderAll();
  });
}
