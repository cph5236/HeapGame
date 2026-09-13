import {
  MAX_WALKABLE_SLOPE_DEG, MOUNTAIN_CLIMBER_INCREMENT, MONEY_MULT_PER_LEVEL,
  BASE_STAMINA, STAMINA_REGEN_AIR_MS, STAMINA_REGEN_PER_LEVEL,
  DASH_POWER_PER_LEVEL, WALL_JUMP_COOLDOWN_MS, WALL_JUMP_CD_PER_LEVEL,
} from '../constants';
import { formatMult } from '../systems/formatMult';

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
    id: 'money_mult',
    name: 'Scrap Multiplier',
    description: (l) => `${formatMult(1 + l * MONEY_MULT_PER_LEVEL)}\u00d7 Scrap`,
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
    description: (l) => `+${[40, 50, 60][Math.max(1, l) - 1]} Scrap per stomp`,
    maxLevel: 3,
    cost: (l) => [250, 500, 1000][l - 1],
  },
  {
    id: 'peak_hunter',
    name: 'Peak Bonus',
    description: (l) => `${[1.25, 1.50, 1.75, 2.00][Math.max(1, l) - 1].toFixed(2)}\u00d7 peak Scrap`,
    maxLevel: 4,
    cost: (l) => [400, 800, 1600, 3200][l - 1],
  },
  {
    id: 'mountain_climber',
    name: 'Mountain Climber',
    description: (l) => `Walk slopes up to ${MAX_WALKABLE_SLOPE_DEG + l * MOUNTAIN_CLIMBER_INCREMENT}°`,
    maxLevel: 4,        // designer: set to desired max
    cost: (l) => [300, 600, 1200, 2400][l - 1], // designer: replace with actual costs
  },
  {
    id: 'enemy_radar',
    name: 'Radar',
    description: (l) => `+${l * 10}% off-screen enemy & pickup detection range`,
    maxLevel: 3,
    cost: (l) => [300, 600, 1200][l - 1],
  },
  {
    id: 'max_stamina',
    name: 'Stamina Tank',
    description: (l) => `${BASE_STAMINA + l} max stamina`,
    maxLevel: 3,                                  // designer: 3 takes base 3 -> 6
    cost: (l) => [400, 900, 1800][l - 1],         // designer: replace with actual costs
  },
  {
    id: 'stamina_regen',
    name: 'Second Wind',
    description: (l) => `Recover air stamina ${((STAMINA_REGEN_PER_LEVEL * l) / STAMINA_REGEN_AIR_MS * 100).toFixed(0)}% faster`,
    maxLevel: 4,                                  // designer: 4 takes 3000ms -> 1800ms
    cost: (l) => [350, 700, 1400, 2800][l - 1],   // designer: replace with actual costs
  },
  {
    id: 'dash_power',
    name: 'Dash Power',
    description: (l) => `+${DASH_POWER_PER_LEVEL * l} dash speed`,
    maxLevel: 4,
    cost: (l) => [300, 600, 1200, 2400][l - 1],   // designer: replace with actual costs
  },
  {
    id: 'wall_jump_cd',
    name: 'Wall Grip',
    description: (l) => `${((WALL_JUMP_COOLDOWN_MS - WALL_JUMP_CD_PER_LEVEL * l) / 1000).toFixed(2)}s same-wall cooldown`,
    maxLevel: 10,
    cost: (l) => 200 + l * 150,                   // designer: replace with actual costs
  },
];
