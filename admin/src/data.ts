// admin/src/data.ts
//
// Typed wrappers over the worker's admin and public routes. Response shapes
// come from shared/ wherever the server already publishes one.

import { api, publicApi, qs, currentEnv, serverUrl, ApiError, type EnvId } from './api';
import { legacyPlan, legacyToSeries, isLegacyBucketError, type LegacyRow } from './legacyMetrics';
import type { HeapSummary, ListHeapsResponse, HeapEnemyParams, AdminBandsResponse, AdminBandRow } from '../../shared/heapTypes';
import type { FeedbackRow } from '../../shared/feedbackTypes';
import { bucketSeconds, type MetricsBucket, type SeriesPoint } from '../../shared/metricsBuckets';
import { SCORE_DISPLAY_DIVISOR } from '../../shared/scoreConstants';

export type { HeapSummary, FeedbackRow };

// ── Heaps (cached per environment — nearly every view needs the names) ──

let heapCache: { env: EnvId; heaps: HeapSummary[] } | null = null;

export async function getHeaps(force = false): Promise<HeapSummary[]> {
  const env = currentEnv();
  if (!force && heapCache && heapCache.env === env) return heapCache.heaps;
  const res = await publicApi<ListHeapsResponse>('/heaps');
  heapCache = { env, heaps: res.heaps ?? [] };
  return heapCache.heaps;
}

export function invalidateHeaps(): void { heapCache = null; }

export function heapName(heaps: HeapSummary[], id: string | null | undefined): string {
  if (!id) return '—';
  return heaps.find((h) => h.id === id)?.params.name ?? `${id.slice(0, 8)}…`;
}

export const getEnemyParams = (id: string) =>
  publicApi<HeapEnemyParams>(`/heaps/${encodeURIComponent(id)}/enemy-params`);
export const putEnemyParams = (id: string, body: HeapEnemyParams) =>
  api(`/heaps/${encodeURIComponent(id)}/enemy-params`, { method: 'PUT', body });
export const putHeapParams = (id: string, body: Record<string, unknown>) =>
  api(`/heaps/${encodeURIComponent(id)}/params`, { method: 'PUT', body });
export const createHeap = (body: Record<string, unknown>) =>
  api<{ id: string }>('/heaps', { method: 'POST', body });
