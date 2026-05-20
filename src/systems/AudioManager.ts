import { SOUND_DEFS, type SoundCategory } from '../data/soundDefs';
import { getSoundSettings, setSoundVolume } from './SaveData';

// ── Pure math — exported for unit testing ──────────────────────────────────────

export function effectiveVolume(base: number, category: number, master: number): number {
  return Math.min(1, base * category * master);
}

export function proximityVolume(t: number, base: number, category: number, master: number): number {
  return Math.pow(t, 0.7) * base * category * master;
}

export function proximityRate(t: number): number {
  return 0.8 + t * 0.5;
}

export function distanceToProximityT(
  dist: number,
  fullVolumeDistancePx: number,
  maxAudibleDistancePx: number,
): number {
  if (dist <= fullVolumeDistancePx) return 1;
  if (maxAudibleDistancePx <= fullVolumeDistancePx) return 1;
  if (dist >= maxAudibleDistancePx) return 0;
  return 1 - (dist - fullVolumeDistancePx) / (maxAudibleDistancePx - fullVolumeDistancePx);
}

// ── AudioManager singleton ─────────────────────────────────────────────────────

type VolumeMap = Record<SoundCategory | 'master', number>;

class _AudioManager {
  private sm: any = null;
  private volumes: VolumeMap = {
    master: 1.0, music: 0.7, playerSfx: 1.0, enemySfx: 0.8, envSfx: 0.9,
  };
  private playing = new Map<string, any>();
  private currentMusicKey: string | null = null;

  init(sm: any): void {
    this.sm = sm;
    const s = getSoundSettings();
    this.volumes = {
      master: s.master, music: s.music, playerSfx: s.playerSfx,
      enemySfx: s.enemySfx, envSfx: s.envSfx,
    };
  }

  play(key: string, opts?: { volume?: number }): void {
    if (!this.sm) return;
    const def = SOUND_DEFS[key];
    if (!def) return;
    if (!this.sm.game?.cache?.audio?.has(key)) return;

    if (def.category === 'music') {
      if (this.currentMusicKey && this.currentMusicKey !== key) {
        this.stop(this.currentMusicKey);
      }
      if (this.currentMusicKey === key) return; // already playing this track
      this.currentMusicKey = key;
    } else {
      this.stop(key); // stop duplicate before restarting
    }

    const vol = effectiveVolume(
      opts?.volume ?? def.baseVolume,
      this.volumes[def.category],
      this.volumes.master,
    );
    const sound = this.sm.add(key, { loop: def.loop, volume: vol });
    sound.play();
    this.playing.set(key, sound);

    if (!def.loop) {
      sound.once('complete', () => {
        this.playing.delete(key);
      });
    }
  }

  stop(key: string): void {
    const sound = this.playing.get(key);
    if (sound) {
      sound.stop();
      sound.destroy();
      this.playing.delete(key);
    }
    if (this.currentMusicKey === key) this.currentMusicKey = null;
  }

  stopAll(category?: SoundCategory): void {
    for (const [key, sound] of [...this.playing.entries()]) {
      const def = SOUND_DEFS[key];
      if (!category || def?.category === category) {
        sound.stop();
        sound.destroy();
        this.playing.delete(key);
        if (this.currentMusicKey === key) this.currentMusicKey = null;
      }
    }
  }

  setCategoryVolume(cat: SoundCategory | 'master', v: number): void {
    this.volumes[cat] = v;
    setSoundVolume(cat as keyof import('./SaveData').SoundSettings, v);
    for (const [key, sound] of this.playing.entries()) {
      const def = SOUND_DEFS[key];
      if (!def) continue;
      if (cat === 'master' || def.category === cat) {
        const newVol = effectiveVolume(def.baseVolume, this.volumes[def.category], this.volumes.master);
        sound.setVolume(newVol);
      }
    }
  }

  setWallProximity(t: number): void {
    if (!this.sm) return;
    const key = 'env-wall-rumble';
    const def = SOUND_DEFS[key];
    if (!def) return;

    if (t <= 0.01) {
      this.stop(key);
      return;
    }

    const vol = proximityVolume(t, def.baseVolume, this.volumes.envSfx, this.volumes.master);
    const rate = proximityRate(t);

    if (!this.playing.has(key)) {
      const sound = this.sm.add(key, { loop: true, volume: vol });
      sound.play();
      this.playing.set(key, sound);
    } else {
      const sound = this.playing.get(key)!;
      sound.setVolume(vol);
      if ('setRate' in sound) sound.setRate(rate);
    }
  }

  setLoopProximity(key: string, t: number): void {
    if (!this.sm) return;
    const def = SOUND_DEFS[key];
    if (!def) return;

    if (t <= 0.01) {
      this.stop(key);
      return;
    }

    const vol = proximityVolume(t, def.baseVolume, this.volumes[def.category], this.volumes.master);

    if (!this.playing.has(key)) {
      if (!this.sm.game?.cache?.audio?.has(key)) return;
      const sound = this.sm.add(key, { loop: true, volume: vol });
      sound.play();
      this.playing.set(key, sound);
    } else {
      this.playing.get(key)!.setVolume(vol);
    }
  }

  playProximate(key: string, t: number): void {
    if (t <= 0.01) return;
    const def = SOUND_DEFS[key];
    if (!def) return;
    // Pass t-scaled base to play(); play() applies category + master on top,
    // giving: Math.pow(t, 0.7) * base * category * master = proximityVolume result.
    const tScaledBase = Math.pow(t, 0.7) * def.baseVolume;
    this.play(key, { volume: tScaledBase });
  }

  getVolumes(): VolumeMap {
    return { ...this.volumes };
  }
}

export const AudioManager = new _AudioManager();
