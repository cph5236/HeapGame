import Phaser from 'phaser';
import trashbagUrl from '../sprites/player/trashbag.png?url';
import { HeapClient } from '../systems/HeapClient';
import type { Vertex } from '../systems/HeapPolygon';
import { generateAllTextures } from '../entities/TextureGenerators';
import type { HeapSummary } from '../../shared/heapTypes';
import { DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { getSelectedHeapId, setSelectedHeapId, finalizeLegacyPlaced, setGpgsPlayerId, setPlayerName, getPlayerName, getEffectivePlayerId, getRawSaveForCloudSync, applyMergedSave, mergeCloudSave, getTutorialDone } from '../systems/SaveData';
import { PlayerNameClient } from '../systems/PlayerNameClient';
import { validatePlayerName } from '../../shared/playerName';
import type { RawSave } from '../systems/SaveData';
import { INFINITE_HEAP_ID } from '../data/infiniteDefs';
import { buildInfiniteEntry } from '../data/infiniteCatalog';
import { initLogger } from '../logging';
import { PlayGamesClient } from '../systems/PlayGamesClient';
import { AudioManager } from '../systems/AudioManager';
import { AdClient } from '../systems/ads/AdClient';
import { primeConfig } from '../systems/ConfigClient';
import { loadGameAssets } from './loadGameAssets';

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
    AudioManager.init(this.sound);
    AdClient.initialize().catch(() => { /* silent — ad init is optional */ });
    primeConfig(); // kicks off the remote-config fetch; LoadingScene awaits configReady() before opening the menu

    // Default registry state so MenuScene can render before catalog resolves.
    this.game.registry.set('heapCatalog',    [] as HeapSummary[]);
    this.game.registry.set('activeHeapId',   '');
    this.game.registry.set('heapPolygon',    [] as Vertex[]);
    this.game.registry.set('heapParams',     DEFAULT_HEAP_PARAMS);
    this.game.registry.set('gameAssetsReady', false);
    this.game.registry.set('heapCatalogReady', false);

    // Initialize logger after SaveData is importable but before async catalog fetch.
    initLogger();

    // Attempt GPGS sign-in in background — does not block menu render.
    PlayGamesClient.signIn().then(async (player) => {
      if (!player) return;
      setGpgsPlayerId(player.playerId);
      setPlayerName(player.displayName);
      // Sync the GPGS display name to the server's player_name table — score
      // submit no longer updates names, and GPGS players can't reach the
      // rename modal, so this is their only refresh path after first seed.
      // Uses the locally-stored form (setPlayerName truncates to the shared
      // max) and only when it passes the shared validator — raw GPGS names
      // can be up to 100 chars and the server would 400 silently.
      const validated = validatePlayerName(getPlayerName());
      if (validated.ok) {
        void PlayerNameClient.updateName(getEffectivePlayerId(), validated.name);
      }
      this.game.events.emit('gpgs:signed-in', player.displayName);

      // Load cloud snapshot and merge with local SaveData.
      const cloudJson = await PlayGamesClient.loadSnapshot();
      if (!cloudJson) return;

      let cloudSave: RawSave;
      try {
        cloudSave = JSON.parse(cloudJson) as RawSave;
      } catch {
        return; // malformed cloud data — skip merge
      }

      const localSave = getRawSaveForCloudSync();
      const merged    = mergeCloudSave(localSave, cloudSave);
      applyMergedSave(merged);
      setPlayerName(player.displayName); // GPGS name always wins after merge
      this.game.events.emit('gpgs:signed-in', player.displayName);
      this.game.events.emit('gpgs:save-merged');
    }).catch(() => { /* silent — cloud save merge is optional */ });

    // Dev scene shortcut — only active in Vite dev mode, dead code in production builds.
    if (import.meta.env.DEV && typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      if (search.has('dev')) {
        const sceneName = search.get('dev')!;
        let params: Record<string, unknown> = {};
        try {
          params = JSON.parse(search.get('params') ?? '{}');
        } catch {
          // invalid JSON — use empty params, scene falls back to its own defaults
        }
        void this.startDevScene(sceneName, params);
        return;
      }
    }

    // Kick off catalog/polygon fetch in the background — does not block the menu.
    HeapClient.list()
      .then((summaries) => {
        const deduped = summaries.filter(s => s.id !== INFINITE_HEAP_ID);
        deduped.push(buildInfiniteEntry(summaries));
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

        const ready = () => {
          this.game.registry.set('heapCatalogReady', true);
          this.game.events.emit('heapCatalogReady');
        };
        if (pick.params.isInfinite) {
          this.game.registry.set('heapPolygon', []);
          return HeapClient.primeEnemyParams(pick.id).then(ready);
        }
        return HeapClient.load(pick.id).then((polygon) => {
          this.game.registry.set('heapPolygon', polygon);
          ready();
        });
      })
      .catch(() => {
        this.game.registry.set('heapCatalogReady', true);
        this.game.events.emit('heapCatalogReady');
      });

    // Hand off to the themed loading screen, which blocks the menu until game
    // assets finish loading (so the menu paints fully-built, not mid-stream). The
    // network catalog fetch above keeps resolving in the background — MenuScene
    // already renders against defaults and refreshes on `heapCatalogReady`.
    this.scene.start('LoadingScene', { next: getTutorialDone() ? 'MenuScene' : 'TutorialScene' });
  }

  /**
   * Dev-only: boot directly into a scene for screenshot/preview tooling.
   * Gameplay scenes assume MenuScene already ran `loadGameAssets`, so load the
   * full asset set (heap tiles, enemies, audio) here. The server-driven
   * GameScene additionally needs a heap polygon in the registry, so fetch one
   * before starting; InfiniteGameScene is procedural and needs only the assets.
   */
  private async startDevScene(sceneName: string, params: Record<string, unknown>): Promise<void> {
    loadGameAssets(this);

    if (sceneName === 'GameScene') {
      try {
        const summaries = await HeapClient.list();
        const pick = summaries
          .filter(s => s.id !== INFINITE_HEAP_ID)
          .sort((a, b) => a.params.difficulty - b.params.difficulty
            || a.createdAt.localeCompare(b.createdAt))[0];
        if (pick) {
          setSelectedHeapId(pick.id);
          this.game.registry.set('activeHeapId', pick.id);
          this.game.registry.set('heapParams',   pick.params);
          this.game.registry.set('heapPolygon',  await HeapClient.load(pick.id));
        }
      } catch {
        // Offline / no worker — GameScene falls back to an empty heap.
      }
    }

    if (this.registry.get('gameAssetsReady') === true) {
      this.scene.start(sceneName, params);
    } else {
      this.game.events.once('gameAssetsReady', () => this.scene.start(sceneName, params));
    }
  }
}
