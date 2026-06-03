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
import { PICKUP_DEFS, PickupDef, aggregateModifiers, formatEffectSummary, CarryModifiers } from '../data/pickupDefs';
import { shouldSpawnPickup, findNearestInRange, walkableSurfaceCandidates, pickPolarity } from './PickupHelpers';
import type { Vertex } from './HeapPolygon';
import { SALVAGE_MIN_SPACING_PX } from '../../shared/pickupScores';
import { CHUNK_BAND_HEIGHT } from '../constants';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { getLogger } from '../logging';

const PICKUP_SIZE     = 28;                    // px visual footprint (overlay offset)
const PICKUP_CORE_RADIUS = 7;                  // px radius of the solid item circle
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
  obj:       Phaser.GameObjects.Container; // [glow, core]
  glow:      Phaser.GameObjects.Image;     // pulsing halo (own tween)
  x:         number;
  y:         number;
  collected: boolean;
}

const GLOW_TEX_KEY = 'pickup-glow';

/** Bake a soft white radial-gradient disc once; tinted per item for the halo. */
function ensureGlowTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(GLOW_TEX_KEY)) return;
  const R = 32;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const steps = 18;
  for (let i = 0; i < steps; i++) {
    const t = i / (steps - 1);          // 0 = outer, 1 = centre
    g.fillStyle(0xffffff, t * 0.18);    // accumulate alpha toward the centre
    g.fillCircle(R, R, R * (1 - t));
  }
  g.generateTexture(GLOW_TEX_KEY, R * 2, R * 2);
  g.destroy();
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
  private overlayFlavor!: Phaser.GameObjects.Text;
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

    // The InputManager singleton outlives this scene; drop our suppression zone
    // on shutdown so a stale GRAB rect can't linger into the next scene.
    scene.events.once(Phaser.Scenes.Events.SHUTDOWN, () =>
      InputManager.getInstance().setSuppressionRect('grab', null),
    );
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
  /** Aggregate trash-wall speed multiplier from carried items (1 = unaffected). */
  getWallSpeedMult(): number { return this.aggregate.wallSpeedMult; }

  // ── Spawning ──────────────────────────────────────────────────────────────

  private spawnPickup(def: PickupDef, x: number, surfaceY: number): void {
    const y = surfaceY - PICKUP_CORE_RADIUS - 2; // rest the circle just above the surface
    ensureGlowTexture(this.scene);

    // Pulsing radial-gradient halo in the item's colour.
    // Normal blend (not ADD): ADD saturates toward white over bright backgrounds,
    // hiding the item colour. Normal blend keeps the tint true.
    const glow = this.scene.add.image(0, 0, GLOW_TEX_KEY)
      .setTint(def.color)
      .setScale(0.85)
      .setAlpha(0.9);
    // Solid item circle.
    const core = this.scene.add.circle(0, 0, PICKUP_CORE_RADIUS, def.color, 1)
      .setStrokeStyle(1.5, 0xffffff, 0.85);

    const obj = this.scene.add.container(x, y, [glow, core]).setDepth(8);

    // Halo pulse (own tween on the glow child).
    this.scene.tweens.add({
      targets: glow, scale: 1.25, alpha: 0.65,
      duration: 750, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });
    // Gentle idle bob so pickups read as collectible.
    this.scene.tweens.add({
      targets: obj, y: y - 4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });

    this.pickups.push({ def, obj, glow, x, y, collected: false });
  }

  // ── Grab ──────────────────────────────────────────────────────────────────

  private grab(index: number): void {
    const pickup = this.pickups[index];
    if (!pickup || pickup.collected) return;
    pickup.collected = true;
    this.pickups.splice(index, 1);

    if (pickup.def.grantsShield) {
      // Instant item: activate a shield, do not carry (no stack effect, no bonus).
      this.player.activateShield();
      this.spawnFloatingText(pickup.x, pickup.y, 'SHIELD');
    } else {
      this.carried.push(pickup.def);
      this.aggregate = aggregateModifiers(this.carried);
      this.player.setCarryModifiers(this.aggregate);
      this.spawnFloatingText(pickup.x, pickup.y, `+${pickup.def.scoreBonus}`);
      this.refreshCarriedHud();
    }

    AudioManager.play('enemy-kill');
    getLogger().event({ type: 'pickup:grab', itemId: pickup.def.id, bonus: pickup.def.scoreBonus });

    // Collect animation, then destroy.
    this.scene.tweens.killTweensOf(pickup.obj);
    this.scene.tweens.killTweensOf(pickup.glow);
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
        this.scene.tweens.killTweensOf(p.glow);
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
    this.overlayBg = s.add.rectangle(0, 0, 252, 132, 0x0a0818, 1)
      .setOrigin(0.5, 1).setDepth(31).setStrokeStyle(2, 0x5566cc);
    this.overlayName = s.add.text(0, 0, '', {
      fontSize: '18px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(32);
    this.overlayFlavor = s.add.text(0, 0, '', {
      fontSize: '13px', color: '#cdd3ec', fontStyle: 'italic', stroke: '#000000', strokeThickness: 2,
      align: 'center', wordWrap: { width: 236 },
    }).setOrigin(0.5).setDepth(32);
    this.overlayEffect = s.add.text(0, 0, '', {
      fontSize: '14px', color: '#e2e7ff', stroke: '#000000', strokeThickness: 2, align: 'center',
      wordWrap: { width: 236 },
    }).setOrigin(0.5).setDepth(32);
    this.overlayBonus = s.add.text(0, 0, '', {
      fontSize: '16px', color: '#ffdd44', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(32);
    this.overlayPrompt = s.add.text(0, 0, '', {
      fontSize: '13px', color: '#9dffac', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(32);

    this.overlayParts = [
      this.overlayBg, this.overlayName, this.overlayFlavor, this.overlayEffect, this.overlayBonus, this.overlayPrompt,
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
    this.overlayName.setPosition(cx, topY - 112).setText(p.def.name).setVisible(true);
    this.overlayFlavor.setPosition(cx, topY - 84).setText(p.def.description).setVisible(true);
    // Auto-summarised mechanical effect (so flavour text doesn't hide what it does).
    const effLabel = p.def.grantsShield ? 'Absorb 1 hit' : formatEffectSummary(p.def.effect);
    this.overlayEffect.setPosition(cx, topY - 54).setText(effLabel).setVisible(true);
    // Carry items show their point value; instant/free items (e.g. shield) show FREE.
    const bonusLabel = p.def.scoreBonus > 0 ? `+${p.def.scoreBonus} pts` : 'FREE';
    this.overlayBonus.setPosition(cx, topY - 32).setText(bonusLabel).setVisible(true);

    const isMobile = InputManager.getInstance().isMobile;
    if (isMobile) {
      this.overlayPrompt.setVisible(false);
      this.setGrabButtonVisible(true);
    } else {
      this.overlayPrompt.setPosition(cx, topY - 10).setText('Press E to grab').setVisible(true);
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
    // Register/clear the button's screen zone so a tap on it never also jumps.
    // Rect mirrors the button geom: centred at (w/2, h-200), size 200×52.
    const w = this.scene.scale.width;
    const h = this.scene.scale.height;
    InputManager.getInstance().setSuppressionRect(
      'grab', visible ? { x: w / 2 - 100, y: h - 200 - 26, w: 200, h: 52 } : null,
    );
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
