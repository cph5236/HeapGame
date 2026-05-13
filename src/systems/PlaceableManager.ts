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
import { Player } from '../entities/Player';
import { getLogger } from '../logging';
import { InputManager } from './InputManager';

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

  private hotbarBg!:      Phaser.GameObjects.Rectangle;
  private hotbarItems:    Phaser.GameObjects.Rectangle[] = [];
  private hotbarLabels:   Phaser.GameObjects.Text[] = [];
  private hotbarQtys:     Phaser.GameObjects.Text[] = [];

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
    resnapOnLoad?:      boolean,
    excludeCheckpoint?: boolean,
  ) {
    this.scene               = scene;
    this.player              = player;
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
    this.refreshHotbar();
    this.setHotbarVisible(true);
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
    const GAME_WIDTH  = scene.scale.width;
    const GAME_HEIGHT = scene.scale.height;

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

    // Hotbar background panel (screen-space)
    this.hotbarBg = scene.add.rectangle(
      GAME_WIDTH / 2, GAME_HEIGHT - 130, GAME_WIDTH - 20, 100, 0x0a0818, 0.94,
    ).setScrollFactor(0).setDepth(25).setStrokeStyle(1, 0x2a2240).setVisible(false);

    // Build item slots for each ITEM_DEF
    const slotW  = 80;
    const slotH  = 70;
    const totalW = ITEM_DEFS.length * (slotW + 8) - 8;
    const startX = GAME_WIDTH / 2 - totalW / 2 + slotW / 2;
    const slotY  = GAME_HEIGHT - 130;

    ITEM_DEFS.forEach((def, i) => {
      const sx = startX + i * (slotW + 8);

      const slot = scene.add.rectangle(sx, slotY, slotW, slotH, 0x1a0820)
        .setScrollFactor(0).setDepth(26)
        .setStrokeStyle(1, 0x4455aa).setVisible(false)
        .setInteractive({ useHandCursor: true });

      const label = scene.add.text(sx, slotY - 14, def.name, {
        fontSize: '11px', color: '#ffffff', stroke: '#000000', strokeThickness: 1,
        align: 'center', wordWrap: { width: slotW - 4 },
      }).setOrigin(0.5).setScrollFactor(0).setDepth(27).setVisible(false);

      const qty = scene.add.text(sx, slotY + 18, 'x0', {
        fontSize: '14px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(27).setVisible(false);

      slot.on('pointerup', () => this.selectItem(def.id));

      this.hotbarItems.push(slot);
      this.hotbarLabels.push(label);
      this.hotbarQtys.push(qty);
    });

    if (this._excludeCheckpoint) {
      const cpIdx = ITEM_DEFS.findIndex(d => d.id === 'checkpoint');
      if (cpIdx >= 0) {
        this.hotbarItems[cpIdx]?.setVisible(false).disableInteractive();
        this.hotbarLabels[cpIdx]?.setVisible(false);
        this.hotbarQtys[cpIdx]?.setVisible(false);
      }
    }

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
    if (itemId === 'shield') {
      this.activateShield();
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
    // Ignore clicks on the confirm/cancel buttons (screen-space overlap check)
    const bx = this.confirmBtn.x, by = this.confirmBtn.y, bw = 110 / 2, bh = 36 / 2;
    const cx = this.cancelBtn.x,  cy = this.cancelBtn.y;
    if ((Math.abs(ptr.x - bx) < bw && Math.abs(ptr.y - by) < bh) ||
        (Math.abs(ptr.x - cx) < bw && Math.abs(ptr.y - cy) < bh)) {
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

  private activateShield(): void {
    if (!spendItem('shield')) return;
    this.player.activateShield();
  }

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

    const cam    = this.scene.cameras.main;
    const worldX = ptr.x + cam.scrollX;
    const worldY = ptr.y + cam.scrollY;

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

  private refreshHotbar(): void {
    ITEM_DEFS.forEach((def, i) => {
      const qty = getItemQuantity(def.id);
      this.hotbarQtys[i]?.setText(`x${qty}`);
      this.hotbarItems[i]?.setAlpha(qty > 0 ? 1 : 0.45);
    });
  }

  private setHotbarVisible(visible: boolean): void {
    this.hotbarBg.setVisible(visible);
    this.hotbarItems.forEach(o => o.setVisible(visible));
    this.hotbarLabels.forEach(o => o.setVisible(visible));
    this.hotbarQtys.forEach(o => o.setVisible(visible));
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
