export type BaseRow = {
  type: 'base';
  value: number;
};

export type MultiplierRow = {
  type: 'money_mult' | 'heap_coin_mult' | 'peak_hunter' | 'death_penalty';
  multiplier: number;
  runningTotal: number;
};

export type BreakdownRow = BaseRow | MultiplierRow;

export interface BreakdownInput {
  score:           number;
  scoreToCoins:    number; // SCORE_TO_COINS_DIVISOR
  moneyMultiplier: number;
  heapCoinMult?:   number;
  isPeak:          boolean;
  peakMultiplier:  number;
  isFailure:       boolean;
}

export interface BreakdownResult {
  rows:       BreakdownRow[];
  finalCoins: number;
}

export function buildCoinBreakdown(input: BreakdownInput): BreakdownResult {
  const { score, scoreToCoins, moneyMultiplier, heapCoinMult = 1, isPeak, peakMultiplier, isFailure } = input;
  const rows: BreakdownRow[] = [];

  const base = Math.floor(score / scoreToCoins);
  rows.push({ type: 'base', value: base });

  let running = base;

  if (moneyMultiplier > 1) {
    running = Math.floor(running * moneyMultiplier);
    rows.push({ type: 'money_mult', multiplier: moneyMultiplier, runningTotal: running });
  }

  if (heapCoinMult !== 1) {
    running = Math.floor(running * heapCoinMult);
    rows.push({ type: 'heap_coin_mult', multiplier: heapCoinMult, runningTotal: running });
  }

  if (isPeak && peakMultiplier > 1) {
    running = Math.floor(running * peakMultiplier);
    rows.push({ type: 'peak_hunter', multiplier: peakMultiplier, runningTotal: running });
  }

  if (isFailure) {
    running = Math.floor(running * 0.5);
    rows.push({ type: 'death_penalty', multiplier: 0.5, runningTotal: running });
  }

  return { rows, finalCoins: running };
}
