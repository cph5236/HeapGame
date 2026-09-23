// admin/src/api.ts
//
// Environments, per-environment admin secrets, and the fetch wrappers.

import { lsGet, lsSet } from './ui';

const LS_ENV        = 'heapAdmin.env';
const LS_CUSTOM_URL = 'heapAdmin.customUrl';
const LS_SECRETS    = 'heapAdmin.secrets';
// Legacy single-env keys, migrated then deleted on first boot.
const LS_LEGACY_URL    = 'heapAdmin.serverUrl';
const LS_LEGACY_SECRET = 'heapAdmin.adminSecret';

export type EnvId = 'local' | 'staging' | 'prod' | 'custom';

// Staging and production are separate Workers with separate ADMIN_SECRETs —
// see server/wrangler.toml.
export const ENVS: Record<EnvId, { label: string; url: string | null }> = {
  local:   { label: 'Local',      url: 'http://localhost:8787' },
  staging: { label: 'Staging',    url: 'https://heap-server-staging.hanlinsoftwaresws.workers.dev' },
  prod:    { label: 'Production', url: 'https://heap-server.hanlinsoftwaresws.workers.dev' },
  custom:  { label: 'Custom',     url: null },
};

function stripSlash(u: string | null | undefined): string {
  return String(u ?? '').replace(/\/$/, '');
}

export function currentEnv(): EnvId {
  const env = lsGet(LS_ENV);
  return env && Object.prototype.hasOwnProperty.call(ENVS, env) ? env as EnvId : 'local';
}

export function envLabel(env: EnvId = currentEnv()): string { return ENVS[env].label; }

export function customUrl(): string { return lsGet(LS_CUSTOM_URL) ?? ''; }

export function serverUrl(env: EnvId = currentEnv()): string {
  return stripSlash(env === 'custom' ? customUrl() : ENVS[env].url);
}

// Secrets are per-environment: one shared value would 401 on every switch.
function readSecrets(): Record<string, string> {
  try {
    const parsed = JSON.parse(lsGet(LS_SECRETS) ?? '{}');
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function secretFor(env: EnvId = currentEnv()): string {
  return readSecrets()[env] ?? '';
}

export function writeSecret(env: EnvId, secret: string): void {
  const all = readSecrets();
  if (secret) all[env] = secret; else delete all[env];
  lsSet(LS_SECRETS, JSON.stringify(all));
}

/** Persist the environment choice. Callers re-render; see main.ts. */
export function saveEnv(env: EnvId, url?: string): void {
  lsSet(LS_ENV, env);
  if (env === 'custom' && url !== undefined) lsSet(LS_CUSTOM_URL, stripSlash(url));
}

/** One-time move from the pre-multi-env keys. Idempotent. */
export function migrateLegacySettings(): void {
  const legacyUrl = lsGet(LS_LEGACY_URL);
  const legacySecret = lsGet(LS_LEGACY_SECRET);
  if (legacyUrl === null && legacySecret === null) return;
  const url = stripSlash(legacyUrl || ENVS.local.url);
  let env = (Object.keys(ENVS) as EnvId[]).find((k) => ENVS[k].url && stripSlash(ENVS[k].url) === url);
  if (!env) {
    env = 'custom';
    lsSet(LS_CUSTOM_URL, url);
  }
  lsSet(LS_ENV, env);
  if (legacySecret) writeSecret(env, legacySecret);
  lsSet(LS_LEGACY_URL, null);
  lsSet(LS_LEGACY_SECRET, null);
}

// ── Health + auth events ─────────────────────────────────────────────────

type Listener = () => void;
const healthListeners: ((ok: boolean, env: EnvId) => void)[] = [];
const authListeners: Listener[] = [];

/** `env` is the environment that issued the request — a late response from an
 *  environment the operator has since left must not repaint the dot. */
export function onHealth(fn: (ok: boolean, env: EnvId) => void): void { healthListeners.push(fn); }
/** Fired when a secret is rejected and cleared — the shell reopens settings. */
export function onAuthRejected(fn: Listener): void { authListeners.push(fn); }

function reportHealth(ok: boolean, env: EnvId): void { for (const fn of healthListeners) fn(ok, env); }

// ── Fetch ────────────────────────────────────────────────────────────────

export class ApiError extends Error {
  constructor(message: string, readonly status: number, readonly body: unknown = null) {
    super(message);
  }
}

async function errorFrom(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null) as { error?: string } | null;
  const detail = body && typeof body.error === 'string' ? body.error : res.statusText;
  return new ApiError(`${res.status}${detail ? ` — ${detail}` : ''}`, res.status, body);
}

interface FetchOpts {
  method?: string;
  body?: unknown;
  /** Send the admin secret. Public reads leave it off. */
  admin?: boolean;
}

/**
 * Fetch against the selected environment. Throws ApiError on a non-2xx.
 *
 * The environment is pinned at call time: a 401 that lands after the operator
 * switched environments must clear the secret for the env that was actually
 * rejected, not whichever one is selected now.
 */
export async function api<T = unknown>(path: string, opts: FetchOpts = {}): Promise<T> {
  const env = currentEnv();
  const base = serverUrl(env);
  if (!base) throw new ApiError('No server URL set for this environment', 0);
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  if (opts.admin !== false) {
    const secret = secretFor(env);
    if (secret) headers['X-Admin-Secret'] = secret;
  }
  let res: Response;
  try {
    res = await fetch(base + path, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    });
  } catch (e) {
    reportHealth(false, env);
    throw new ApiError(`Could not reach ${envLabel(env)} (${base}) — is it running, and is this origin in its CORS allowlist?`, 0);
  }
  // Reachable is not healthy: a worker that 500s on every route (bad binding,
  // broken deploy) must turn the dot red. 4xx is the request's fault — a
  // rejected secret or an unconfigured Analytics Engine — not the server's.
  reportHealth(res.status < 500, env);
  if (res.status === 401 && opts.admin !== false) {
    writeSecret(env, '');
    for (const fn of authListeners) fn();
    throw new ApiError(`Admin secret rejected by ${envLabel(env)} — it has been cleared`, 401);
  }
  if (!res.ok) throw await errorFrom(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Public, unauthenticated read. */
export function publicApi<T = unknown>(path: string): Promise<T> {
  return api<T>(path, { admin: false });
}

/** Query string from defined values. */
export function qs(params: Record<string, string | number | undefined | null>): string {
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== null && v !== '') u.set(k, String(v));
  const s = u.toString();
  return s ? `?${s}` : '';
}
