// admin/src/main.ts
//
// Shell: env tape, sidebar, hash router, environment settings.

import './styles.css';
import {
  ENVS, currentEnv, envLabel, serverUrl, secretFor, writeSecret, saveEnv, customUrl,
  migrateLegacySettings, onHealth, onAuthRejected, type EnvId,
} from './api';
import { html, mount, $, $input, icon, openDrawer, toast, bootCopyButtons, lsGet, lsSet } from './ui';
import { invalidateHeaps } from './data';
import { refreshFeedbackBadge } from './badges';
import type { Ctx, View } from './ctx';
import { overviewView } from './views/overview';
import { analyticsView } from './views/analytics';
import { heapsView, heapDetailView } from './views/heaps';
import { playersView } from './views/players';
import { feedbackView } from './views/feedback';
import { codesView } from './views/codes';
import { configView } from './views/config';

const NAV: { path: string; label: string; icon: string; view: View }[] = [
  { path: '',          label: 'Overview',  icon: 'overview',  view: overviewView },
  { path: 'analytics', label: 'Analytics', icon: 'analytics', view: analyticsView },
  { path: 'heaps',     label: 'Heaps',     icon: 'heaps',     view: heapsView },
  { path: 'players',   label: 'Players',   icon: 'players',   view: playersView },
  { path: 'feedback',  label: 'Feedback',  icon: 'feedback',  view: feedbackView },
  { path: 'codes',     label: 'Codes',     icon: 'codes',     view: codesView },
  { path: 'config',    label: 'Config',    icon: 'config',    view: configView },
];

function renderShell(): void {
  mount(document.body, html`
    <div class="tape" id="tape"></div>
    <div class="shell">
      <aside class="side">
        <div class="brand">Heap <small>admin</small></div>
        <nav class="nav" id="nav">
          ${NAV.map((n) => html`<a href="#/${n.path}" data-path="${n.path}">${icon(n.icon)}<span class="lbl">${n.label}</span>
            ${n.path === 'feedback' ? html`<span class="count hidden" id="fbCount"></span>` : ''}</a>`)}
        </nav>
        <div class="side-foot">
          <button class="btn ghost sm" id="themeBtn" type="button" title="Switch light/dark">${icon('theme')}<span class="lbl">Theme</span></button>
          <button class="env-chip" id="envChip" type="button" title="Environment and admin secret">
            <span class="swatch"></span>
            <span style="min-width:0"><b id="envName"></b><span id="envUrl"></span></span>
            <span class="health" id="health"></span>
          </button>
        </div>
      </aside>
      <main class="main" id="main"></main>
    </div>`);
}

function refreshEnvChrome(): void {
  const env = currentEnv();
  $('#tape').dataset.env = env;
  $('#envChip').dataset.env = env;
  $('#envName').textContent = envLabel(env) + (secretFor(env) ? '' : ' · no secret');
  $('#envUrl').textContent = serverUrl(env) || 'no URL set';
  delete $('#health').dataset.ok;
  document.title = env === 'prod' ? 'PROD · Heap admin' : `Heap admin · ${envLabel(env)}`;
}

// ── Router ───────────────────────────────────────────────────────────────

let generation = 0;

