import Phaser from 'phaser';
import trashbagUrl from '../sprites/player/trashbag.png?url';
import { HeapClient } from '../systems/HeapClient';
import type { Vertex } from '../systems/HeapPolygon';
import { generateAllTextures } from '../entities/TextureGenerators';
import type { HeapSummary } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { MOCK_HEAP_HEIGHT_PX } from '../constants';
import { getSelectedHeapId, setSelectedHeapId, finalizeLegacyPlaced } from '../systems/SaveData';
import { INFINITE_HEAP_ID } from '../data/infiniteDefs';

export class BootScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BootScene' });
  }

  preload(): void {
    // Only what MenuScene actually paints: the player figure.
    this.load.image('trashbag', trashbagUrl);
  }

  create(): void {
    // Procedural textures — synchronous, no network/disk.
    generateAllTextures(this);

    // Default registry state so MenuScene can render before catalog resolves.
    this.game.registry.set('heapCatalog',    [] as HeapSummary[]);
    this.game.registry.set('activeHeapId',   '');
    this.game.registry.set('heapPolygon',    [] as Vertex[]);
    this.game.registry.set('heapParams',     DEFAULT_HEAP_PARAMS);
    this.game.registry.set('gameAssetsReady', false);
    this.game.registry.set('heapCatalogReady', false);

    // Kick off catalog/polygon fetch in the background — does not block the menu.
    HeapClient.list()
      .then((summaries) => {
        const infiniteEntry: HeapSummary = {
          id: INFINITE_HEAP_ID,
          version: 1,
          createdAt: '2026-01-01T00:00:00.000Z',
          topY: NaN,
          params: {
            name: 'Infinite Heap',
            difficulty: 5.0,
            spawnRateMult: 1.0,
            coinMult: 1.0,
            scoreMult: 1.0,
            worldHeight: MOCK_HEAP_HEIGHT_PX,
            isInfinite: true,
          },
        };
        const deduped = summaries.filter(s => s.id !== INFINITE_HEAP_ID);
        deduped.push(infiniteEntry);
        this.game.registry.set('heapCatalog', deduped);

        if (deduped.length === 0) {
          this.game.registry.set('heapCatalogReady', true);
          this.game.events.emit('heapCatalogReady');
          return;
        }

        const stored = getSelectedHeapId();
        const pick = deduped.find((s) => s.id === stored)
                  ?? [...deduped].sort((a, b) => a.params.difficulty - b.params.difficulty
                        || a.createdAt.localeCompare(b.createdAt))[0];

        setSelectedHeapId(pick.id);
        finalizeLegacyPlaced(pick.id);
        this.game.registry.set('activeHeapId', pick.id);
        this.game.registry.set('heapParams',   pick.params);

        return HeapClient.load(pick.id).then((polygon) => {
          this.game.registry.set('heapPolygon', polygon);
          this.game.registry.set('heapCatalogReady', true);
          this.game.events.emit('heapCatalogReady');
        });
      })
      .catch(() => {
        this.game.registry.set('heapCatalogReady', true);
        this.game.events.emit('heapCatalogReady');
      });

    // Start MenuScene immediately — does not wait on the network call.
    this.scene.start('MenuScene');
  }
}
