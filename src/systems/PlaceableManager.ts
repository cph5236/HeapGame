// src/systems/PlaceableManager.ts
import Phaser from 'phaser';
import {
  LADDER_HEIGHT, LADDER_WIDTH,
  IBEAM_WIDTH, IBEAM_HEIGHT,
  SNAP_RADIUS,
} from '../constants';
import {
  getPlaced, addPlaced, removePlaced,
  spendItem, getItemQuantity, PlacedItemSave,
} from './SaveData';
import { ITEM_DEFS } from '../data/itemDefs';
import { CONSUMABLE_DEFS } from '../data/consumableDefs';
import type { BuffManager } from './BuffManager';
import { Player } from '../entities/Player';
import { getLogger } from '../logging';
import { InputManager } from './InputManager';
import { logicalWidth, logicalHeight, getDprCap } from './displayMetrics';
import { addToGameplayUi } from './GameplayUiCamera';
import { HUD_THEME } from '../ui/hudTheme';
import { ACCENT_COLORS } from '../data/itemAccents';
import { computeHotbarLayout, HOTBAR } from './hotbarLayout';

export const enum PlacementState { Closed, Hotbar, Placing }

/** Pure helper — exported for unit testing. */
export function passesSurfaceCheck(
  savedY: number,
  surfaceY: number,
  threshold: number,
): boolean {
  return Math.abs(savedY - surfaceY) <= threshold;
}

interface SpawnedBody {
  saveIndex: number;
  object:    Phaser.GameObjects.Image;
  itemId:    string;
}

export class PlaceableManager {
  private readonly scene:             Phaser.Scene;
  private readonly player:            Player;
  private readonly buffManager:       BuffManager;
  private readonly walkableGroups:    Phaser.Physics.Arcade.StaticGroup[];
  private readonly wallGroups:        Phaser.Physics.Arcade.StaticGroup[];
  private readonly _heapId:           string;
  private readonly _resnapOnLoad:     boolean;
  private readonly _excludeCheckpoint: boolean;
  private pendingSaves: { save: PlacedItemSave; index: number }[] = [];

  private state:          PlacementState = PlacementState.Closed;
  private placingItemId:  string = '';
  private ghostRects:     Record<string, Phaser.GameObjects.Rectangle> = {};
  private ghostValid:     boolean = false;
  private ghostWorldX:    number = 0;
  private ghostWorldY:    number = 0;
  private ghostLocked:    boolean = false;
  // findSurfaceY scans walkableGroup.getChildren() every call. Cache by
  // pointer position so a stationary cursor doesn't re-scan every frame.
  private _lastPtrX:      number = Number.NaN;
  private _lastPtrY:      number = Number.NaN;

  private hotbarGfx!:          Phaser.GameObjects.Graphics;
  private hotbarTitle!:        Phaser.GameObjects.Text;
  private hotbarItems:         Phaser.GameObjects.Rectangle[] = [];  // transparent hit areas
  private hotbarLabels:        Phaser.GameObjects.Text[] = [];
  private hotbarQtys:          Phaser.GameObjects.Text[] = [];
  private hotbarScrollOffset:  number = 0;
  private hotbarOwnedIds:      string[] = [];
  private scrollLeftBtn!:      Phaser.GameObjects.Rectangle;  // transparent hit area
  private scrollLeftTxt!:      Phaser.GameObjects.Text;
  private scrollRightBtn!:     Phaser.GameObjects.Rectangle;  // transparent hit area
  private scrollRightTxt!:     Phaser.GameObjects.Text;

  private confirmBtn!:    Phaser.GameObjects.Rectangle;
  private confirmTxt!:    Phaser.GameObjects.Text;
  private cancelBtn!:     Phaser.GameObjects.Rectangle;
  private cancelTxt!:     Phaser.GameObjects.Text;
  private statusLabel!:   Phaser.GameObjects.Text;

  private spawnedBodies:  SpawnedBody[] = [];
  private ladderOverlaps: Phaser.Physics.Arcade.Collider[] = [];
  private ibeamColliders: Phaser.Physics.Arcade.Collider[] = [];
  private ladderOverlapThisFrame = false;
  private checkpointGroup!: Phaser.Physics.Arcade.StaticGroup;

