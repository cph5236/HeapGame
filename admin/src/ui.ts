// admin/src/ui.ts
//
// DOM helpers, dialogs, toasts and formatters.
//
// Every view builds markup through the `html` tagged template, which ESCAPES
// every interpolated value unless it is explicitly wrapped in `raw()` (or is
// itself the output of `html`). This page renders player-supplied strings —
// names, feedback, trace payloads — beside a stored production admin secret,
// and the old page has had an XSS finding before. Escape-by-default makes a
// forgotten `escapeHtml` impossible rather than merely unlikely.

export class Raw {
  constructor(readonly s: string) {}
  toString(): string { return this.s; }
}

export function raw(s: string): Raw { return new Raw(s); }

export function esc(s: unknown): string {
  return String(s).replace(/[&<>"']/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

type Val = unknown;

function part(v: Val): string {
  if (v instanceof Raw) return v.s;
  if (v === null || v === undefined || v === false) return '';
  if (Array.isArray(v)) return v.map(part).join('');
  return esc(v);
}

export function html(strings: TemplateStringsArray, ...vals: Val[]): Raw {
  let out = strings[0];
  for (let i = 0; i < vals.length; i++) out += part(vals[i]) + strings[i + 1];
  return new Raw(out);
}

export function mount(el: Element, content: Raw): void {
  el.innerHTML = content.s;
}

export function $(sel: string, root: ParentNode = document): HTMLElement {
  const el = root.querySelector<HTMLElement>(sel);
  if (!el) throw new Error(`missing element: ${sel}`);
  return el;
}

export function $input(sel: string, root: ParentNode = document): HTMLInputElement {
  return $(sel, root) as HTMLInputElement;
}

/**
 * Delegated click handling by `data-action`. Views re-render their markup
 * wholesale, so a listener bound to one button would be lost on the next
 * render; one listener on a stable root survives all of them.
 */
export function onAction(
  root: HTMLElement,
  handlers: Record<string, (el: HTMLElement, ev: MouseEvent) => void>,
): void {
  root.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action]');
    if (!el || !root.contains(el)) return;
    const fn = handlers[el.dataset.action!];
    if (fn) { ev.preventDefault(); fn(el, ev); }
  });
}

// ── Icons (inline, stroke-based) ─────────────────────────────────────────

const ICON_PATHS: Record<string, string> = {
  overview: '<path d="M3 13h8V3H3zM13 21h8V11h-8zM3 21h8v-6H3zM13 3v6h8V3z"/>',
  analytics: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
  heaps: '<path d="M2 20h20L15 8l-3 4-3-3z"/><path d="M9 9l-2-4"/>',
  players: '<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20a6.5 6.5 0 0 1 13 0"/><path d="M16 4.5a3.5 3.5 0 0 1 0 7M18.5 20a6.5 6.5 0 0 0-2.8-5.3"/>',
  feedback: '<path d="M21 15a2 2 0 0 1-2 2H8l-5 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
  codes: '<path d="M20 12v8H4v-8M2 7h20v5H2zM12 20V7M12 7H8a2.5 2.5 0 1 1 0-5c3 0 4 5 4 5zM12 7h4a2.5 2.5 0 1 0 0-5c-3 0-4 5-4 5z"/>',
  config: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-2.6-6.4M21 3v6h-6"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  eye: '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  eyeOff: '<path d="M17.9 17.9A10 10 0 0 1 12 20c-7 0-11-8-11-8a18.5 18.5 0 0 1 5.1-5.9M9.9 4.2A9 9 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.2 3.2M1 1l22 22"/>',
  theme: '<path d="M12 3a9 9 0 1 0 9 9 7 7 0 0 1-9-9z"/>',
};

export function icon(name: string): Raw {
  return raw(`<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
    stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICON_PATHS[name] ?? ''}</svg>`);
}

/** A player/heap id, truncated by CSS, with a copy button. */
export function idCell(id: string): Raw {
  return html`<span class="idcell"><code title="${id}">${id}</code><button class="copy" type="button"
    data-action="copy" data-copy="${id}" title="Copy id" aria-label="Copy id">${icon('copy')}</button></span>`;
}

