import { MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT } from '../constants';

export interface UpgradeDef {
  id:          string;
  name:        string;
  description: (level: number) => string; // describes the effect AT this level
  maxLevel:    number;
  cost:        (level: number) => number; // cost to reach `level` from `level - 1`
}

export const UPGRADE_DEFS: UpgradeDef[] = [
  {
    id: 'air_jump',
    name: 'Extra Air Jump',
    description: (l) => `${1 + l} air jump${1 + l > 1 ? 's' : ''}`,
    maxLevel: 3,
    cost: (l) => [200, 450, 850][l - 1],
  },
  {
    id: 'wall_jump',
    name: 'Wall Jump',
    description: () => 'Jump off walls',
    maxLevel: 1,
    cost: () => 250,
  },
  {
    id: 'dash',
    name: 'Dash',
    description: () => 'SHIFT to dash',
    maxLevel: 1,
    cost: () => 600,
  },
  {
    id: 'money_mult',
    name: 'Coin Multiplier',
    description: (l) => `${(1 + l * 0.1).toFixed(1)}\u00d7 coins`,
    maxLevel: 5,
    cost: (l) => [100, 200, 350, 550, 800][l - 1],
  },
  {
    id: 'jump_boost',
    name: 'Jump Height',
    description: (l) => `+${[70, 150, 240][Math.max(1, l) - 1]} jump power`,
    maxLevel: 3,
    cost: (l) => [300, 650, 1200][l - 1],
  },
  {
    id: 'stomp_gold',
    name: 'Stomp Bounty',
    description: (l) => `+${[50, 90, 150][Math.max(1, l) - 1]} coins per stomp`,
    maxLevel: 3,
    cost: (l) => [200, 500, 950][l - 1],
  },
  {
    id: 'peak_hunter',
    name: 'Peak Bonus',
    description: (l) => `${[1.40, 1.60, 1.85][Math.max(1, l) - 1].toFixed(2)}\u00d7 peak coins`,
    maxLevel: 3,
    cost: (l) => [400, 900, 1600][l - 1],
  },
  {
    id: 'dive',
    name: 'Dive',
    description: () => 'Down/S to dive',
    maxLevel: 1,
    cost: () => 500,
  },
  {
    id: 'mountain_climber',
    name: 'Mountain Climber',
    description: (l) => `Walk slopes up to ${MAX_WALKABLE_SLOPE_DEG + l * MOUNTAIN_CLIMBER_INCREMENT}°`,
    maxLevel: 3,        // designer: set to desired max
    cost: (l) => [0, 0, 0][l - 1], // designer: replace with actual costs
  },
];
