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
    cost: (l) => [200, 850, 2000][l - 1],
  },
  {
    id: 'wall_jump',
    name: 'Wall Jump',
    description: () => 'Jump off walls',
    maxLevel: 1,
    cost: () => 450,
  },
  {
    id: 'dash',
    name: 'Dash',
    description: () => 'SHIFT to dash in movement direction',
    maxLevel: 1,
    cost: () => 600,
  },
  {
    id: 'money_mult',
    name: 'Coin Multiplier',
    description: (l) => `${(1 + l * 0.05).toFixed(1)}\u00d7 coins`,
    maxLevel: 20,
    cost: (l) => [100, 300, 500, 700, 900, 1100, 1300, 1500, 1700, 1900, 2100, 2300, 2500, 2700, 2900, 3100, 3300, 3500, 3700, 3900][l - 1],
  },
  {
    id: 'jump_boost',
    name: 'Jump Height',
    description: (l) => `+${[25, 35, 45, 55, 60, 65, 70, 75][Math.max(1, l) - 1]} jump power`,
    maxLevel: 8,
    cost: (l) => [150, 250, 350, 450, 550, 650, 750, 850][l - 1],
  },
  {
    id: 'stomp_gold',
    name: 'Stomp Bounty',
    description: (l) => `+${[50, 100, 150][Math.max(1, l) - 1]} coins per stomp`,
    maxLevel: 3,
    cost: (l) => [250, 500, 1000][l - 1],
  },
  {
    id: 'peak_hunter',
    name: 'Peak Bonus',
    description: (l) => `${[1.25, 1.50, 1.75, 2.00][Math.max(1, l) - 1].toFixed(2)}\u00d7 peak coins`,
    maxLevel: 4,
    cost: (l) => [400, 800, 1600, 3200][l - 1],
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
    maxLevel: 4,        // designer: set to desired max
    cost: (l) => [300, 600, 1200, 2400][l - 1], // designer: replace with actual costs
  },
];
