import Phaser from 'phaser';
import { OBJECT_DEFS, OBJECT_DEF_LIST } from '../data/heapObjectDefs';
import { HEAP_PNG_URLS } from '../data/heapPngUrls';
import { HEAP_FILL_TEXTURE } from '../constants';
import { HEAP_TILE_URLS, HEAP_TILE_COUNT } from '../data/heapTileUrls';
import { PORTAL_DEF } from '../data/portalDefs';
import { pickTrashWallPool } from '../systems/trashWallPool';
import { SOUND_DEFS } from '../data/soundDefs';
import ibeamUrl       from '../sprites/Placeables/IBeam.png?url';
import ladderUrl      from '../sprites/Placeables/Ladder.png?url';
import tombstone1Url  from '../sprites/Placeables/TombStone (1).png?url';
import tombstone2Url  from '../sprites/Placeables/TombStone (2).png?url';
import bridgeUrl      from '../sprites/Bridge/Bridge.png?url';
import vultureFlyLeftUrl  from '../sprites/Enemies/vulture/vulture-fly-left.png?url';
import vultureFlyRightUrl from '../sprites/Enemies/vulture/vulture-fly-right.png?url';
import ratUrl             from '../sprites/Enemies/Rat/rat.png?url';
import trashbagNoStringsUrl from '../sprites/player/trashbag-nostrings.png?url';
import outroDeathUrl        from '../sprites/outro/trashbag-Death.png';

/** Default size of the per-session trash-wall sprite pool. */
const TRASH_WALL_POOL_SIZE = 50;

/**
 * Schedules every non-boot asset load on the given scene's LoaderPlugin and
 * starts loading immediately. Sets `registry.gameAssetsReady = true` when
 * the loader's `complete` event fires. Idempotent — if `gameAssetsReady` is
 * already true, this is a no-op.
 *
 * Safe to call from any scene that's currently active. Phaser's TextureManager
 * is global, so textures end up accessible from every scene.
 */
export function loadGameAssets(scene: Phaser.Scene): void {
  if (scene.registry.get('gameAssetsReady') === true) return;
  if (scene.registry.get('gameAssetsLoading') === true) return;
  scene.registry.set('gameAssetsLoading', true);

  // ── Pick the trash-wall pool once per session ────────────────────────────
  const existingPool = scene.registry.get('trashWallPool') as string[] | undefined;
  const pool = existingPool && existingPool.length > 0
    ? existingPool
    : pickTrashWallPool(OBJECT_DEF_LIST, TRASH_WALL_POOL_SIZE).map(d => d.textureKey);
  scene.registry.set('trashWallPool', pool);

  // ── Load only the curated pool's PNGs ────────────────────────────────────
  // Build a textureKey → ObjectDef map so we can look up filenames quickly.
  for (const key of pool) {
    const def = OBJECT_DEF_LIST.find(d => d.textureKey === key);
    if (!def) continue;
    const url = HEAP_PNG_URLS[def.textureKey];
    if (url) scene.load.image(def.textureKey, url);
  }

  // ── Heap fill tiles ──────────────────────────────────────────────────────
  for (let i = 0; i < HEAP_TILE_COUNT; i++) {
    scene.load.image(`${HEAP_FILL_TEXTURE}-${i}`, HEAP_TILE_URLS[i]);
  }

  // ── Placeables + bridge ──────────────────────────────────────────────────
  scene.load.image('item-ibeam',        ibeamUrl);
  scene.load.image('item-ladder',       ladderUrl);
  scene.load.image('item-checkpoint-1', tombstone1Url);
  scene.load.image('item-checkpoint-2', tombstone2Url);
  scene.load.image('bridge',              bridgeUrl);
  scene.load.image('trashbag-nostrings', trashbagNoStringsUrl);
  scene.load.image('outro-death',        outroDeathUrl);

  // ── Enemy spritesheets ───────────────────────────────────────────────────
  scene.load.spritesheet('vulture-fly-left',  vultureFlyLeftUrl,  { frameWidth: 64, frameHeight: 43 });
  scene.load.spritesheet('vulture-fly-right', vultureFlyRightUrl, { frameWidth: 64, frameHeight: 42 });
  scene.load.spritesheet('rat',               ratUrl,             { frameWidth: 32, frameHeight: 32 });

  // ── Portal (recycle-items now reuse OBJECT_DEFS keys, no separate load) ──
  scene.load.image(PORTAL_DEF.spriteKey, PORTAL_DEF.spritePath);

  // Recycle items are part of OBJECT_DEFS — but they may not have been picked
  // into the trash-wall pool. PortalManager needs them all, so explicit-load
  // any recycle-items-NN keys not already queued.
  for (let i = 0; i < 16; i++) {
    const k = `recycle-items-${i.toString().padStart(2, '0')}`;
    if (pool.includes(k)) continue;
    const def = Object.values(OBJECT_DEFS).find(d => d.textureKey === k);
    if (!def) continue;
    const url = HEAP_PNG_URLS[def.textureKey];
    if (url) scene.load.image(k, url);
  }

  // ── Audio ────────────────────────────────────────────────────────────────────
  for (const [key, def] of Object.entries(SOUND_DEFS)) {
    scene.load.audio(key, def.url);
  }

  // ── On complete: register enemy animations + flip the ready flag ─────────
  scene.load.once(Phaser.Loader.Events.COMPLETE, () => {
    scene.anims.create({ key: 'rat-idle',       frames: scene.anims.generateFrameNumbers('rat', { start: 0,  end: 2  }), frameRate: 6,  repeat: -1 });
    scene.anims.create({ key: 'rat-walk-right', frames: scene.anims.generateFrameNumbers('rat', { start: 3,  end: 5  }), frameRate: 10, repeat: -1 });
    scene.anims.create({ key: 'rat-walk-down',  frames: scene.anims.generateFrameNumbers('rat', { start: 6,  end: 8  }), frameRate: 10, repeat: -1 });
    scene.anims.create({ key: 'rat-walk-left',  frames: scene.anims.generateFrameNumbers('rat', { start: 9,  end: 11 }), frameRate: 10, repeat: -1 });
    scene.anims.create({ key: 'vulture-fly-left',  frames: scene.anims.generateFrameNumbers('vulture-fly-left',  { start: 0, end: 3 }), frameRate: 10, repeat: -1 });
    scene.anims.create({ key: 'vulture-fly-right', frames: scene.anims.generateFrameNumbers('vulture-fly-right', { start: 0, end: 3 }), frameRate: 10, repeat: -1 });

    scene.registry.set('gameAssetsLoading', false);
    scene.registry.set('gameAssetsReady',   true);
    // Emit on game.events (not scene.events) so MenuScene's listener — which is
    // also on game.events for consistency with `heapCatalogReady` — actually fires.
    scene.game.events.emit('gameAssetsReady');
  });

  scene.load.start();
}
