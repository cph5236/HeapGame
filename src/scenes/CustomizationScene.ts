import Phaser from 'phaser';
import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { COSMETIC_SLOTS, type CosmeticSlot } from '../../shared/cosmeticCatalog';
import { type CosmeticDef } from '../data/cosmeticDefs';
import { getAvailableCosmeticDefs } from '../data/cosmeticArt';
import {
  getBalance, isCosmeticOwned, purchaseCosmetic,
  getEquippedCosmetics, equipCosmetic,
} from '../systems/SaveData';
import { syncSaveToCloud } from '../systems/cloudSave';
import { scheduleLoadoutSync, flushLoadoutSync } from '../systems/cosmeticsSync';
import { composeAvatar } from '../ui/avatar';

const SLOT_LABELS: Record<CosmeticSlot, string> = {
  hat: 'Hat', face: 'Face', tie: 'Tie', skin: 'Skin', trail: 'Trail',
};

const PREVIEW_Y     = 190;
const PREVIEW_SCALE = 3;
const TABS_Y        = 330;
const GRID_TOP      = 372;
const GRID_COLS     = 4;
const CELL          = 96;   // cell pitch
const CELL_SIZE     = 84;   // visible cell square

export class CustomizationScene extends Phaser.Scene {
  private activeSlot: CosmeticSlot = 'hat';
  private balanceText!: Phaser.GameObjects.Text;
  private preview: Phaser.GameObjects.Container | null = null;
  private tabObjects:  Phaser.GameObjects.GameObject[] = [];
  private gridObjects: Phaser.GameObjects.GameObject[] = [];
  private confirmObjects: Phaser.GameObjects.GameObject[] = [];

  constructor() { super({ key: 'CustomizationScene' }); }

