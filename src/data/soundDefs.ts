import mainMenuUrl from '../audio/Menu/MainMenu.mp3?url';
import playerJumpUrl from '../audio/Player/Jump_20.wav?url';
import playerDieUrl from '../audio/Player/PlayerDie.wav?url';
import playerDashUrl from '../audio/Player/Dash.wav?url';
import playerLandUrl from '../audio/Player/player_land.wav?url';
import enemyKillUrl from '../audio/Enemys/Enemykill.wav?url';
import enemyVultureUrl from '../audio/Enemys/VultureIdle.wav?url';
import enemyRatUrl from '../audio/Enemys/enemyrat.mp3?url';
import trashWallUrl from '../audio/Heapsounds/trash-wall.mp3?url';

export type SoundCategory = 'music' | 'playerSfx' | 'enemySfx' | 'envSfx';

export interface SoundDef {
  category:              SoundCategory;
  baseVolume:            number;
  loop:                  boolean;
  url:                   string;
  maxAudibleDistancePx?: number;   // beyond this → silent
  fullVolumeDistancePx?: number;   // closer than this → full baseVolume
  playIntervalMs?:       [number, number]; // [min, max] ms, for intermittent one-shots
}

export const SOUND_DEFS: Record<string, SoundDef> = {
  'music-menu':            { category: 'music',     loop: true,  baseVolume: 0.4, url: mainMenuUrl },
  'music-game':            { category: 'music',     loop: true,  baseVolume: 0.4, url: mainMenuUrl },
  'music-score':           { category: 'music',     loop: true,  baseVolume: 0.6, url: mainMenuUrl },
  'player-jump':           { category: 'playerSfx', loop: false, baseVolume: 0.4, url: playerJumpUrl },
  'player-land':           { category: 'playerSfx', loop: false, baseVolume: 0.0, url: playerLandUrl },
  'player-die':            { category: 'playerSfx', loop: false, baseVolume: 0.5, url: playerDieUrl },
  'player-dash':           { category: 'playerSfx', loop: false, baseVolume: 0.9, url: playerDashUrl },
  'enemy-kill':            { category: 'enemySfx',  loop: false, baseVolume: 0.5, url: enemyKillUrl },
  'enemy-vulture-ambient': { category: 'enemySfx', loop: true,  baseVolume: 0.4, url: enemyVultureUrl, maxAudibleDistancePx: 700, fullVolumeDistancePx: 150 },
  'enemy-rat-ambient':     { category: 'enemySfx', loop: false, baseVolume: 0.4, url: enemyRatUrl, maxAudibleDistancePx: 450, fullVolumeDistancePx: 80, playIntervalMs: [3000, 8000] },
  'env-wall-rumble':       { category: 'envSfx',    loop: true,  baseVolume: 0.5, url: trashWallUrl },
};