function route(): void {
  const gen = ++generation;
  const [path, search = ''] = location.hash.replace(/^#\/?/, '').split('?');
  // A hand-edited hash like `#/players/%E` would make decodeURIComponent
  // throw out of the hashchange listener, leaving the old page up with no
  // error. Keep the raw segment instead.
  const safeDecode = (seg: string) => { try { return decodeURIComponent(seg); } catch { return seg; } };
  const parts = path.split('/').filter(Boolean).map(safeDecode);
  const head = parts[0] ?? '';
  let view: View;
  const params = parts.slice(1);
  if (head === 'heaps' && params.length) view = heapDetailView;
  else view = (NAV.find((n) => n.path === head) ?? NAV[0]).view;
  const navPath = NAV.some((n) => n.path === head) ? head : '';
  document.querySelectorAll<HTMLAnchorElement>('#nav a').forEach((a) => {
    if (a.dataset.path === navPath) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
  });

  // A fresh element per render: any listener a view bound to the old root
  // goes with it, so views can wire their root freely.
  const main = $('#main');
  const root = document.createElement('div');
  main.replaceChildren(root);
  const ctx: Ctx = {
    root, params, query: new URLSearchParams(search),
    alive: () => gen === generation,
    reload: () => { if (gen === generation) route(); },
    go: (p) => { location.hash = '#/' + p; },
  };
  Promise.resolve(view(ctx)).catch((e) => {
    if (!ctx.alive()) return;
    console.error(e);
    mount(root, html`<div class="note bad"><div><b>This page failed to load.</b><br>${e instanceof Error ? e.message : String(e)}</div></div>`);
  });
}

// ── Environment settings ─────────────────────────────────────────────────

function openSettings(reason?: string): void {
  // Several reads can 401 at once; one drawer is enough.
  if (document.getElementById('setEnv')) return;
  const env = currentEnv();
  const { body, close } = openDrawer('Environment', html`
    ${reason ? html`<div class="note bad" style="margin-bottom:16px"><div>${reason}</div></div>` : ''}
    <section>
      <label class="field"><span>Server</span>
        <select class="input" id="setEnv">
          ${(Object.keys(ENVS) as EnvId[]).map((k) => html`<option value="${k}" ${k === env ? 'selected' : ''}>${ENVS[k].label}${ENVS[k].url ? ` — ${ENVS[k].url}` : ''}</option>`)}
        </select></label>
      <label class="field ${env === 'custom' ? '' : 'hidden'}" id="setUrlWrap" style="margin-top:12px"><span>Custom server URL</span>
        <input class="input" id="setUrl" placeholder="http://localhost:8787" value="${customUrl()}"></label>
      <label class="field" style="margin-top:12px"><span>Admin secret</span>
        <span style="display:flex;gap:6px">
          <input class="input" id="setSecret" type="password" autocomplete="off" spellcheck="false" value="${secretFor(env)}"
                 placeholder="Leave blank if this server has no secret">
          <button class="btn sm" type="button" id="setEye" title="Show or hide the secret" style="height:34px">${icon('eye')}</button>
        </span>
        <small>Saved in this browser, separately for each environment.</small></label>
      <div class="form-actions"><button class="btn primary" id="setSave">Save and connect</button></div>
    </section>`);
  const envSel = $('#setEnv', body) as HTMLSelectElement;
  envSel.addEventListener('change', () => {
    const e = envSel.value as EnvId;
    $('#setUrlWrap', body).classList.toggle('hidden', e !== 'custom');
    $input('#setSecret', body).value = secretFor(e);
  });
  $('#setEye', body).addEventListener('click', () => {
    const i = $input('#setSecret', body);
    i.type = i.type === 'password' ? 'text' : 'password';
    mount($('#setEye', body), icon(i.type === 'password' ? 'eye' : 'eyeOff'));
  });
  $('#setSave', body).addEventListener('click', () => {
    const e = envSel.value as EnvId;
    saveEnv(e, $input('#setUrl', body).value.trim());
    writeSecret(e, $input('#setSecret', body).value.trim());
    close();
    switchedEnv();
    toast(`Connected to ${envLabel(e)}`);
  });
}

function switchedEnv(): void {
  invalidateHeaps();
  refreshEnvChrome();
  route();
  refreshFeedbackBadge();
}

// ── Theme ────────────────────────────────────────────────────────────────

const LS_THEME = 'heapAdmin.theme';
function applyTheme(t: string | null): void {
  if (t === 'light' || t === 'dark') document.documentElement.dataset.theme = t;
  else delete document.documentElement.dataset.theme;
}
function toggleTheme(): void {
  const cur = document.documentElement.dataset.theme
    ?? (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
  const next = cur === 'light' ? 'dark' : 'light';
  lsSet(LS_THEME, next);
  applyTheme(next);
}

// ── Boot ─────────────────────────────────────────────────────────────────

applyTheme(lsGet(LS_THEME));
migrateLegacySettings();
renderShell();
bootCopyButtons();
refreshEnvChrome();
$('#envChip').addEventListener('click', () => openSettings());
$('#themeBtn').addEventListener('click', toggleTheme);
onHealth((ok, env) => { if (env === currentEnv()) $('#health').dataset.ok = String(ok); });
onAuthRejected(() => {
  refreshEnvChrome();
  openSettings(`${envLabel()} rejected the saved admin secret, so it has been cleared. Enter the correct one.`);
});
window.addEventListener('hashchange', route);
route();
refreshFeedbackBadge();
