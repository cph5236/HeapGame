import Phaser from 'phaser';
import { OBJECT_DEF_LIST } from '../data/heapObjectDefs';
import { HEAP_PNG_URLS } from '../data/heapPngUrls';
import { HEAP_FILL_TEXTURE } from '../constants';
import { HEAP_TILE_URLS, HEAP_TILE_COUNT } from '../data/heapTileUrls';
import trashbagUrl from '../sprites/player/trashbag.png?url';
import ibeamUrl from '../sprites/Placeables/IBeam.png?url';
// import ibeamUrl from '../sprites/Placeables/IBeam2.png?url';
import ladderUrl from '../sprites/Placeables/Ladder.png?url';
import tombstone1Url from '../sprites/Placeables/TombStone (1).png?url';
import tombstone2Url from '../sprites/Placeables/TombStone (2).png?url';
import vultureFlyLeftUrl  from '../sprites/Enemies/vulture/vulture-fly-left.png?url';
import vultureFlyRightUrl from '../sprites/Enemies/vulture/vulture-fly-right.png?url';
import ratUrl from '../sprites/Enemies/Rat/rat.png?url';
import { HeapClient } from '../systems/HeapClient';
import type { Vertex } from '../systems/HeapPolygon';
import { generateAllTextures } from '../entities/TextureGenerators';
import type { HeapSummary } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { getSelectedHeapId, setSelectedHeapId, finalizeLegacyPlaced } from '../systems/SaveData';
import { INFINITE_HEAP_ID } from '../data/infiniteDefs';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    for (let i = 0; i < HEAP_TILE_COUNT; i++) {
      this.load.image(`${HEAP_FILL_TEXTURE}-${i}`, HEAP_TILE_URLS[i]);
    }
    this.load.image('trashbag', trashbagUrl);
    this.load.image('item-ibeam', ibeamUrl);
    this.load.image('item-ladder', ladderUrl);
    this.load.image('item-checkpoint-1', tombstone1Url);
    this.load.image('item-checkpoint-2', tombstone2Url);

    for (const def of OBJECT_DEF_LIST) {
      this.load.image(def.textureKey, HEAP_PNG_URLS[def.textureKey]);
    }

    // Vulture (ghost enemy) fly animations — 256px wide strips
    this.load.spritesheet('vulture-fly-left',  vultureFlyLeftUrl,  { frameWidth: 64, frameHeight: 43 });
    this.load.spritesheet('vulture-fly-right', vultureFlyRightUrl, { frameWidth: 64, frameHeight: 42 });

    // Rat (percher enemy) — 3×4 grid of 32×32 frames
    this.load.spritesheet('rat', ratUrl, { frameWidth: 32, frameHeight: 32 });
  }

  create(): void {
    generateAllTextures(this);

    // Rat animations — rows 0–3, 3 frames each
    this.anims.create({ key: 'rat-idle',  frames: this.anims.generateFrameNumbers('rat', { start: 0, end: 2 }), frameRate: 6,  repeat: -1 });
    this.anims.create({ key: 'rat-walk-right', frames: this.anims.generateFrameNumbers('rat', { start: 3, end: 5 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'rat-walk-down',  frames: this.anims.generateFrameNumbers('rat', { start: 6, end: 8 }), frameRate: 10, repeat: -1 });
    this.anims.create({ key: 'rat-walk-left',  frames: this.anims.generateFrameNumbers('rat', { start: 9, end: 11 }), frameRate: 10, repeat: -1 });

    this.anims.create({
      key: 'vulture-fly-left',
      frames: this.anims.generateFrameNumbers('vulture-fly-left', { start: 0, end: 3 }),
      frameRate: 10,
      repeat: -1,
    });
    this.anims.create({
      key: 'vulture-fly-right',
      frames: this.anims.generateFrameNumbers('vulture-fly-right', { start: 0, end: 3 }),
      frameRate: 10,
      repeat: -1,
    });

    HeapClient.list()
      .then((summaries) => {
        const infiniteEntry: HeapSummary = {
          id: INFINITE_HEAP_ID,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          params: {
            name: '∞ Infinite Heap',
            difficulty: 5.0,
            spawnRateMult: 1.0,
            coinMult: 1.0,
            scoreMult: 1.0,
            isInfinite: true,
          },
        };
        summaries.push(infiniteEntry);
        this.game.registry.set('heapCatalog', summaries);

        if (summaries.length === 0) {
          this.game.registry.set('activeHeapId', '');
          this.game.registry.set('heapPolygon', [] as Vertex[]);
          this.game.registry.set('heapParams', DEFAULT_HEAP_PARAMS);
          return;
        }

        const stored = getSelectedHeapId();
        const pick = summaries.find((s) => s.id === stored)
                  ?? [...summaries].sort((a, b) => a.params.difficulty - b.params.difficulty
                        || a.createdAt.localeCompare(b.createdAt))[0];

        setSelectedHeapId(pick.id);
        finalizeLegacyPlaced(pick.id);
        this.game.registry.set('activeHeapId', pick.id);
        this.game.registry.set('heapParams',   pick.params);

        return HeapClient.load(pick.id).then((polygon) => {
          this.game.registry.set('heapPolygon', polygon);
        });
      })
      .catch(() => {
        this.game.registry.set('heapCatalog',  [] as HeapSummary[]);
        this.game.registry.set('activeHeapId', '');
        this.game.registry.set('heapPolygon',  [] as Vertex[]);
        this.game.registry.set('heapParams',   DEFAULT_HEAP_PARAMS);
      })
      .finally(() => {
        this.scene.start('MenuScene');
      });
  }
}
