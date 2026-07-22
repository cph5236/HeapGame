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
import { PICKUP_DEFS, PickupDef, CarriedPickup, RARITY_DEFS, applyRarity, aggregateModifiers, formatEffectSummary, CarryModifiers } from '../data/pickupDefs';
import { shouldSpawnPickup, findNearestInRange, walkableSurfaceCandidates, pickPolarity, pickRarity } from './PickupHelpers';
import type { Vertex } from './HeapPolygon';
import { SALVAGE_MIN_SPACING_PX, RARITY_SCORE_MULT, Rarity, SalvageItem } from '../../shared/pickupScores';
import { CHUNK_BAND_HEIGHT } from '../constants';
import { InputManager } from './InputManager';
import { AudioManager } from './AudioManager';
import { logicalWidth, logicalHeight } from './displayMetrics';
import { addToGameplayUi } from './GameplayUiCamera';
import { getLogger } from '../logging';

const PICKUP_SIZE     = 28;                    // px visual footprint (overlay offset)
const PICKUP_CORE_RADIUS = 7;                  // px radius of the solid item circle
const PICKUP_RANGE    = 72;                    // px proximity radius for overlay + grab
const SPAWN_MIN_GAP   = SALVAGE_MIN_SPACING_PX; // px min vertical spacing (shared w/ server cap)
const CULL_MARGIN      = 2400; // px below camera before a pickup is dropped
const SURFACE_ANGLE_THRESHOLD = 30; // deg — below this an edge is a walkable surface, above is a wall

// Proximity-overlay panel geometry (drawn as a rounded, rarity-tinted card).
const OVERLAY_W      = 256;
const OVERLAY_RADIUS = 12;
/** Inner top/bottom padding and inter-row gap for the proximity card. The card
 *  height is computed per-frame from the stacked rows (an effect summary can wrap
 *  to 2 lines), so these drive the layout rather than a fixed OVERLAY_H. */
const OVERLAY_PAD     = 12;
const OVERLAY_ROW_GAP = 8;
const OVERLAY_BADGE_H = 20;
const OVERLAY_FILL_ALPHA = 0.78; // semi-transparent so the panel doesn't hide the player behind it

/** Pick dark or light badge text for contrast against a fill colour. Uses the
 *  ITU-R BT.601 perceived-luminance weights (0.299/0.587/0.114); the 0.6 cutoff
 *  is a hand-tuned threshold that keeps the tier label legible on both pale
 *  (e.g. silver/gold) and deep (e.g. royal-blue/purple) rarity hues. */
function badgeTextColor(fill: number): string {
  const r = (fill >> 16) & 0xff, g = (fill >> 8) & 0xff, b = fill & 0xff;
  const luma = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return luma > 0.6 ? '#15131f' : '#ffffff';
}

/** Spawn tuning sourced from the heap's params. */
export interface PickupSpawnRates {
  base:     number;  // 0..1 chance a pickup spawns per surface candidate
  positive: number;  // weight for choosing a beneficial item
  negative: number;  // weight for choosing a hindering item
}

interface SpawnedPickup {
  def:       PickupDef;
  rarity:    Rarity;
  obj:       Phaser.GameObjects.Container; // [glow, core]
  glow:      Phaser.GameObjects.Image;     // pulsing halo (own tween)
  x:         number;
  y:         number;
  collected: boolean;
}

const GLOW_TEX_KEY = 'pickup-glow';