  constructor(
    scene:              Phaser.Scene,
    player:             Player,
    walkableGroup:      Phaser.Physics.Arcade.StaticGroup | Phaser.Physics.Arcade.StaticGroup[],
    wallGroup:          Phaser.Physics.Arcade.StaticGroup | Phaser.Physics.Arcade.StaticGroup[],
    heapId:             string,
    buffManager:        BuffManager,
    resnapOnLoad?:      boolean,
    excludeCheckpoint?: boolean,
  ) {
    this.scene               = scene;
    this.player              = player;
    this.buffManager         = buffManager;
    this.walkableGroups      = Array.isArray(walkableGroup) ? walkableGroup : [walkableGroup];
    this.wallGroups          = Array.isArray(wallGroup) ? wallGroup : [wallGroup];
    this._heapId             = heapId;
    this._resnapOnLoad       = resnapOnLoad ?? false;
    this._excludeCheckpoint  = excludeCheckpoint ?? false;

    this.checkpointGroup = scene.physics.add.staticGroup();
    this.createUI();
    this.spawnSavedItems();
  }

  // ── Public API ───────────────────────────────────────────────────────────────

  /** Called from GameScene.update() */
  update(): void {
    // Exit ladder when player is no longer overlapping any ladder body
    if (this.player.isOnLadder && !this.ladderOverlapThisFrame) {
      this.player.exitLadder();
    }
    this.ladderOverlapThisFrame = false;

    if (this.state === PlacementState.Placing) {
      this.updateGhost();
    }
  }

  openHotbar(): void {
    if (this.state !== PlacementState.Closed) {
      this.closeAll();
      return;
    }
    this.state = PlacementState.Hotbar;
    this.hotbarScrollOffset = 0;
    this.refreshHotbar();
  }

  closeAll(): void {
    this.state = PlacementState.Closed;
    this.placingItemId = '';
    this.ghostLocked = false;
    this.scene.input.off('pointermove', this.onPointerMove, this);
    this.scene.input.off('pointerdown', this.onPlacementClick, this);
    this.scene.input.keyboard!.removeAllListeners('keydown-ENTER');
    this.player.setPlacementMode(false);
    this.confirmTxt?.setText('PLACE  [↵]');
    this.setHotbarVisible(false);
    this.setPlacementUIVisible(false);
    this.hideGhost();
    this._lastPtrX = Number.NaN;
    this._lastPtrY = Number.NaN;
  }

  private hideGhost(): void {
    for (const key in this.ghostRects) this.ghostRects[key].setVisible(false);
  }

  // ── UI creation ──────────────────────────────────────────────────────────────

