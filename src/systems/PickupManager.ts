// src/systems/PickupManager.ts
//
// Salvage pickups: collectible trash items that spawn on heap walkable surfaces
// during a run. Walking beside one shows a proximity overlay describing its
// effect + point value; pressing GRAB (E on desktop / on-screen button on
// mobile) picks it up. Carried items stack — effects compose via
// aggregateModifiers and bonuses sum. The summed bonus is cashed in as score
// when the player reaches the top (GameScene reads getCarriedBonus()).
//
// Pure logic (spawn gating, nearest-in-range) lives in PickupHelpers.ts and is
// unit-tested separately; this class owns only the Phaser-facing wiring.

import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { PICKUP_DEFS, PickupDef, aggregateModifiers, CarryModifiers } from '../data/pickupDefs';
import { shouldSpawnPickup, findNearestInRange, walkableSurfaceCandidates, pickPolarity } from './PickupHelpers';
import type { Vertex } from './HeapPolygon';
import { SALVAGE_MIN_SPACING_PX } from '../../shared/pickupScores';
import { CHUNK_BAND_HEIGHT } from '../constants';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { getLogger } from '../logging';

const PICKUP_SIZE     = 28;                    // px square
const PICKUP_RANGE    = 72;                    // px proximity radius for overlay + grab
const SPAWN_MIN_GAP   = SALVAGE_MIN_SPACING_PX; // px min vertical spacing (shared w/ server cap)
const CULL_MARGIN      = 2400; // px below camera before a pickup is dropped
const SURFACE_ANGLE_THRESHOLD = 30; // deg — below this an edge is a walkable surface, above is a wall

/** Spawn tuning sourced from the heap's params. */
export interface PickupSpawnRates {
  base:     number;  // 0..1 chance a pickup spawns per surface candidate
  positive: number;  // weight for choosing a beneficial item
  negative: number;  // weight for choosing a hindering item
}

interface SpawnedPickup {
  def:       PickupDef;
  obj:       Phaser.GameObjects.Rectangle;
  x:         number;
  y:         number;
  collected: boolean;
}

export class PickupManager {
  private readonly scene:  Phaser.Scene;
  private readonly player: Player;
  private readonly rates:  PickupSpawnRates;

  private pickups:    SpawnedPickup[] = [];
  private carried:    PickupDef[]     = [];
  private aggregate:  CarryModifiers  = aggregateModifiers([]);
  private lastSpawnY: number | null   = null;
  private heapPolygon: Vertex[]       = [];  // full heap polygon for interior/underside rejection
  private activeIndex = -1;

  private readonly grabKey: Phaser.Input.Keyboard.Key;

  // Proximity overlay (world-space, anchored above the in-range pickup)
  private overlayBg!:     Phaser.GameObjects.Rectangle;
  private overlayName!:   Phaser.GameObjects.Text;
  private overlayEffect!: Phaser.GameObjects.Text;
  private overlayBonus!:  Phaser.GameObjects.Text;
  private overlayPrompt!: Phaser.GameObjects.Text;
  private overlayParts:   (Phaser.GameObjects.Rectangle | Phaser.GameObjects.Text)[] = [];

  // Mobile grab button (screen-space)
  private grabBtn?:   Phaser.GameObjects.Rectangle;
  private grabLabel?: Phaser.GameObjects.Text;

