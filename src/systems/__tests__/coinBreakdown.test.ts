import { describe, it, expect } from 'vitest';
import { buildCoinBreakdown } from '../coinBreakdown';

describe('buildCoinBreakdown', () => {
  it('returns base row only when no multipliers active and not failure', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.rows[0]).toEqual({ type: 'base', value: 5 });
    expect(result.finalCoins).toBe(5);
  });

  it('adds money_mult row when moneyMultiplier > 1', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1.5,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toEqual({ type: 'money_mult', multiplier: 1.5, runningTotal: 7 });
    expect(result.finalCoins).toBe(7);
  });

  it('adds peak_hunter row only when isPeak is true', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: true,
      peakMultiplier: 1.8,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(2);
    expect(result.rows[1]).toEqual({ type: 'peak_hunter', multiplier: 1.8, runningTotal: 9 });
    expect(result.finalCoins).toBe(9);
  });

  it('does NOT add peak_hunter row when isPeak is false', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1,
      isPeak: false,
      peakMultiplier: 1.8,
      isFailure: false,
    });
    expect(result.rows).toHaveLength(1);
    expect(result.finalCoins).toBe(5);
  });

  it('adds death_penalty row last when isFailure is true', () => {
    const result = buildCoinBreakdown({
      score: 500,
      scoreToCoins: 100,
      moneyMultiplier: 1.5,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: true,
    });
    expect(result.rows).toHaveLength(3);
    expect(result.rows[2]).toEqual({ type: 'death_penalty', multiplier: 0.5, runningTotal: 3 });
    expect(result.finalCoins).toBe(3);
  });

  it('applies multipliers in order: base → money_mult → peak_hunter → death_penalty', () => {
    const result = buildCoinBreakdown({
      score: 1000,
      scoreToCoins: 100,
      moneyMultiplier: 1.5,
      isPeak: true,
      peakMultiplier: 2.0,
      isFailure: true,
    });
    // base: floor(1000/100) = 10
    // money_mult: floor(10 * 1.5) = 15
    // peak_hunter: floor(15 * 2.0) = 30
    // death_penalty: floor(30 * 0.5) = 15
    expect(result.rows[0]).toEqual({ type: 'base', value: 10 });
    expect(result.rows[1]).toEqual({ type: 'money_mult', multiplier: 1.5, runningTotal: 15 });
    expect(result.rows[2]).toEqual({ type: 'peak_hunter', multiplier: 2.0, runningTotal: 30 });
    expect(result.rows[3]).toEqual({ type: 'death_penalty', multiplier: 0.5, runningTotal: 15 });
    expect(result.finalCoins).toBe(15);
  });

  it('floors all intermediate values', () => {
    const result = buildCoinBreakdown({
      score: 330,
      scoreToCoins: 100,
      moneyMultiplier: 1.5,
      isPeak: false,
      peakMultiplier: 1.25,
      isFailure: false,
    });
    // base: floor(330/100) = 3
    // money_mult: floor(3 * 1.5) = 4
    expect(result.rows[1]).toEqual({ type: 'money_mult', multiplier: 1.5, runningTotal: 4 });
    expect(result.finalCoins).toBe(4);
  });
});