  create(): void {
    setupUiCamera(this);
    this.activeSlot = 'hat';

    this.add.rectangle(logicalWidth(this) / 2, logicalHeight(this) / 2,
      logicalWidth(this), logicalHeight(this), 0x0a0818).setDepth(0);

    // Header: back button, title, coin balance (StoreScene conventions)
    const backHit = this.add.rectangle(30, 50, 52, 52, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(11);
    this.add.text(30, 50, '←', {
      fontSize: '48px', color: '#ff9922', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);
    backHit.on('pointerup', () => this.scene.start('MenuScene'));

    this.add.text(logicalWidth(this) / 2, 50, 'WARDROBE', {
      fontSize: '38px', fontStyle: 'bold', color: '#ff9922',
      stroke: '#1a0800', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(10);

    this.balanceText = this.add.text(logicalWidth(this) / 2, 96, '', {
      fontSize: '18px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(10);

    // Preview pedestal
    const px = logicalWidth(this) / 2;
    const ped = this.add.graphics().setDepth(4);
    ped.fillStyle(0x1a1a2e, 1);
    ped.fillEllipse(px, PREVIEW_Y + 78, 170, 34);
    ped.lineStyle(1, 0x8899bb, 0.4);
    ped.strokeEllipse(px, PREVIEW_Y + 78, 170, 34);

    // Tap-to-hop zone over the preview
    this.add.zone(px, PREVIEW_Y, 160, 180).setDepth(6)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.hopPreview());

    this.rebuildPreview();
    this.createTabs();
    this.rebuildGrid();
    this.refreshBalance();

    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => flushLoadoutSync());
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  private rebuildPreview(): void {
    this.preview?.destroy();
    this.preview = composeAvatar(this, getEquippedCosmetics(),
      { x: logicalWidth(this) / 2, y: PREVIEW_Y, scale: PREVIEW_SCALE });
    this.preview.setDepth(5);
    // Idle breathing
    this.tweens.add({
      targets: this.preview, scaleX: 1.025, scaleY: 0.975,
      duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });
  }

  private hopPreview(): void {
    if (!this.preview) return;
    this.tweens.add({
      targets: this.preview, y: PREVIEW_Y - 34,
      duration: 220, yoyo: true, ease: 'Quad.Out',
    });
  }

  // ── Tabs ───────────────────────────────────────────────────────────────────

  private createTabs(): void {
    this.tabObjects.forEach(o => o.destroy());
    this.tabObjects = [];
    const tabW = 78, tabH = 30, gap = 6;
    const totalW = COSMETIC_SLOTS.length * tabW + (COSMETIC_SLOTS.length - 1) * gap;
    const startX = logicalWidth(this) / 2 - totalW / 2 + tabW / 2;

    COSMETIC_SLOTS.forEach((slot, i) => {
      const active = slot === this.activeSlot;
      const x = startX + i * (tabW + gap);
      const bg = this.add.rectangle(x, TABS_Y, tabW, tabH, active ? 0x3a1800 : 0x1a0800)
        .setStrokeStyle(active ? 2 : 1, active ? 0xffaa33 : 0xff9922)
        .setInteractive({ useHandCursor: true }).setDepth(10);
      const txt = this.add.text(x, TABS_Y, SLOT_LABELS[slot], {
        fontSize: '14px', color: active ? '#ffaa33' : '#ff9922',
        stroke: '#000000', strokeThickness: 1,
      }).setOrigin(0.5).setDepth(11);
      bg.on('pointerup', () => {
        this.activeSlot = slot;
        this.createTabs();
        this.rebuildGrid();
      });
      this.tabObjects.push(bg, txt);
    });
  }

  // ── Item grid ──────────────────────────────────────────────────────────────

  private rebuildGrid(): void {
    this.gridObjects.forEach(o => o.destroy());
    this.gridObjects = [];

    const defs = getAvailableCosmeticDefs().filter(d => d.slot === this.activeSlot);
    const equipped = getEquippedCosmetics()[this.activeSlot];
    const gridW = GRID_COLS * CELL;
    const left  = logicalWidth(this) / 2 - gridW / 2 + CELL / 2;

    // Cell 0: "none"/default
    this.buildCell(left, GRID_TOP + CELL / 2, null, equipped === undefined);

    defs.forEach((def, i) => {
      const idx = i + 1;
      const cx = left + (idx % GRID_COLS) * CELL;
      const cy = GRID_TOP + CELL / 2 + Math.floor(idx / GRID_COLS) * CELL;
      this.buildCell(cx, cy, def, equipped === def.id);
    });
  }

  private buildCell(cx: number, cy: number, def: CosmeticDef | null, isEquipped: boolean): void {
    const owned = def === null || isCosmeticOwned(def.id);
    const bg = this.add.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, isEquipped ? 0x1a0800 : 0x11101f)
      .setStrokeStyle(isEquipped ? 2 : 1, isEquipped ? 0xffaa33 : 0x2a2240)
      .setInteractive({ useHandCursor: true }).setDepth(8);
    this.gridObjects.push(bg);

    // Cell contents: swatch / thumbnail / "none"
    if (def === null) {
      this.gridObjects.push(this.add.text(cx, cy - 6, '∅', {
        fontSize: '26px', color: '#667799',
      }).setOrigin(0.5).setDepth(9));
      this.gridObjects.push(this.add.text(cx, cy + 26, 'None', {
        fontSize: '11px', color: '#8899aa',
      }).setOrigin(0.5).setDepth(9));
    } else {
      const r = def.render;
      if (r.kind === 'tie' || r.kind === 'skin' || r.kind === 'trail') {
        const color = r.kind === 'tie' ? r.color : r.kind === 'skin' ? r.tint : r.tint;
        const sw = this.add.graphics().setDepth(9);
        sw.fillStyle(color, 1);
        sw.fillCircle(cx, cy - 8, 16);
        sw.lineStyle(2, 0x000000, 0.5);
        sw.strokeCircle(cx, cy - 8, 16);
        this.gridObjects.push(sw);
      } else if (this.textures.exists(r.textureKey)) {
        const img = this.add.image(cx, cy - 8, r.textureKey).setDepth(9);
        const maxDim = Math.max(img.width, img.height);
        img.setScale(Math.min(1, 44 / maxDim));
        this.gridObjects.push(img);
      }
      this.gridObjects.push(this.add.text(cx, cy + 18, def.name, {
        fontSize: '10px', color: owned ? '#ffffff' : '#998877',
      }).setOrigin(0.5).setDepth(9));
      if (!owned) {
        this.gridObjects.push(this.add.text(cx, cy + 32, `${def.price}c`, {
          fontSize: '11px', color: getBalance() >= def.price ? '#ff9922' : '#664433',
          stroke: '#000000', strokeThickness: 1,
        }).setOrigin(0.5).setDepth(9));
        bg.setAlpha(0.8);
      }
    }

    bg.on('pointerup', () => this.onCellTap(def, owned));
  }

  private onCellTap(def: CosmeticDef | null, owned: boolean): void {
    if (def === null) {
      equipCosmetic(this.activeSlot, null);
      this.afterLoadoutChange();
      return;
    }
    if (owned) {
      equipCosmetic(this.activeSlot, def.id);
      this.afterLoadoutChange();
      return;
    }
    this.showConfirmPurchase(def);
  }

  private afterLoadoutChange(): void {
    this.rebuildPreview();
    this.rebuildGrid();
    scheduleLoadoutSync(this);
  }

  // ── Purchase confirm dialog ────────────────────────────────────────────────

  private showConfirmPurchase(def: CosmeticDef): void {
    this.closeConfirm();
    const cx = logicalWidth(this) / 2;
    const cy = logicalHeight(this) / 2;

    const overlay = this.add.rectangle(cx, cy, logicalWidth(this), logicalHeight(this), 0x000000, 0.7)
      .setDepth(30).setInteractive();
    const panel = this.add.rectangle(cx, cy, 320, 170, 0x0d0d20)
      .setDepth(31).setStrokeStyle(2, 0xff9922).setInteractive();
    const title = this.add.text(cx, cy - 52, `Buy ${def.name}?`, {
      fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5).setDepth(32);
    const price = this.add.text(cx, cy - 22, `${def.price} coins  (you have ${getBalance()})`, {
      fontSize: '14px', color: '#ffdd77',
    }).setOrigin(0.5).setDepth(32);

    const canAfford = getBalance() >= def.price;
    const buyBg = this.add.rectangle(cx - 70, cy + 38, 120, 40, canAfford ? 0x1a3a1a : 0x1a1a1a)
      .setStrokeStyle(1, canAfford ? 0x44ff88 : 0x444444).setDepth(32)
      .setInteractive({ useHandCursor: canAfford });
    const buyTxt = this.add.text(cx - 70, cy + 38, canAfford ? 'BUY' : 'TOO POOR', {
      fontSize: '15px', color: canAfford ? '#44ff88' : '#666666', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33);
    const cancelBg = this.add.rectangle(cx + 70, cy + 38, 120, 40, 0x2a1010)
      .setStrokeStyle(1, 0xff6666).setDepth(32).setInteractive({ useHandCursor: true });
    const cancelTxt = this.add.text(cx + 70, cy + 38, 'CANCEL', {
      fontSize: '15px', color: '#ff9999', fontStyle: 'bold',
    }).setOrigin(0.5).setDepth(33);

    this.confirmObjects = [overlay, panel, title, price, buyBg, buyTxt, cancelBg, cancelTxt];

    overlay.on('pointerup', () => this.closeConfirm());
    cancelBg.on('pointerup', () => this.closeConfirm());
    if (canAfford) {
      buyBg.on('pointerup', () => {
        if (purchaseCosmetic(def.id)) {
          syncSaveToCloud();
          equipCosmetic(def.slot, def.id);   // equip on purchase — instant gratification
          this.closeConfirm();
          this.refreshBalance();
          this.afterLoadoutChange();
        }
      });
    }
  }

  private closeConfirm(): void {
    this.confirmObjects.forEach(o => o.destroy());
    this.confirmObjects = [];
  }

  private refreshBalance(): void {
    this.balanceText.setText(`Balance: ${getBalance()} coins`);
  }
}