/** Ordered [tier, weight] pairs for pickRarity, derived once from RARITY_DEFS. */
const RARITY_WEIGHTS = (Object.keys(RARITY_DEFS) as Rarity[])
  .map(r => [r, RARITY_DEFS[r].spawnWeight] as [Rarity, number]);

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
  private carried:    CarriedPickup[] = [];
  private aggregate:  CarryModifiers  = aggregateModifiers([]);
  private lastSpawnY: number | null   = null;
  private heapPolygon: Vertex[]       = [];  // full heap polygon for interior/underside rejection
  private activeIndex = -1;

  private readonly grabKey: Phaser.Input.Keyboard.Key;

  // Proximity overlay (world-space, anchored above the in-range pickup)
  private overlayBg!:       Phaser.GameObjects.Graphics;   // rounded panel, rarity-tinted frame
  private overlayName!:     Phaser.GameObjects.Text;
  private overlayRarityBg!: Phaser.GameObjects.Rectangle;  // filled badge behind the tier label
  private overlayRarity!:   Phaser.GameObjects.Text;
  private overlayFlavor!:   Phaser.GameObjects.Text;
  private overlayEffect!:   Phaser.GameObjects.Text;
  private overlayBonus!:    Phaser.GameObjects.Text;
  private overlayPrompt!:   Phaser.GameObjects.Text;
  private overlayParts:     (Phaser.GameObjects.GameObject & { setVisible(v: boolean): unknown })[] = [];
  private panelColor = -1;  // last rarity color the panel frame was drawn with (redraw cache)
  private panelHeight = -1; // last card height drawn (varies with effect wrap; redraw cache)

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
    const rarity = pickRarity(Math.random(), RARITY_WEIGHTS);
    this.spawnPickup(def, rarity, x, surfaceY);
    this.lastSpawnY = surfaceY;
  }

  /** Called every frame from GameScene.update(). */
  update(playerX: number, playerY: number): void {
    this.activeIndex = findNearestInRange(playerX, playerY, this.pickups, PICKUP_RANGE);
    this.refreshOverlay();

    if (this.activeIndex >= 0 && Phaser.Input.Keyboard.JustDown(this.grabKey)) {
      this.grab(this.activeIndex);
    }

    // scrollY + cam.height/zoom (not cam.worldView.bottom): worldView is stale on
    // the first update frame (refreshed in preRender), which would cull every
    // pickup spawned during create() before the camera settles. See GameScene cull.
    const cam = this.scene.cameras.main;
    this.cullBelow(cam.scrollY + cam.height / cam.zoom + CULL_MARGIN);
  }

  /** Dev-only: force-spawn a pickup at a world location (used by scene-preview). */
  devForceSpawn(def: PickupDef, rarity: Rarity, x: number, surfaceY: number): void {
    this.spawnPickup(def, rarity, x, surfaceY);
  }

  /** Total salvage bonus to cash in at the top. */
  getCarriedBonus(): number { return this.aggregate.totalBonus; }
  /** Number of salvage items currently carried. */
  getCarriedCount(): number { return this.carried.length; }
  /** Carried items + rarities — sent to the server for authoritative scoring. */
  getCarriedItems(): SalvageItem[] { return this.carried.map(c => ({ id: c.def.id, rarity: c.rarity })); }
  /** Aggregate trash-wall speed multiplier from carried items (1 = unaffected). */
  getWallSpeedMult(): number { return this.aggregate.wallSpeedMult; }

  /** Live positions of uncollected pickups, for the off-screen radar's blue arrows.
   *  Returns the internal array (read-only): grabbed/culled pickups are spliced out,
   *  so every entry is on the heap and satisfies {x,y}. Valid until the next update(). */
  getRadarTargets(): readonly { x: number; y: number }[] { return this.pickups; }

  // ── Spawning ──────────────────────────────────────────────────────────────

  private spawnPickup(def: PickupDef, rarity: Rarity, x: number, surfaceY: number): void {
    const y = surfaceY - PICKUP_CORE_RADIUS - 2; // rest the circle just above the surface
    ensureGlowTexture(this.scene);

    const rdef = RARITY_DEFS[rarity];
    // Pulsing radial-gradient halo in the rarity colour (rarer = bigger/brighter).
    const glow = this.scene.add.image(0, 0, GLOW_TEX_KEY)
      .setTint(rdef.color)
      .setScale(rdef.glowScale)
      .setAlpha(rdef.glowAlpha);
    // Solid item circle keeps the item's own colour.
    const core = this.scene.add.circle(0, 0, PICKUP_CORE_RADIUS, def.color, 1)
      .setStrokeStyle(1.5, 0xffffff, 0.85);

    const obj = this.scene.add.container(x, y, [glow, core]).setDepth(8);

    // Halo pulse (own tween on the glow child), amplitude scaled by rarity.
    this.scene.tweens.add({
      targets: glow, scale: rdef.glowScale * 1.45, alpha: Math.max(0.4, rdef.glowAlpha - 0.25),
      duration: 750, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });
    // Gentle idle bob so pickups read as collectible.
    this.scene.tweens.add({
      targets: obj, y: y - 4, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });

    this.pickups.push({ def, rarity, obj, glow, x, y, collected: false });
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
      this.carried.push({ def: pickup.def, rarity: pickup.rarity });
      this.aggregate = aggregateModifiers(this.carried);
      this.player.setCarryModifiers(this.aggregate);
      const grabBonus = Math.round(pickup.def.scoreBonus * RARITY_SCORE_MULT[pickup.rarity]);
      this.spawnFloatingText(pickup.x, pickup.y, `+${grabBonus}`);
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
    // Rounded card drawn with Graphics so we get rounded corners + a rarity-tinted
    // frame (redrawn only when the active rarity changes — see drawPanel).
    this.overlayBg = s.add.graphics().setDepth(31);
    this.overlayName = s.add.text(0, 0, '', {
      fontSize: '18px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(33);
    // Filled tier badge: dark text on the rarity colour (colour set per-pickup).
    this.overlayRarityBg = s.add.rectangle(0, 0, 10, 19, 0xffffff, 1)
      .setOrigin(0.5).setDepth(32).setStrokeStyle(1, 0x000000, 0.35);
    this.overlayRarity = s.add.text(0, 0, '', {
      fontSize: '12px', fontStyle: 'bold', color: '#15131f',
    }).setOrigin(0.5).setDepth(33);
    this.overlayFlavor = s.add.text(0, 0, '', {
      fontSize: '13px', color: '#cdd3ec', fontStyle: 'italic', stroke: '#000000', strokeThickness: 2,
      align: 'center', wordWrap: { width: 232 },
    }).setOrigin(0.5).setDepth(33);
    this.overlayEffect = s.add.text(0, 0, '', {
      fontSize: '14px', color: '#e2e7ff', stroke: '#000000', strokeThickness: 2, align: 'center',
      wordWrap: { width: 232 },
    }).setOrigin(0.5).setDepth(33);
    this.overlayBonus = s.add.text(0, 0, '', {
      fontSize: '16px', color: '#ffdd44', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(33);
    this.overlayPrompt = s.add.text(0, 0, '', {
      fontSize: '13px', color: '#9dffac', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(33);

    this.overlayParts = [
      this.overlayBg, this.overlayRarityBg, this.overlayName, this.overlayRarity,
      this.overlayFlavor, this.overlayEffect, this.overlayBonus, this.overlayPrompt,
    ];
    this.hideOverlay();
  }

  /** Redraw the rounded card with a rarity-tinted frame. Cheap, but only called
   *  when the active pickup's rarity colour changes (panelColor cache). */
  private drawPanel(color: number, height: number): void {
    const g = this.overlayBg;
    g.clear();
    // Body — drawn from (-W/2, -height) to (W/2, 0) so the card's bottom sits at
    // the graphics origin (placed just above the item each frame). Height varies
    // with content (a wrapped effect summary), so this is cached on panelHeight.
    g.fillStyle(0x0a0818, OVERLAY_FILL_ALPHA);
    g.fillRoundedRect(-OVERLAY_W / 2, -height, OVERLAY_W, height, OVERLAY_RADIUS);
    g.lineStyle(2, color, 1);
    g.strokeRoundedRect(-OVERLAY_W / 2, -height, OVERLAY_W, height, OVERLAY_RADIUS);
  }

  private refreshOverlay(): void {
    if (this.activeIndex < 0) {
      this.hideOverlay();
      this.setGrabButtonVisible(false);
      return;
    }
    const p = this.pickups[this.activeIndex];
    const rdef = RARITY_DEFS[p.rarity];
    const cx = p.x;
    const bottomY = p.y - PICKUP_SIZE / 2 - 8; // card bottom sits just above the item
    const isMobile = InputManager.getInstance().isMobile;

    // Set every text first, so each object's measured .height reflects any
    // word-wrapping (the effect summary can wrap to 2 lines at high rarity).
    this.overlayRarity.setText(rdef.label).setColor(badgeTextColor(rdef.color));
    this.overlayName.setText(p.def.name);
    this.overlayFlavor.setText(p.def.description);
    // Rarity-scaled effect summary so the overlay shows what the player actually gets.
    const effLabel = p.def.grantsShield ? 'Absorb 1 hit' : formatEffectSummary(applyRarity(p.def.effect, p.rarity));
    this.overlayEffect.setText(effLabel);
    // Carry items show their rarity-scaled point value; instant/free items show FREE.
    const scaledBonus = Math.round(p.def.scoreBonus * RARITY_SCORE_MULT[p.rarity]);
    this.overlayBonus.setText(p.def.scoreBonus > 0 ? `+${scaledBonus} pts` : 'FREE');

    // Stack rows from the BOTTOM up (the card is anchored just above the item), so
    // a 2-line effect grows the card upward rather than overlapping the bonus/
    // prompt beneath it. `cursor` tracks the bottom edge of the next row up.
    let cursor = bottomY - OVERLAY_PAD;
    const stackUp = (t: Phaser.GameObjects.Text): void => {
      t.setPosition(cx, cursor - t.height / 2).setVisible(true);
      cursor -= t.height + OVERLAY_ROW_GAP;
    };

    // Bottom row: the grab prompt (desktop) or nothing (mobile shows the GRAB button).
    if (isMobile) {
      this.overlayPrompt.setVisible(false);
      this.setGrabButtonVisible(true);
    } else {
      this.overlayPrompt.setText('Press E to grab');
      this.setGrabButtonVisible(false);
      stackUp(this.overlayPrompt);
    }
    stackUp(this.overlayBonus);
    stackUp(this.overlayEffect);
    stackUp(this.overlayFlavor);
    stackUp(this.overlayName);

    // Tier badge — a filled pill in the rarity colour, sized to its label; a fixed-
    // height row above the name.
    this.overlayRarityBg.setSize(this.overlayRarity.width + 18, OVERLAY_BADGE_H).setFillStyle(rdef.color, 1);
    const badgeCenterY = cursor - OVERLAY_BADGE_H / 2;
    this.overlayRarityBg.setPosition(cx, badgeCenterY).setVisible(true);
    this.overlayRarity.setPosition(cx, badgeCenterY).setVisible(true);

    // Size the card to span from just above the badge down to the item, and redraw
    // only when the rarity colour or the computed height changes.
    const height = Math.round(bottomY - (badgeCenterY - OVERLAY_BADGE_H / 2) + OVERLAY_PAD);
    if (rdef.color !== this.panelColor || height !== this.panelHeight) {
      this.drawPanel(rdef.color, height);
      this.panelColor = rdef.color;
      this.panelHeight = height;
    }
    this.overlayBg.setPosition(cx, bottomY).setVisible(true);
  }

  private hideOverlay(): void {
    for (const part of this.overlayParts) part.setVisible(false);
  }

  // ── Mobile grab button ──────────────────────────────────────────────────────

  private createGrabButton(): void {
    const s = this.scene;
    const w = logicalWidth(s);
    const h = logicalHeight(s);
    this.grabBtn = s.add.rectangle(w / 2, h - 200, 200, 52, 0x0a3010, 0.9)
      .setScrollFactor(0).setDepth(24).setStrokeStyle(2, 0x44ff88)
      .setInteractive({ useHandCursor: true }).setVisible(false);
    this.grabLabel = s.add.text(w / 2, h - 200, 'GRAB', {
      fontSize: '20px', color: '#88ff99', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(25).setVisible(false);
    this.grabBtn.on('pointerup', () => {
      if (this.activeIndex >= 0) this.grab(this.activeIndex);
    });
    addToGameplayUi(s, [this.grabBtn, this.grabLabel]);
  }

  private setGrabButtonVisible(visible: boolean): void {
    this.grabBtn?.setVisible(visible);
    this.grabLabel?.setVisible(visible);
    // Register/clear the button's screen zone so a tap on it never also jumps.
    // Rect mirrors the button geom: centred at (w/2, h-200), size 200×52.
    const w = logicalWidth(this.scene);
    const h = logicalHeight(this.scene);
    InputManager.getInstance().setSuppressionRect(
      'grab', visible ? { x: w / 2 - 100, y: h - 200 - 26, w: 200, h: 52 } : null,
    );
  }

  // ── Carried HUD indicator ────────────────────────────────────────────────────

  private createCarriedHud(): void {
    this.carriedText = this.scene.add.text(logicalWidth(this.scene) / 2, 56, '', {
      fontSize: '14px', color: '#ffdd44', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);
    addToGameplayUi(this.scene, this.carriedText);
  }

  private refreshCarriedHud(): void {
    const n = this.carried.length;
    if (n === 0) { this.carriedText.setVisible(false); return; }
    this.carriedText.setText(`Salvage x${n}   +${this.aggregate.totalBonus}`).setVisible(true);
  }
}