  private createUI(): void {
    const { scene } = this;
    const GAME_WIDTH  = logicalWidth(scene);
    const GAME_HEIGHT = logicalHeight(scene);

    // Ghost rectangles — one pre-built shape per item type; only the active
    // one is shown. Property updates (position, fillColor, strokeColor) avoid
    // any per-frame Graphics clear/redraw.
    this.ghostRects.ladder = scene.add
      .rectangle(0, 0, LADDER_WIDTH, LADDER_HEIGHT, 0x44ff88, 0.5)
      .setOrigin(0.5, 1).setDepth(30).setVisible(false);
    this.ghostRects.ibeam = scene.add
      .rectangle(0, 0, IBEAM_WIDTH, IBEAM_HEIGHT, 0x44ff88, 0.5)
      .setOrigin(0.5, 1).setDepth(30).setVisible(false);
    this.ghostRects.checkpoint = scene.add
      .rectangle(0, 0, 32, 32, 0x44ff88, 0.5)
      .setOrigin(0.5, 1).setDepth(30).setVisible(false);

    // Chrome for the whole tray is drawn in one Graphics, redrawn in refreshHotbar.
    this.hotbarGfx = scene.add.graphics().setScrollFactor(0).setDepth(25).setVisible(false);

    // Title
    this.hotbarTitle = scene.add.text(0, 0, 'BACKPACK', {
      fontSize: '11px', color: HUD_THEME.textWhite, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 1,
    }).setOrigin(0.5).setLetterSpacing(2).setScrollFactor(0).setDepth(27).setVisible(false);

    // Per-item: transparent interactive hit area + name + qty (positions set in refreshHotbar)
    ITEM_DEFS.forEach((def) => {
      const slot = scene.add.rectangle(0, 0, HOTBAR.slotW, HOTBAR.slotH, 0x000000, 0)
        .setScrollFactor(0).setDepth(26)
        .setVisible(false)
        .setInteractive({ useHandCursor: true });

      const label = scene.add.text(0, 0, def.name, {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
        align: 'center', wordWrap: { width: HOTBAR.slotW - 8 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(27).setVisible(false);

      const qty = scene.add.text(0, 0, '', {
        fontSize: '11px', color: '#0a0c1a', fontStyle: 'bold',
      }).setOrigin(1, 0).setScrollFactor(0).setDepth(28).setVisible(false);

      slot.on('pointerup', () => this.selectItem(def.id));

      this.hotbarItems.push(slot);
      this.hotbarLabels.push(label);
      this.hotbarQtys.push(qty);
    });

    // Scroll buttons — transparent hit areas; chrome + glyph drawn/positioned in refreshHotbar
    this.scrollLeftBtn = scene.add.rectangle(0, 0, HOTBAR.scrollBtnW, HOTBAR.slotH, 0x000000, 0)
      .setScrollFactor(0).setDepth(27).setInteractive({ useHandCursor: true }).setVisible(false);
    this.scrollLeftTxt = scene.add.text(0, 0, '◀', {
      fontSize: '15px', color: '#aabbff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(28).setVisible(false);
    this.scrollLeftBtn.on('pointerup', () => {
      this.hotbarScrollOffset = Math.max(0, this.hotbarScrollOffset - 1);
      this.refreshHotbar();
    });

    this.scrollRightBtn = scene.add.rectangle(0, 0, HOTBAR.scrollBtnW, HOTBAR.slotH, 0x000000, 0)
      .setScrollFactor(0).setDepth(27).setInteractive({ useHandCursor: true }).setVisible(false);
    this.scrollRightTxt = scene.add.text(0, 0, '▶', {
      fontSize: '15px', color: '#aabbff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(28).setVisible(false);
    this.scrollRightBtn.on('pointerup', () => {
      const maxOffset = Math.max(0, this.hotbarOwnedIds.length - this.hotbarMaxVisibleCount());
      this.hotbarScrollOffset = Math.min(maxOffset, this.hotbarScrollOffset + 1);
      this.refreshHotbar();
    });

    // Confirm button
    this.confirmBtn = scene.add.rectangle(
      GAME_WIDTH / 2 - 60, GAME_HEIGHT - 60, 110, 36, 0x0a3010,
    ).setScrollFactor(0).setDepth(25).setStrokeStyle(2, 0x44ff88)
     .setInteractive({ useHandCursor: true }).setVisible(false);

    this.confirmTxt = scene.add.text(GAME_WIDTH / 2 - 60, GAME_HEIGHT - 60, 'PLACE  [↵]', {
      fontSize: '16px', color: '#44ff88', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(26).setVisible(false);

    this.confirmBtn.on('pointerup', () => this.confirmPlacement());

    // Cancel button
    this.cancelBtn = scene.add.rectangle(
      GAME_WIDTH / 2 + 60, GAME_HEIGHT - 60, 110, 36, 0x200a0a,
    ).setScrollFactor(0).setDepth(25).setStrokeStyle(2, 0xff4444)
     .setInteractive({ useHandCursor: true }).setVisible(false);

    this.cancelTxt = scene.add.text(GAME_WIDTH / 2 + 60, GAME_HEIGHT - 60, 'CANCEL', {
      fontSize: '16px', color: '#ff4444', fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(26).setVisible(false);

    this.cancelBtn.on('pointerup', () => this.closeAll());

    // Status label — placement instruction above the buttons
    this.statusLabel = scene.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 100, '', {
      fontSize: '13px', color: '#cccccc',
      stroke: '#000000', strokeThickness: 2,
      align: 'center',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(26).setVisible(false);

    // Register all screen-space hotbar/placement UI to the gameplay UI camera.
    // (Ghost rects above are world-space — left on the main camera.)
    addToGameplayUi(scene, [
      this.hotbarGfx, this.hotbarTitle, ...this.hotbarItems, ...this.hotbarLabels, ...this.hotbarQtys,
      this.scrollLeftBtn, this.scrollLeftTxt, this.scrollRightBtn, this.scrollRightTxt,
      this.confirmBtn, this.confirmTxt, this.cancelBtn, this.cancelTxt, this.statusLabel,
    ]);
  }

  // ── Spawn saved items on run start ───────────────────────────────────────────

  private spawnSavedItems(): void {
    const placed = getPlaced(this._heapId);
    placed.forEach((save, index) => this.tryResolveAndSpawn(save, index));
  }

  /**
   * Re-attempt to spawn any saved items that previously had no surface within
   * SNAP_RADIUS. Call from the scene whenever new heap bands are generated
   * (resnapOnLoad mode only).
   */
  retryPendingSpawns(): void {
    if (!this._resnapOnLoad || this.pendingSaves.length === 0) return;
    const still: { save: PlacedItemSave; index: number }[] = [];
    for (const { save, index } of this.pendingSaves) {
      if (!this.tryResolveAndSpawn(save, index, /*allowPending*/ false)) {
        still.push({ save, index });
      }
    }
    this.pendingSaves = still;
  }

  /** Returns true if the item was spawned (or skipped by checkpoint exclusion). */
  private tryResolveAndSpawn(
    save: PlacedItemSave,
    index: number,
    allowPending = true,
  ): boolean {
    let resolved: PlacedItemSave = save;
    if (this._resnapOnLoad) {
      if (save.id === 'ibeam') {
        const snap = this.findNearbyWallSnap(save.x, save.y);
        if (snap === null) {
          if (allowPending) this.pendingSaves.push({ save, index });
          return false;
        }
        resolved = { ...save, x: snap.x, y: snap.y };
      } else {
        const snapY = this.findSurfaceY(save.x, save.y);
        if (snapY === null) {
          if (allowPending) this.pendingSaves.push({ save, index });
          return false;
        }
        resolved = { ...save, y: snapY };
      }
    }
    switch (resolved.id) {
      case 'ladder':     this.spawnLadderBody(resolved, index);     break;
      case 'ibeam':      this.spawnIBeamBody(resolved, index);      break;
      case 'checkpoint':
        if (!this._excludeCheckpoint) this.spawnCheckpointBody(resolved, index);
        break;
    }
    return true;
  }

  /**
   * I-Beam load re-snap: find a wall face whose closest point is within
   * SNAP_RADIUS of (savedX, savedY). Returns the beam center coords
   * (face-aligned X, Y clamped to wall vertical extent) or null.
   */
  private findNearbyWallSnap(savedX: number, savedY: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const group of this.wallGroups) {
      for (const obj of group.getChildren()) {
        const body = (obj as Phaser.GameObjects.Image).body as Phaser.Physics.Arcade.StaticBody;
        const closestX = Math.max(body.left, Math.min(savedX, body.right));
        const closestY = Math.max(body.top,  Math.min(savedY, body.bottom));
        const dx = savedX - closestX;
        const dy = savedY - closestY;
        const dist = Math.sqrt(dx * dx + dy * dy);
        if (dist > SNAP_RADIUS || dist >= bestDist) continue;
        const distLeft  = Math.abs(savedX - body.left);
        const distRight = Math.abs(savedX - body.right);
        const faceX   = distLeft < distRight ? body.left : body.right;
        const outward = distLeft < distRight ? -1 : 1;
        bestDist = dist;
        best = { x: faceX + outward * IBEAM_WIDTH / 2, y: closestY };
      }
    }
    return best;
  }

  // ── Item selection & placement mode ─────────────────────────────────────────

  private selectItem(itemId: string): void {
    const behavior = CONSUMABLE_DEFS[itemId];
    if (behavior) {
      if (spendItem(itemId)) {
        if (behavior.kind === 'shield')        this.player.activateShield();
        else if (behavior.kind === 'revive')   this.player.armRevive();
        else                                   this.buffManager.activate(itemId, behavior);
      }
      this.closeAll();
      return;
    }
    this.ghostLocked = false;
    this._lastPtrX = Number.NaN;
    this._lastPtrY = Number.NaN;
    this.setHotbarVisible(false);
    this.placingItemId = itemId;
    this.state = PlacementState.Placing;
    this.player.setPlacementMode(true);
    this.statusLabel.setText('Drag to position · Tap to lock');
    this.setPlacementUIVisible(true);

    // Drag to position ghost (mobile: only while finger is down; desktop: always)
    this.scene.input.on('pointermove', this.onPointerMove, this);
    // Click on game canvas to lock/unlock ghost position
    this.scene.input.once('pointerdown', this.onPlacementClick, this);
    // ENTER key to confirm placement
    this.scene.input.keyboard!.once('keydown-ENTER', () => this.confirmPlacement());
  }

  private onPlacementClick = (ptr: Phaser.Input.Pointer): void => {
    if (this.state !== PlacementState.Placing) return;
    // Ignore clicks on the confirm/cancel buttons (screen-space overlap check).
    // Buttons are authored in logical coords; ptr.x/y is physical under the
    // DPRcap canvas, so compare in logical space.
    const dpr = getDprCap();
    const px = ptr.x / dpr, py = ptr.y / dpr;
    const bx = this.confirmBtn.x, by = this.confirmBtn.y, bw = 110 / 2, bh = 36 / 2;
    const cx = this.cancelBtn.x,  cy = this.cancelBtn.y;
    if ((Math.abs(px - bx) < bw && Math.abs(py - by) < bh) ||
        (Math.abs(px - cx) < bw && Math.abs(py - cy) < bh)) {
      // Re-listen for next click (the button handled this one)
      this.scene.input.once('pointerdown', this.onPlacementClick, this);
      return;
    }

    if (this.ghostLocked) {
      // Unlock — resume following cursor
      this.ghostLocked = false;
      this.confirmTxt.setText('PLACE  [↵]');
      this.statusLabel.setText('Drag to position · Tap to lock');
    } else {
      // Lock ghost at current snap position
      this.ghostLocked = true;
      this.confirmTxt.setText('PLACE ✓');
      this.statusLabel.setText('Position locked ✓');
    }
    // Re-listen for next click to allow toggling
    this.scene.input.once('pointerdown', this.onPlacementClick, this);
  };

  // ── Ghost / surface snapping ─────────────────────────────────────────────────

  private updateGhost(): void {
    // Ghost position is updated by onPointerMove; just redraw here.
    this.drawGhost();
  }

  private onPointerMove = (ptr: Phaser.Input.Pointer): void => {
    if (this.state !== PlacementState.Placing || this.ghostLocked) return;
    // Mobile: only update while the finger is actively touching the screen.
    // This means taps (including button presses) never snap the ghost — only drags do.
    // Desktop: always follow the cursor.
    if (InputManager.getInstance().isMobile && !ptr.isDown) return;

    // Skip expensive surface scan when pointer hasn't moved.
    if (ptr.x === this._lastPtrX && ptr.y === this._lastPtrY) return;
    this._lastPtrX = ptr.x;
    this._lastPtrY = ptr.y;

    // getWorldPoint accounts for the camera's DPRcap zoom; ptr.x/y + scroll would
    // be off by the zoom factor under the physical-resolution canvas.
    const cam    = this.scene.cameras.main;
    const world  = cam.getWorldPoint(ptr.x, ptr.y);
    const worldX = world.x;
    const worldY = world.y;

    if (this.placingItemId === 'ibeam') {
      const wallSnap = this.findWallSnap(worldX, worldY);
      if (wallSnap) {
        this.ghostValid  = true;
        this.ghostWorldX = wallSnap.x;
        this.ghostWorldY = wallSnap.y;
      } else {
        const snapY = this.findSurfaceY(worldX, worldY);
        this.ghostValid  = snapY !== null;
        this.ghostWorldX = worldX;
        this.ghostWorldY = snapY ?? worldY;
      }
    } else {
      const snapY = this.findSurfaceY(worldX, worldY);
      this.ghostValid  = snapY !== null;
      this.ghostWorldX = worldX;
      this.ghostWorldY = snapY ?? worldY;
    }
  };

  private findSurfaceY(worldX: number, worldY: number): number | null {
    let best: number | null = null;
    let bestDist = Infinity;
    for (const group of this.walkableGroups) {
      for (const obj of group.getChildren()) {
        const body = (obj as Phaser.GameObjects.Image).body as Phaser.Physics.Arcade.StaticBody;
        if (worldX >= body.left && worldX <= body.right) {
          const dist = worldY - body.top;
          if (dist >= -SNAP_RADIUS && dist < SNAP_RADIUS && dist < bestDist) {
            best = body.top;
            bestDist = dist;
          }
        }
      }
    }
    return best;
  }

  /** Find the nearest wall face for I-Beam placement. Returns center X/Y for the beam. */
  private findWallSnap(worldX: number, worldY: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bestDist = Infinity;
    for (const group of this.wallGroups) {
      for (const obj of group.getChildren()) {
        const body = (obj as Phaser.GameObjects.Image).body as Phaser.Physics.Arcade.StaticBody;
        if (worldY < body.top || worldY > body.bottom) continue;
        const distLeft  = Math.abs(worldX - body.left);
        const distRight = Math.abs(worldX - body.right);
        const dist = Math.min(distLeft, distRight);
        if (dist < SNAP_RADIUS && dist < bestDist) {
          bestDist = dist;
          const faceX   = distLeft < distRight ? body.left : body.right;
          const outward  = distLeft < distRight ? -1 : 1;
          best = { x: faceX + outward * IBEAM_WIDTH / 2, y: worldY };
        }
      }
    }
    return best;
  }

  private drawGhost(): void {
    const color = this.ghostValid ? 0x44ff88 : 0xff4444;
    for (const key in this.ghostRects) {
      const r = this.ghostRects[key];
      if (key === this.placingItemId) {
        r.setVisible(true);
        r.setFillStyle(color, 0.5);
        r.setStrokeStyle(2, color, 0.8);
        r.setPosition(this.ghostWorldX, this.ghostWorldY);
      } else if (r.visible) {
        r.setVisible(false);
      }
    }
  }

  // ── Confirm placement ────────────────────────────────────────────────────────

  private confirmPlacement(): void {
    if (!this.ghostValid) return;

    const save: PlacedItemSave = {
      id: this.placingItemId,
      x:  this.ghostWorldX,
      y:  this.ghostWorldY,
    };

    switch (this.placingItemId) {
      case 'ladder':
        if (!spendItem('ladder')) return;
        addPlaced(this._heapId, save);
        this.spawnLadderBody(save, getPlaced(this._heapId).length - 1);
        break;
      case 'ibeam':
        if (!spendItem('ibeam')) return;
        addPlaced(this._heapId, save);
        this.spawnIBeamBody(save, getPlaced(this._heapId).length - 1);
        break;
      case 'checkpoint': {
        if (!spendItem('checkpoint')) return;
        // Remove any existing checkpoint
        const existing = getPlaced(this._heapId);
        const cpIdx = existing.findIndex(p => p.id === 'checkpoint');
        if (cpIdx !== -1) {
          const body = this.spawnedBodies.find(b => b.saveIndex === cpIdx);
          if (body) { body.object.destroy(); }
          this.spawnedBodies = this.spawnedBodies.filter(b => b.saveIndex !== cpIdx);
          removePlaced(this._heapId, cpIdx);
          // Re-index remaining bodies
          this.spawnedBodies.forEach(b => { if (b.saveIndex > cpIdx) b.saveIndex--; });
        }
        save.meta = { spawnsLeft: 5, variant: Math.random() < 0.5 ? 1 : 2 };
        addPlaced(this._heapId, save);
        this.spawnCheckpointBody(save, getPlaced(this._heapId).length - 1);
        break;
      }
    }

    getLogger().event({ type: 'placement:made', heapId: this._heapId, itemType: this.placingItemId });
    this.closeAll();
  }

  // ── Physics body spawners ────────────────────────────────────────────────────

  private spawnLadderBody(save: PlacedItemSave, index: number): void {
    const ladderX = save.x;
    const ladderY = save.y - LADDER_HEIGHT / 2;

    const rect = this.scene.add.image(ladderX, ladderY, 'item-ladder')
      .setDisplaySize(LADDER_WIDTH, LADDER_HEIGHT)
      .setDepth(8);
    this.scene.physics.add.existing(rect, true);

    const overlap = this.scene.physics.add.overlap(
      this.player.sprite,
      rect,
      () => {
        this.ladderOverlapThisFrame = true;
        this.player.enterLadder();
      },
    );

    this.ladderOverlaps.push(overlap);
    this.spawnedBodies.push({ saveIndex: index, object: rect, itemId: 'ladder' });
  }

  private spawnIBeamBody(save: PlacedItemSave, index: number): void {
    const beamX = save.x;
    const beamY = save.y - IBEAM_HEIGHT / 2;

    const rect = this.scene.add.image(beamX, beamY, 'item-ibeam')
      .setDisplaySize(IBEAM_WIDTH, IBEAM_HEIGHT)
      .setDepth(8);
    this.scene.physics.add.existing(rect, true);
    const body = rect.body as Phaser.Physics.Arcade.StaticBody;
    body.checkCollision.down = false;  // one-way: no collision from above
    body.checkCollision.left  = false;
    body.checkCollision.right = false;

    const collider = this.scene.physics.add.collider(this.player.sprite, rect);
    this.ibeamColliders.push(collider);
    this.spawnedBodies.push({ saveIndex: index, object: rect, itemId: 'ibeam' });
  }

  private spawnCheckpointBody(save: PlacedItemSave, index: number): void {
    const variant = save.meta?.variant ?? (Math.random() < 0.5 ? 1 : 2);
    const rect = this.scene.add.image(save.x, save.y - 16, `item-checkpoint-${variant}`)
      .setDisplaySize(32, 32)
      .setDepth(8);
    this.scene.physics.add.existing(rect, true);
    this.checkpointGroup.add(rect);
    this.spawnedBodies.push({ saveIndex: index, object: rect, itemId: 'checkpoint' });
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private hotbarMaxVisibleCount(): number {
    return computeHotbarLayout({
      gameWidth: logicalWidth(this.scene), gameHeight: logicalHeight(this.scene),
      ownedCount: this.hotbarOwnedIds.length, scrollOffset: this.hotbarScrollOffset,
    }).visibleCount;
  }

  private refreshHotbar(): void {
    const GAME_WIDTH  = logicalWidth(this.scene);
    const GAME_HEIGHT = logicalHeight(this.scene);

    // Only show items the player owns (qty > 0), respecting checkpoint exclusion.
    this.hotbarOwnedIds = ITEM_DEFS
      .filter(def => !(this._excludeCheckpoint && def.id === 'checkpoint'))
      .filter(def => getItemQuantity(def.id) > 0)
      .map(def => def.id);

    const L = computeHotbarLayout({
      gameWidth: GAME_WIDTH, gameHeight: GAME_HEIGHT,
      ownedCount: this.hotbarOwnedIds.length, scrollOffset: this.hotbarScrollOffset,
    });
    this.hotbarScrollOffset = L.scrollOffset;

    // Hide all per-item objects first.
    ITEM_DEFS.forEach((_, i) => {
      this.hotbarItems[i]?.setVisible(false);
      this.hotbarLabels[i]?.setVisible(false);
      this.hotbarQtys[i]?.setVisible(false);
    });

    // ── Draw chrome ────────────────────────────────────────────────────────────
    const g = this.hotbarGfx;
    g.clear();
    g.setVisible(true);

    const panelX = L.panelCx - L.panelW / 2;
    const panelY = L.panelCy - L.panelH / 2;

    // Panel
    g.fillStyle(HUD_THEME.panelFill, 0.55);
    g.fillRoundedRect(panelX, panelY, L.panelW, L.panelH, HOTBAR.cornerRadius);
    g.lineStyle(1, HUD_THEME.border, 0.18);
    g.strokeRoundedRect(panelX, panelY, L.panelW, L.panelH, HOTBAR.cornerRadius);
    // Header divider
    const divY = panelY + HOTBAR.headerH;
    g.lineStyle(1, HUD_THEME.border, 0.12);
    g.lineBetween(panelX + 8, divY, panelX + L.panelW - 8, divY);

    this.hotbarTitle.setPosition(L.panelCx, L.headerCy).setVisible(true);

    // Slots
    const visibleIds = this.hotbarOwnedIds.slice(L.scrollOffset, L.scrollOffset + L.visibleCount);
    visibleIds.forEach((itemId, vi) => {
      const defIdx = ITEM_DEFS.findIndex(d => d.id === itemId);
      if (defIdx < 0) return;
      const cx = L.slotCxs[vi];
      const sx = cx - HOTBAR.slotW / 2;
      const sy = L.slotCy - HOTBAR.slotH / 2;
      const qty = getItemQuantity(itemId);

      // slot body
      g.fillStyle(0xffffff, 0.06);
      g.fillRoundedRect(sx, sy, HOTBAR.slotW, HOTBAR.slotH, HOTBAR.slotRadius);
      g.lineStyle(1, 0xffffff, 0.14);
      g.strokeRoundedRect(sx, sy, HOTBAR.slotW, HOTBAR.slotH, HOTBAR.slotRadius);
      // accent stripe — inset flat bar across the slot's straight top edge. A
      // rounded stripe can't be used: stripeH (6) < slotRadius (9), and Phaser's
      // fillRoundedRect doesn't clamp the radius, so it would render a lens shape;
      // matching the slot radius is impossible on a bar this thin. Insetting by
      // slotRadius keeps the bar within the rounded corners with no protrusion.
      g.fillStyle(ACCENT_COLORS[itemId as keyof typeof ACCENT_COLORS] ?? 0x888888, 1);
      g.fillRect(sx + HOTBAR.slotRadius, sy, HOTBAR.slotW - 2 * HOTBAR.slotRadius, HOTBAR.stripeH);

      // hit area + name
      this.hotbarItems[defIdx]?.setPosition(cx, L.slotCy).setVisible(true);
      this.hotbarLabels[defIdx]?.setPosition(cx, L.slotCy + 6).setVisible(true);

      // qty pill (top-right) — size to the text
      const qtyTxt = this.hotbarQtys[defIdx];
      if (qtyTxt) {
        qtyTxt.setText(`×${qty}`);
        const pillRight = sx + HOTBAR.slotW - 4;
        const pillTop   = sy + 4;
        const pillW = qtyTxt.width + 8;
        const pillH = qtyTxt.height + 2;
        g.fillStyle(0xffce8a, 1);
        g.fillRoundedRect(pillRight - pillW, pillTop, pillW, pillH, 6);
        qtyTxt.setPosition(pillRight - 4, pillTop + 1).setVisible(true);
      }
    });

    // Scroll buttons
    const drawBtn = (cx: number, show: boolean,
                     btn: Phaser.GameObjects.Rectangle, txt: Phaser.GameObjects.Text) => {
      btn.setPosition(cx, L.slotCy).setVisible(show);
      txt.setPosition(cx, L.slotCy).setVisible(show);
      if (!show) return;
      const bx = cx - HOTBAR.scrollBtnW / 2;
      const by = L.slotCy - HOTBAR.slotH / 2;
      g.fillStyle(0xffffff, 0.05);
      g.fillRoundedRect(bx, by, HOTBAR.scrollBtnW, HOTBAR.slotH, HOTBAR.slotRadius);
      g.lineStyle(1, 0xffffff, 0.14);
      g.strokeRoundedRect(bx, by, HOTBAR.scrollBtnW, HOTBAR.slotH, HOTBAR.slotRadius);
    };
    drawBtn(L.leftBtnCx,  L.showLeft,  this.scrollLeftBtn,  this.scrollLeftTxt);
    drawBtn(L.rightBtnCx, L.showRight, this.scrollRightBtn, this.scrollRightTxt);
  }

  private setHotbarVisible(visible: boolean): void {
    if (!visible) {
      this.hotbarGfx?.clear();
      this.hotbarGfx?.setVisible(false);
      this.hotbarTitle?.setVisible(false);
      this.hotbarItems.forEach(o => o.setVisible(false));
      this.hotbarLabels.forEach(o => o.setVisible(false));
      this.hotbarQtys.forEach(o => o.setVisible(false));
      this.scrollLeftBtn?.setVisible(false);
      this.scrollLeftTxt?.setVisible(false);
      this.scrollRightBtn?.setVisible(false);
      this.scrollRightTxt?.setVisible(false);
    }
    // visible=true is handled by refreshHotbar()
  }

  private setPlacementUIVisible(visible: boolean): void {
    this.confirmBtn.setVisible(visible);
    this.confirmTxt.setVisible(visible);
    this.cancelBtn.setVisible(visible);
    this.cancelTxt.setVisible(visible);
    this.statusLabel.setVisible(visible);
    if (!visible) this.hideGhost();
  }
}
