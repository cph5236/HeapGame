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
    cost: (l) => 150 * l,
  },
  {
    id: 'wall_jump',
    name: 'Wall Jump',
    description: () => 'Jump off walls',
    maxLevel: 1,
    cost: () => 100,
  },
  {
    id: 'dash',
    name: 'Dash',
    description: () => 'SHIFT to dash',
    maxLevel: 1,
    cost: () => 300,
  },
  {
    id: 'money_mult',
    name: 'Coin Multiplier',
    description: (l) => `${(1 + l * 0.1).toFixed(1)}\u00d7 coins`,
    maxLevel: 5,
    cost: (l) => 25 * l,
  },
];
