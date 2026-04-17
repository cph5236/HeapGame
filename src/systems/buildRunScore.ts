import type { EnemyKind } from '../entities/Enemy';
import type { EnemyDef } from '../data/enemyDefs';
import { PACE_BONUS_CONST, SCORE_DISPLAY_DIVISOR } from '../constants';

export interface RunStats {
  baseHeightPx: number;
  kills:        Partial<Record<EnemyKind, number>>;
  elapsedMs:    number;
}

export interface RunScoreRow {
  type:   'height' | 'kill' | 'pace';
  label:  string;
  detail: string;
  value:  number;
}

export interface RunScoreResult {
  rows:       RunScoreRow[];
  finalScore: number;
}

export function buildRunScore(
  stats:     RunStats,
  defs:      Record<EnemyKind, EnemyDef>,
  isFailure: boolean,
  scoreMult: number = 1.0,
): RunScoreResult {
  const rows: RunScoreRow[] = [];
  let total = stats.baseHeightPx;

  const ft = Math.floor(stats.baseHeightPx / SCORE_DISPLAY_DIVISOR);
  rows.push({
    type:   'height',
    label:  'FEET CLIMBED',
    detail: `${ft}ft`,
    value:  stats.baseHeightPx,
  });

  const kinds: EnemyKind[] = ['percher', 'ghost'];
  for (const kind of kinds) {
    const count = stats.kills[kind];
    if (!count) continue;
    const def   = defs[kind];
    const bonus = count * def.scoreValue;
    rows.push({
      type:   'kill',
      label:  `${def.displayName} x${count}`,
      detail: `${count} x ${def.scoreValue}`,
      value:  bonus,
    });
    total += bonus;
  }

  if (!isFailure && stats.elapsedMs > 0) {
    const elapsedSeconds = stats.elapsedMs / 1000;
    const paceBonus      = Math.floor((stats.baseHeightPx / elapsedSeconds) * PACE_BONUS_CONST);
    const elapsedSec     = Math.round(elapsedSeconds);
    rows.push({
      type:   'pace',
      label:  'PACE',
      detail: `${stats.baseHeightPx} / ${elapsedSec}s x ${PACE_BONUS_CONST}`,
      value:  paceBonus,
    });
    total += paceBonus;
  }

  return { rows, finalScore: Math.round(total * scoreMult) };
}