export const deleteHeap = (id: string) =>
  api(`/heaps/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const resetHeap = (id: string) =>
  api<{ id: string; version: number; previousVersion: number }>(`/heaps/${encodeURIComponent(id)}/reset`, { method: 'PUT' });
export const getBands = (id: string) =>
  api<AdminBandsResponse>(`/heaps/${encodeURIComponent(id)}/bands`);
export const putBands = (id: string, body: { expectedVersion: number; expectedBaseId: string; bands: AdminBandRow[] }) =>
  api<{ version: number }>(`/heaps/${encodeURIComponent(id)}/bands`, { method: 'PUT', body });

// ── Players, scores, bans ────────────────────────────────────────────────

export interface AdminScoreEntry { rank: number; playerId: string; name: string; score: number; banned: boolean }
export const getAdminScores = (heapId: string, page: number, limit: number) =>
  api<{ entries: AdminScoreEntry[]; total: number; page: number }>(
    `/scores/admin/${encodeURIComponent(heapId)}${qs({ page, limit })}`);

export interface PlayerLookup {
  playerId: string; name: string; banned: boolean; bannedAt: string | null; reason: string | null;
  scores: { heapId: string; score: number; rank: number }[];
}
export const lookupPlayer = (id: string) => api<PlayerLookup>(`/bans/${encodeURIComponent(id)}`);

export interface BanRow { player_id: string; reason: string | null; banned_at: string }
export const listBans = () => api<{ bans: BanRow[] }>('/bans');
export const banPlayer = (id: string, reason: string) =>
  api(`/bans/${encodeURIComponent(id)}`, { method: 'PUT', body: { reason } });
export const unbanPlayer = (id: string) => api(`/bans/${encodeURIComponent(id)}`, { method: 'DELETE' });
export const resetPlayerAuth = (id: string) => api(`/auth/${encodeURIComponent(id)}`, { method: 'DELETE' });

// ── Feedback ─────────────────────────────────────────────────────────────

export const listFeedback = () => api<FeedbackRow[]>('/feedback');

// ── Codes ────────────────────────────────────────────────────────────────

export interface CodeRow {
  code: string; reward_type: 'coins' | 'item'; reward_id: string | null; reward_amount: number;
  max_redemptions: number; redeemed_count: number; expires_at: string | null; created_at: string;
}
export const listCodes = () => api<{ codes: CodeRow[] }>('/codes');
export const createCode = (body: Record<string, unknown>) => api('/codes', { method: 'POST', body });
export const patchCode = (code: string, body: Record<string, unknown>) =>
  api(`/codes/${encodeURIComponent(code)}`, { method: 'PATCH', body });
export const deleteCode = (code: string) => api(`/codes/${encodeURIComponent(code)}`, { method: 'DELETE' });

// ── Config ───────────────────────────────────────────────────────────────

export const getConfig = () => publicApi<{ config: Record<string, unknown> }>('/config');
export const putConfig = (key: string, value: unknown) =>
  api(`/config/${encodeURIComponent(key)}`, { method: 'PUT', body: { value } });
export const deleteConfig = (key: string) => api(`/config/${encodeURIComponent(key)}`, { method: 'DELETE' });

// ── Metrics + analytics ──────────────────────────────────────────────────

export interface NewPlayersSeries {
  bucket: MetricsBucket; bucketSeconds: number; since: string; until: string; total: number; rows: SeriesPoint[];
  /** Served by a pre-adaptive worker and re-bucketed here; sub-hour sizes unavailable. */
  legacy?: boolean;
}

/** Server URLs known to run a pre-adaptive worker, so each load asks once, not twice. */
const legacyServers = new Set<string>();

export async function getNewPlayers(since: string, until: string, bucket: MetricsBucket): Promise<NewPlayersSeries> {
  const server = serverUrl();
  if (!legacyServers.has(server)) {
    try {
      return await api<NewPlayersSeries>(`/metrics/new-players${qs({ since, until, bucket })}`);
    } catch (e) {
      if (!(e instanceof ApiError && isLegacyBucketError(e.status, e.message))) throw e;
      legacyServers.add(server);
    }
  }
  const plan = legacyPlan(bucket);
  const res = await api<{ rows: LegacyRow[] }>(`/metrics/new-players${qs({ since, until, bucket: plan.source })}`);
  const rows = legacyToSeries(res.rows ?? [], plan.effective, Date.parse(since), Date.parse(until));
  return {
    bucket: plan.effective, bucketSeconds: bucketSeconds(plan.effective), since, until,
    total: rows.reduce((n, r) => n + r.count, 0), rows, legacy: true,
  };
}

export async function getTotals(): Promise<{ players: number }> {
  try {
    return await api<{ players: number }>('/metrics/totals');
  } catch (e) {
    if (e instanceof ApiError && e.status === 404) throw new ApiError(OLD_WORKER, 404);
    throw e;
  }
}

/** Shown where a view needs a route this environment's worker doesn't have yet. */
export const OLD_WORKER = 'Needs the newer worker — this environment updates when the branch merges to main';

interface AeMeta { sampled: boolean; sampleIntervalMax: number; truncated?: boolean }
export interface FunnelStages {
  cohort: number; startedRun1: number; finishedRun1: number;
  startedRun2: number; startedRun3: number; returnedLater: number;
}
export const getFunnel = (since: string, until: string) =>
  api<AeMeta & { stages: FunnelStages }>(`/analytics/funnel${qs({ since, until })}`);

export const CROSSTAB_DIMENSIONS = [
  ['duration', 'First run length'],
  ['cause', 'How the first run ended'],
  ['height', 'First run height'],
  ['score', 'First run score'],
  ['platform', 'Platform'],
  ['appVersion', 'App version'],
  ['placed', 'Placed an item'],
  ['submitted', 'Submitted a score'],
] as const;
export type CrosstabDimension = typeof CROSSTAB_DIMENSIONS[number][0];
export const getCrosstab = (dimension: CrosstabDimension, since: string, until: string) =>
  api<AeMeta & { rows: { bucket: string; cohort: number; returned: number }[] }>(
    `/analytics/crosstab${qs({ dimension, since, until })}`);

export interface TraceRow {
  ts: number; level: string; eventType: string; platform: string; appVersion: string; sessionId: string; payload: string;
}
export const getTrace = (playerId: string, since: string, until: string, limit = 300) =>
  api<AeMeta & { rows: TraceRow[] }>(`/analytics/trace${qs({ playerId, since, until, limit })}`);

// ── Heights ──────────────────────────────────────────────────────────────

/** PLAYER_HEIGHT (46) / 2 + 1 — GameScene's spawn offset above the floor.
 *  Mirrored rather than imported: src/constants.ts belongs to the game build. */
export const SPAWN_OFFSET_PX = 24;

/** World y → the ft a player reads on the HUD standing there. Floors, like
 *  GameScene's live readout, so the admin never shows a foot the HUD didn't. */
export function worldYToFt(y: number, worldHeight: number): number {
  return Math.max(0, Math.floor((worldHeight - SPAWN_OFFSET_PX - y) / SCORE_DISPLAY_DIVISOR));
}

/** A heap's height exactly as the heap-select screen labels it. */
export { heightFt as heapHeightLabel } from '../../src/util/format';