/** Wire once on the document: every `data-action="copy"` copies its `data-copy`. */
export function bootCopyButtons(): void {
  document.addEventListener('click', (ev) => {
    const el = (ev.target as HTMLElement).closest<HTMLElement>('[data-action="copy"]');
    if (!el) return;
    ev.preventDefault();
    ev.stopPropagation();
    navigator.clipboard.writeText(el.dataset.copy ?? '')
      .then(() => toast('Copied'))
      .catch(() => toast('Copy failed — clipboard access was refused', 'err'));
  }, true);
}

// ── Toasts ───────────────────────────────────────────────────────────────

export function toast(msg: string, kind: 'ok' | 'err' = 'ok'): void {
  let host = document.querySelector('.toasts');
  if (!host) {
    host = document.createElement('div');
    host.className = 'toasts';
    host.setAttribute('role', 'status');
    host.setAttribute('aria-live', 'polite');
    document.body.appendChild(host);
  }
  const el = document.createElement('div');
  el.className = 'toast' + (kind === 'err' ? ' err' : '');
  el.textContent = msg;
  host.appendChild(el);
  setTimeout(() => el.remove(), kind === 'err' ? 7000 : 3200);
}

export function errMessage(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

// ── Dialogs ──────────────────────────────────────────────────────────────

interface ConfirmOpts {
  title: string;
  body?: string;
  confirm?: string;
  danger?: boolean;
  /** When set, the confirm button stays disabled until this exact text is typed. */
  typeToConfirm?: string;
}

function openLayer(cls: string, content: Raw): { box: HTMLElement; close: () => void } {
  const scrim = document.createElement('div');
  scrim.className = 'scrim' + (cls === 'dialog' ? ' dialog-scrim' : '');
  const box = document.createElement('div');
  box.className = cls;
  box.setAttribute('role', 'dialog');
  box.setAttribute('aria-modal', 'true');
  box.innerHTML = content.s;
  document.body.append(scrim, box);
  const prevFocus = document.activeElement as HTMLElement | null;
  // Escape closes only the topmost layer — a confirm opened from a drawer
  // must not take the drawer down with it.
  const onKey = (ev: KeyboardEvent) => {
    if (ev.key !== 'Escape') return;
    const layers = document.querySelectorAll('.drawer, .dialog');
    if (layers[layers.length - 1] === box) close();
  };
  function close(): void {
    scrim.remove(); box.remove();
    document.removeEventListener('keydown', onKey);
    window.removeEventListener('hashchange', close);
    prevFocus?.focus?.();
  }
  scrim.addEventListener('click', close);
  document.addEventListener('keydown', onKey);
  // A link inside a layer (a heap name in the player drawer) navigates away;
  // the layer belongs to the page it was opened on.
  window.addEventListener('hashchange', close);
  return { box, close };
}

export function confirmDialog(o: ConfirmOpts): Promise<boolean> {
  return new Promise((resolve) => {
    const { box, close } = openLayer('dialog', html`
      <h2>${o.title}</h2>
      ${o.body ? html`<p>${o.body}</p>` : ''}
      ${o.typeToConfirm ? html`<label class="field"><span>Type <b>${o.typeToConfirm}</b> to confirm</span>
        <input class="input" data-role="type" autocomplete="off" spellcheck="false"></label>` : ''}
      <div class="form-actions">
        <button class="btn ghost" data-role="cancel">Cancel</button>
        <button class="btn ${o.danger ? 'danger solid' : 'primary'}" data-role="ok">${o.confirm ?? 'Confirm'}</button>
      </div>`);
    let settled = false;
    const done = (v: boolean) => { if (settled) return; settled = true; close(); resolve(v); };
    const ok = $('[data-role="ok"]', box) as HTMLButtonElement;
    const typed = box.querySelector<HTMLInputElement>('[data-role="type"]');
    if (typed) {
      ok.disabled = true;
      typed.addEventListener('input', () => { ok.disabled = typed.value !== o.typeToConfirm; });
      typed.addEventListener('keydown', (ev) => { if (ev.key === 'Enter' && !ok.disabled) done(true); });
      typed.focus();
    } else {
      ok.focus();
    }
    ok.addEventListener('click', () => done(true));
    $('[data-role="cancel"]', box).addEventListener('click', () => done(false));
    // Scrim click / Escape close the layer without resolving — resolve false.
    new MutationObserver((_, obs) => { if (!box.isConnected) { obs.disconnect(); done(false); } })
      .observe(document.body, { childList: true });
  });
}

/** Single-line text prompt. Resolves null on cancel. */
export function promptDialog(o: { title: string; body?: string; label: string; confirm: string; danger?: boolean }): Promise<string | null> {
  return new Promise((resolve) => {
    const { box, close } = openLayer('dialog', html`
      <h2>${o.title}</h2>
      ${o.body ? html`<p>${o.body}</p>` : ''}
      <label class="field"><span>${o.label}</span><input class="input" data-role="val" maxlength="500"></label>
      <div class="form-actions">
        <button class="btn ghost" data-role="cancel">Cancel</button>
        <button class="btn ${o.danger ? 'danger solid' : 'primary'}" data-role="ok">${o.confirm}</button>
      </div>`);
    let settled = false;
    const input = $input('[data-role="val"]', box);
    const done = (v: string | null) => { if (settled) return; settled = true; close(); resolve(v); };
    input.focus();
    input.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') done(input.value); });
    $('[data-role="ok"]', box).addEventListener('click', () => done(input.value));
    $('[data-role="cancel"]', box).addEventListener('click', () => done(null));
    new MutationObserver((_, obs) => { if (!box.isConnected) { obs.disconnect(); done(null); } })
      .observe(document.body, { childList: true });
  });
}

/** A right-hand drawer. Returns its body element and a close function. */
export function openDrawer(title: string | Raw, content: Raw): { body: HTMLElement; close: () => void } {
  const { box, close } = openLayer('drawer', html`
    <div class="drawer-head"><h2>${title}</h2>
      <button class="btn ghost sm close" data-role="close" aria-label="Close">${icon('close')}</button></div>
    <div data-role="body">${content}</div>`);
  $('[data-role="close"]', box).addEventListener('click', close);
  return { body: $('[data-role="body"]', box), close };
}

// ── Formatters ───────────────────────────────────────────────────────────

const nf = new Intl.NumberFormat();
export function fmtNum(n: number): string { return nf.format(n); }

export function fmtPct(n: number, digits = 1): string {
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtDateTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (!Number.isFinite(d.getTime())) return String(iso);
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function relTime(iso: string | number | null | undefined): string {
  if (iso === null || iso === undefined || iso === '') return '—';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return String(iso);
  const s = Math.round((Date.now() - t) / 1000);
  const abs = Math.abs(s);
  const fmt = (v: number, u: string) => (s >= 0 ? `${v}${u} ago` : `in ${v}${u}`);
  if (abs < 60) return s >= 0 ? 'just now' : 'in <1m';
  if (abs < 3600) return fmt(Math.round(abs / 60), 'm');
  if (abs < 86400) return fmt(Math.round(abs / 3600), 'h');
  if (abs < 86400 * 45) return fmt(Math.round(abs / 86400), 'd');
  return fmtDate(new Date(t).toISOString());
}

/** A "+12% vs previous" delta element. Returns '' when there is no baseline. */
export function deltaText(cur: number, prev: number): Raw {
  if (prev === 0 && cur === 0) return html`<span class="muted">no change</span>`;
  if (prev === 0) return html`<span class="delta up">new</span>`;
  const d = (cur - prev) / prev;
  const cls = d > 0 ? 'up' : d < 0 ? 'down' : '';
  const sign = d > 0 ? '+' : '';
  return html`<span class="delta ${cls}">${sign}${(d * 100).toFixed(0)}%</span>`;
}

// ── Local storage (per-viewer conveniences only) ─────────────────────────

export function lsGet(key: string): string | null {
  try { return localStorage.getItem(key); } catch { return null; }
}
export function lsSet(key: string, val: string | null): void {
  try {
    if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
  } catch { /* storage blocked — the page still works, it just forgets */ }
}