  // Carried-salvage HUD indicator (screen-space)
  private carriedText!: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, player: Player, rates: PickupSpawnRates) {
    this.scene  = scene;
    this.player = player;
    this.rates  = rates;
    this.grabKey = scene.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);

    this.createOverlay();
    this.createCarriedHud();
    if (InputManager.getInstance().isMobile) this.createGrabButton();
  }

  // ── Public API ────────────────────────────────────────────────────────────

  /** Set the full heap polygon, used to reject underside/interior spawn points.
   *  Call before the heap's bands are applied (and after any polygon reload). */
  setPolygon(polygon: Vertex[]): void {
    this.heapPolygon = polygon;
  }

  /** Hook from HeapGenerator.onBandLoaded — spawn only on walkable *exterior*
   *  surface edges (never walls, undersides, or interior ledges). */
  onBandLoaded(bandTopY: number, vertices: readonly { x: number; y: number }[]): void {
    const candidates = walkableSurfaceCandidates(
      vertices, bandTopY, CHUNK_BAND_HEIGHT, this.heapPolygon, SURFACE_ANGLE_THRESHOLD,
    );
    for (const c of candidates) {
      this.trySpawnAt(c.x, c.y);
    }
  }

  /** Spawn a pickup at a surface point if base chance + spacing allow. Polarity
   *  (positive vs negative item) is chosen by the heap's pos/neg rate weights. */
  private trySpawnAt(x: number, surfaceY: number): void {
    if (!shouldSpawnPickup(Math.random(), this.lastSpawnY, surfaceY, SPAWN_MIN_GAP, this.rates.base)) {
      return;
    }
    const polarity = pickPolarity(Math.random(), this.rates.positive, this.rates.negative);
    const pool = PICKUP_DEFS.filter(d => d.polarity === polarity);
    const defs = pool.length > 0 ? pool : PICKUP_DEFS; // fall back if a pool is empty
    const def = defs[Math.floor(Math.random() * defs.length)];
    this.spawnPickup(def, x, surfaceY);
    this.lastSpawnY = surfaceY;
  }

  /** Called every frame from GameScene.update(). */
  update(playerX: number, playerY: number): void {
    this.activeIndex = findNearestInRange(playerX, playerY, this.pickups, PICKUP_RANGE);
    this.refreshOverlay();

    if (this.activeIndex >= 0 && Phaser.Input.Keyboard.JustDown(this.grabKey)) {
      this.grab(this.activeIndex);
    }

    this.cullBelow(this.scene.cameras.main.scrollY + this.scene.cameras.main.height + CULL_MARGIN);
  }

  /** Dev-only: force-spawn a pickup at a world location (used by scene-preview). */
  devForceSpawn(def: PickupDef, x: number, surfaceY: number): void {
    this.spawnPickup(def, x, surfaceY);
  }

  /** Total salvage bonus to cash in at the top. */
  getCarriedBonus(): number { return this.aggregate.totalBonus; }
  /** Number of salvage items currently carried. */
  getCarriedCount(): number { return this.carried.length; }
  /** Ids of carried items — sent to the server for authoritative score validation. */
  getCarriedIds(): string[] { return this.carried.map(d => d.id); }

  // ── Spawning ──────────────────────────────────────────────────────────────

  private spawnPickup(def: PickupDef, x: number, surfaceY: number): void {
    const y = surfaceY - PICKUP_SIZE / 2;
    const obj = this.scene.add
      .rectangle(x, y, PICKUP_SIZE, PICKUP_SIZE, def.color, 1)
      .setStrokeStyle(2, 0xffffff, 0.9)
      .setDepth(8);
    // Gentle idle bob so pickups read as collectible.
    this.scene.tweens.add({
      targets: obj, y: y - 4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });
    this.pickups.push({ def, obj, x, y, collected: false });
  }

  // ── Grab ──────────────────────────────────────────────────────────────────

  private grab(index: number): void {
    const pickup = this.pickups[index];
    if (!pickup || pickup.collected) return;
    pickup.collected = true;
    this.pickups.splice(index, 1);

    this.carried.push(pickup.def);
    this.aggregate = aggregateModifiers(this.carried);
    this.player.setCarryModifiers(this.aggregate);

    AudioManager.play('enemy-kill');
    this.spawnFloatingText(pickup.x, pickup.y, `+${pickup.def.scoreBonus}`);
    this.refreshCarriedHud();

    getLogger().event({ type: 'pickup:grab', itemId: pickup.def.id, bonus: pickup.def.scoreBonus });

    // Collect animation, then destroy.
    this.scene.tweens.killTweensOf(pickup.obj);
    this.scene.tweens.add({
      targets: pickup.obj,
      y: pickup.y - 48,
      alpha: 0,
      scaleX: 1.6,
      scaleY: 1.6,
      duration: 320,
      ease: 'Cubic.Out',
      onComplete: () => pickup.obj.destroy(),
    });

    this.hideOverlay();
    this.activeIndex = -1;
  }

  private spawnFloatingText(x: number, y: number, label: string): void {
    const t = this.scene.add.text(x, y - 18, label, {
      fontSize: '20px', color: '#ffdd44', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(50);
    this.scene.tweens.add({
      targets: t, y: y - 70, alpha: 0, duration: 1400, ease: 'Cubic.Out',
      onComplete: () => t.destroy(),
    });
  }

  // ── Cull ──────────────────────────────────────────────────────────────────

  private cullBelow(cutoffY: number): void {
    if (this.pickups.length === 0) return;
    const kept: SpawnedPickup[] = [];
    for (const p of this.pickups) {
      if (p.y > cutoffY) {
        this.scene.tweens.killTweensOf(p.obj);
        p.obj.destroy();
      } else {
        kept.push(p);
      }
    }
    this.pickups = kept;
  }

  // ── Overlay UI ──────────────────────────────────────────────────────────────

  private createOverlay(): void {
    const s = this.scene;
    this.overlayBg = s.add.rectangle(0, 0, 190, 70, 0x0a0818, 0.92)
      .setOrigin(0.5, 1).setDepth(31).setStrokeStyle(1, 0x4455aa);
    this.overlayName = s.add.text(0, 0, '', {
      fontSize: '14px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(32);
    this.overlayEffect = s.add.text(0, 0, '', {
      fontSize: '11px', color: '#cfd6ff', stroke: '#000000', strokeThickness: 1, align: 'center',
      wordWrap: { width: 180 },
    }).setOrigin(0.5).setDepth(32);
    this.overlayBonus = s.add.text(0, 0, '', {
      fontSize: '12px', color: '#ffdd44', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(32);
    this.overlayPrompt = s.add.text(0, 0, '', {
      fontSize: '11px', color: '#88ff99', stroke: '#000000', strokeThickness: 1,
    }).setOrigin(0.5).setDepth(32);

    this.overlayParts = [
      this.overlayBg, this.overlayName, this.overlayEffect, this.overlayBonus, this.overlayPrompt,
    ];
    this.hideOverlay();
  }

  private refreshOverlay(): void {
    if (this.activeIndex < 0) {
      this.hideOverlay();
      this.setGrabButtonVisible(false);
      return;
    }
    const p = this.pickups[this.activeIndex];
    const cx = p.x;
    const topY = p.y - PICKUP_SIZE / 2 - 8; // panel bottom sits just above the item

    this.overlayBg.setPosition(cx, topY).setVisible(true);
    this.overlayName.setPosition(cx, topY - 56).setText(p.def.name).setVisible(true);
    this.overlayEffect.setPosition(cx, topY - 38).setText(p.def.description).setVisible(true);
    this.overlayBonus.setPosition(cx, topY - 20).setText(`+${p.def.scoreBonus} pts`).setVisible(true);

    const isMobile = InputManager.getInstance().isMobile;
    if (isMobile) {
      this.overlayPrompt.setVisible(false);
      this.setGrabButtonVisible(true);
    } else {
      this.overlayPrompt.setPosition(cx, topY - 6).setText('Press E to grab').setVisible(true);
      this.setGrabButtonVisible(false);
    }
  }

  private hideOverlay(): void {
    for (const part of this.overlayParts) part.setVisible(false);
  }

  // ── Mobile grab button ──────────────────────────────────────────────────────

  private createGrabButton(): void {
    const s = this.scene;
    const w = s.scale.width;
    const h = s.scale.height;
    this.grabBtn = s.add.rectangle(w / 2, h - 200, 200, 52, 0x0a3010, 0.9)
      .setScrollFactor(0).setDepth(24).setStrokeStyle(2, 0x44ff88)
      .setInteractive({ useHandCursor: true }).setVisible(false);
    this.grabLabel = s.add.text(w / 2, h - 200, 'GRAB', {
      fontSize: '20px', color: '#88ff99', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(25).setVisible(false);
    this.grabBtn.on('pointerup', () => {
      if (this.activeIndex >= 0) this.grab(this.activeIndex);
    });
  }

  private setGrabButtonVisible(visible: boolean): void {
    this.grabBtn?.setVisible(visible);
    this.grabLabel?.setVisible(visible);
  }

  // ── Carried HUD indicator ────────────────────────────────────────────────────

  private createCarriedHud(): void {
    this.carriedText = this.scene.add.text(this.scene.scale.width / 2, 56, '', {
      fontSize: '14px', color: '#ffdd44', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);
  }

  private refreshCarriedHud(): void {
    const n = this.carried.length;
    if (n === 0) { this.carriedText.setVisible(false); return; }
    this.carriedText.setText(`Salvage x${n}   +${this.aggregate.totalBonus}`).setVisible(true);
  }
}
