import stubUrl from '../audio/stub.mp3?url';

export type SoundCategory = 'music' | 'playerSfx' | 'enemySfx' | 'envSfx';

export interface SoundDef {
  category:   SoundCategory;
  baseVolume: number;
  loop:       boolean;
  url:        string;
}

export const SOUND_DEFS: Record<string, SoundDef> = {
  'music-menu':            { category: 'music',     loop: true,  baseVolume: 0.8, url: stubUrl },
  'music-game':            { category: 'music',     loop: true,  baseVolume: 0.8, url: stubUrl },
  'music-score':           { category: 'music',     loop: true,  baseVolume: 0.6, url: stubUrl },
  'player-jump':           { category: 'playerSfx', loop: false, baseVolume: 0.9, url: stubUrl },
  'player-land':           { category: 'playerSfx', loop: false, baseVolume: 0.7, url: stubUrl },
  'player-die':            { category: 'playerSfx', loop: false, baseVolume: 1.0, url: stubUrl },
  'enemy-kill':            { category: 'enemySfx',  loop: false, baseVolume: 0.9, url: stubUrl },
  'enemy-vulture-ambient': { category: 'enemySfx',  loop: true,  baseVolume: 0.4, url: stubUrl },
  'env-wall-rumble':       { category: 'envSfx',    loop: true,  baseVolume: 1.0, url: stubUrl },
};
