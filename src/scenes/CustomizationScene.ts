import Phaser from 'phaser';
import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { COSMETIC_SLOTS, type CosmeticSlot } from '../../shared/cosmeticCatalog';
import { type CosmeticDef } from '../data/cosmeticDefs';
import { getAvailableCosmeticDefs } from '../data/cosmeticArt';
import {
  getBalance, isCosmeticOwned, purchaseCosmetic,
  getEquippedCosmetics, equipCosmetic,
  getHatAdjustment, getHatAdjustments, setHatAdjustment,
} from '../systems/SaveData';
import {
  HAT_ANGLE_LIMIT, HAT_SCALE_MIN, HAT_SCALE_MAX,
} from '../systems/cosmeticsLogic';
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
const GRID_COLS_MAX = 4;    // column count on screens wide enough to fit it
const CELL          = 96;   // cell pitch
const CELL_SIZE     = 84;   // visible cell square
/** Minimum breathing room kept clear on each side of the tab row / item grid,
 *  so neither ever renders partly off-screen on narrower phones. */
const H_MARGIN      = 8;

export class CustomizationScene extends Phaser.Scene {
  private activeSlot: CosmeticSlot = 'hat';
  private balanceText!: Phaser.GameObjects.Text;
  private preview: Phaser.GameObjects.Container | null = null;
  private tabObjects:  Phaser.GameObjects.GameObject[] = [];
  private gridObjects: Phaser.GameObjects.GameObject[] = [];
  private confirmObjects: Phaser.GameObjects.GameObject[] = [];

  // Scrollable grid: cells live in a masked container; dragging/wheel moves
  // its y between gridScrollMin (content bottom visible) and 0.
  private gridContainer!: Phaser.GameObjects.Container;
  private gridScrollMin = 0;
  private gridDragging = false;
  private gridDragMoved = 0;
  private lastPointerY = 0;

  constructor() { super({ key: 'CustomizationScene' }); }

  create(): void {
    setupUiCamera(this);
    this.activeSlot = 'hat';

    this.createBackground();

    // Header: back button, title with drop shadow, coin chip top-right.
    const backHit = this.add.rectangle(30, 50, 52, 52, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(11);
    this.add.text(30, 50, '←', {
      fontSize: '48px', color: '#ff9922', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setDepth(11);
    backHit.on('pointerup', () => this.scene.start('MenuScene'));

    this.add.text(logicalWidth(this) / 2 + 3, 53, 'TRASH STASH', {
      fontSize: '38px', fontStyle: 'bold', color: '#000000',
      stroke: '#000000', strokeThickness: 6,
    }).setOrigin(0.5).setAlpha(0.55).setDepth(9);
    this.add.text(logicalWidth(this) / 2, 50, 'TRASH STASH', {
      fontSize: '38px', fontStyle: 'bold', color: '#ff9922',
      stroke: '#1a0800', strokeThickness: 6,
    }).setOrigin(0.5).setDepth(10);

    this.createCoinChip();

    // Preview stage: soft spotlight glow + pedestal.
    const px = logicalWidth(this) / 2;
    const glow = this.add.graphics().setDepth(3);
    glow.fillStyle(0xff9922, 0.05);
    glow.fillEllipse(px, PREVIEW_Y + 10, 320, 300);
    glow.fillStyle(0xff9922, 0.05);
    glow.fillEllipse(px, PREVIEW_Y + 20, 220, 210);
    glow.fillStyle(0xffffff, 0.04);
    glow.fillEllipse(px, PREVIEW_Y + 30, 130, 130);

    const ped = this.add.graphics().setDepth(4);
    ped.fillStyle(0x151530, 1);
    ped.fillEllipse(px, PREVIEW_Y + 78, 190, 38);
    ped.fillStyle(0x000000, 0.35);
    ped.fillEllipse(px, PREVIEW_Y + 74, 130, 20);
    ped.lineStyle(1.5, 0xff9922, 0.35);
    ped.strokeEllipse(px, PREVIEW_Y + 78, 190, 38);

    // Tap-to-hop zone over the preview
    this.add.zone(px, PREVIEW_Y, 160, 180).setDepth(6)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.hopPreview());

    this.rebuildPreview();
    this.createTabs();
    this.createGridScroller();
    this.rebuildGrid();
    this.rebuildAdjustPanel();
    this.refreshBalance();

    this.input.keyboard?.on('keydown-ESC', () => this.scene.start('MenuScene'));
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => flushLoadoutSync());
  }

  // ── Background ─────────────────────────────────────────────────────────────

  private createBackground(): void {
    const w = logicalWidth(this), h = logicalHeight(this);
    // Night-sky gradient (menu palette), darkening toward the grid area.
    // Many thin lerped bands so no seams are visible.
    const top = { r: 0x14, g: 0x14, b: 0x33 };
    const bot = { r: 0x0a, g: 0x08, b: 0x18 };
    const steps = 28;
    const bg = this.add.graphics().setDepth(0);
    for (let i = 0; i < steps; i++) {
      const t = Math.min(1, (i / (steps - 1)) / 0.75); // fully dark by 75% height
      const r = Math.round(top.r + (bot.r - top.r) * t);
      const g = Math.round(top.g + (bot.g - top.g) * t);
      const b = Math.round(top.b + (bot.b - top.b) * t);
      bg.fillStyle((r << 16) | (g << 8) | b, 1);
      bg.fillRect(0, (h / steps) * i, w, h / steps + 1);
    }
    // Sparse star field over the upper half.
    const stars = this.add.graphics().setDepth(1);
    for (let i = 0; i < 26; i++) {
      const sx = ((i * 97) % 431) + 8;
      const sy = ((i * 61) % Math.round(h * 0.42)) + 10;
      stars.fillStyle(0xffffff, i % 3 === 0 ? 0.5 : 0.25);
      stars.fillCircle(sx, sy, i % 4 === 0 ? 1.6 : 1);
    }
  }

  private createCoinChip(): void {
    const right = logicalWidth(this) - 16;
    this.balanceText = this.add.text(right - 12, 96, '', {
      fontSize: '16px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
    }).setOrigin(1, 0.5).setDepth(11);
    // Chip chrome drawn behind the text once we know its width (refreshBalance
    // redraws it, since the number's width changes).
  }

  private coinChipBg: Phaser.GameObjects.Graphics | null = null;

  private redrawCoinChip(): void {
    this.coinChipBg?.destroy();
    const right = logicalWidth(this) - 16;
    const w = this.balanceText.width + 42;
    const g = this.add.graphics().setDepth(10);
    g.fillStyle(0x000000, 0.45);
    g.fillRoundedRect(right - w, 82, w, 28, 14);
    g.lineStyle(1, 0xffdd77, 0.35);
    g.strokeRoundedRect(right - w, 82, w, 28, 14);
    // Coin icon
    g.fillStyle(0xffcc44, 1);
    g.fillCircle(right - w + 16, 96, 7);
    g.fillStyle(0xb3830f, 1);
    g.fillCircle(right - w + 16, 96, 4.5);
    this.coinChipBg = g;
  }

  // ── Preview ────────────────────────────────────────────────────────────────

  private rebuildPreview(): void {
    this.preview?.destroy();
    this.preview = composeAvatar(this, getEquippedCosmetics(),
      { x: logicalWidth(this) / 2, y: PREVIEW_Y, scale: PREVIEW_SCALE }, getHatAdjustments());
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
    const tabH = 34, gap = 5;
    // Shrink tabs to fit narrower phones instead of overflowing off-screen —
    // 80px is the ideal width, but never wider than what actually fits.
    const available = logicalWidth(this) - H_MARGIN * 2;
    const tabW = Math.min(80, (available - (COSMETIC_SLOTS.length - 1) * gap) / COSMETIC_SLOTS.length);
    const totalW = COSMETIC_SLOTS.length * tabW + (COSMETIC_SLOTS.length - 1) * gap;
    const startX = logicalWidth(this) / 2 - totalW / 2 + tabW / 2;

    COSMETIC_SLOTS.forEach((slot, i) => {
      const active = slot === this.activeSlot;
      const x = startX + i * (tabW + gap);
      const g = this.add.graphics().setDepth(10);
      if (active) {
        g.fillStyle(0xff9922, 1);
        g.fillRoundedRect(x - tabW / 2, TABS_Y - tabH / 2, tabW, tabH, 9);
      } else {
        g.fillStyle(0x0a0c1a, 0.7);
        g.fillRoundedRect(x - tabW / 2, TABS_Y - tabH / 2, tabW, tabH, 9);
        g.lineStyle(1, 0xffffff, 0.14);
        g.strokeRoundedRect(x - tabW / 2, TABS_Y - tabH / 2, tabW, tabH, 9);
      }
      const txt = this.add.text(x, TABS_Y, SLOT_LABELS[slot], {
        fontSize: '15px', fontStyle: active ? 'bold' : 'normal',
        color: active ? '#1a0800' : '#c9c4dd',
      }).setOrigin(0.5).setDepth(11);
      const hit = this.add.rectangle(x, TABS_Y, tabW, tabH + 8, 0x000000, 0)
        .setInteractive({ useHandCursor: true }).setDepth(11);
      hit.on('pointerup', () => {
        this.activeSlot = slot;
        this.createTabs();
        this.rebuildGrid();
        this.rebuildAdjustPanel();
      });
      this.tabObjects.push(g, txt, hit);
    });
  }

  // ── Item grid ──────────────────────────────────────────────────────────────

  /** One-time setup: masked container + drag/wheel scrolling for the grid. */
  private createGridScroller(): void {
    this.gridContainer = this.add.container(0, 0).setDepth(8);

    const maskG = this.make.graphics({ x: 0, y: 0 });
    maskG.fillStyle(0xffffff, 1);
    maskG.fillRect(0, GRID_TOP - 10, logicalWidth(this), logicalHeight(this) - GRID_TOP + 10);
    this.gridContainer.setMask(maskG.createGeometryMask());

    const zoom = this.cameras.main.zoom;
    const clampScroll = (y: number): number =>
      Phaser.Math.Clamp(y, this.gridScrollMin, 0);

    this.input.on('wheel', (_p: unknown, _g: unknown, _dx: unknown, dy: number) => {
      this.gridContainer.y = clampScroll(this.gridContainer.y - (dy * 0.6) / zoom);
    });
    this.input.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
      if (ptr.y / zoom < TABS_Y + 24) return; // only drags starting over the grid
      this.gridDragging = true;
      this.gridDragMoved = 0;
      this.lastPointerY = ptr.y;
    });
    this.input.on('pointermove', (ptr: Phaser.Input.Pointer) => {
      if (!this.gridDragging || !ptr.isDown) return;
      const dy = (ptr.y - this.lastPointerY) / zoom;
      this.lastPointerY = ptr.y;
      this.gridDragMoved += Math.abs(dy);
      this.gridContainer.y = clampScroll(this.gridContainer.y + dy);
    });
    this.input.on('pointerup', () => { this.gridDragging = false; });
  }

  private rebuildGrid(): void {
    this.gridContainer.removeAll(true);
    this.gridObjects = [];
    this.gridContainer.y = 0;

    const defs = getAvailableCosmeticDefs().filter(d => d.slot === this.activeSlot);
    const equipped = getEquippedCosmetics()[this.activeSlot];
    // Drop a column on narrower phones instead of letting the grid overflow
    // off-screen — cards keep their normal size, there are just fewer per row.
    const cols  = Math.max(3, Math.min(GRID_COLS_MAX, Math.floor((logicalWidth(this) - H_MARGIN * 2) / CELL)));
    const gridW = cols * CELL;
    const left  = logicalWidth(this) / 2 - gridW / 2 + CELL / 2;

    // Tie and skin have a free default item that IS the baseline — no "None"
    // cell there. Hat/face/trail are genuinely removable, so cell 0 is None.
    const defaultId = this.activeSlot === 'tie' ? 'tie_red'
      : this.activeSlot === 'skin' ? 'skin_default' : null;
    const hasNoneCell = defaultId === null;

    if (hasNoneCell) {
      this.buildCell(left, GRID_TOP + CELL / 2, null, equipped === undefined);
    }

    defs.forEach((def, i) => {
      const idx = i + (hasNoneCell ? 1 : 0);
      const cx = left + (idx % cols) * CELL;
      const cy = GRID_TOP + CELL / 2 + Math.floor(idx / cols) * CELL;
      const isEquipped = equipped === def.id || (equipped === undefined && def.id === defaultId);
      this.buildCell(cx, cy, def, isEquipped);
    });

    // Everything buildCell created moves into the scroll container.
    this.gridContainer.add(this.gridObjects as Phaser.GameObjects.GameObject[]);

    const cellCount = defs.length + (hasNoneCell ? 1 : 0);
    const rows = Math.ceil(cellCount / cols);
    const contentBottom = GRID_TOP + rows * CELL + 8;
    this.gridScrollMin = Math.min(0, logicalHeight(this) - contentBottom);
  }

  private buildCell(cx: number, cy: number, def: CosmeticDef | null, isEquipped: boolean): void {
    const owned = def === null || isCosmeticOwned(def.id);
    const left = cx - CELL_SIZE / 2, top = cy - CELL_SIZE / 2;

    // Card chrome
    const card = this.add.graphics().setDepth(8);
    card.fillStyle(isEquipped ? 0x241200 : 0x0a0c1a, isEquipped ? 1 : 0.8);
    card.fillRoundedRect(left, top, CELL_SIZE, CELL_SIZE, 10);
    if (isEquipped) {
      card.lineStyle(2, 0xffaa33, 1);
    } else {
      card.lineStyle(1, 0xffffff, owned ? 0.16 : 0.08);
    }
    card.strokeRoundedRect(left, top, CELL_SIZE, CELL_SIZE, 10);
    this.gridObjects.push(card);

    // Cell contents: swatch / thumbnail / "none"
    if (def === null) {
      this.gridObjects.push(this.add.text(cx, cy - 8, '∅', {
        fontSize: '26px', color: '#667799',
      }).setOrigin(0.5).setDepth(9));
      this.gridObjects.push(this.add.text(cx, cy + 24, 'None', {
        fontSize: '11px', color: '#8899aa',
      }).setOrigin(0.5).setDepth(9));
    } else {
      const r = def.render;
      const artAlpha = owned ? 1 : 0.55;
      if (r.kind === 'tie' || r.kind === 'skin' || r.kind === 'trail') {
        let color = r.kind === 'tie' ? r.color : r.kind === 'skin' ? r.tint : r.tint;
        if (def.id === 'skin_default') color = 0x33323c; // show the bag's own dark tone
        const sw = this.add.graphics().setDepth(9).setAlpha(artAlpha);
        // Soft halo behind the swatch so bright colors sit into the card.
        sw.fillStyle(color, 0.18);
        sw.fillCircle(cx, cy - 10, 21);
        if (def.id === 'tie_rainbow') {
          // Six-segment color wheel instead of a flat swatch.
          const wheel = [0xff3344, 0xff9922, 0xffee33, 0x44dd55, 0x3388ff, 0xaa55ff];
          wheel.forEach((c, i) => {
            sw.fillStyle(c, 1);
            sw.slice(cx, cy - 10, 15, (i / 6) * Math.PI * 2, ((i + 1) / 6) * Math.PI * 2, false);
            sw.fillPath();
          });
        } else {
          sw.fillStyle(color, 1);
          sw.fillCircle(cx, cy - 10, 15);
        }
        sw.lineStyle(1.5, 0x000000, 0.45);
        sw.strokeCircle(cx, cy - 10, 15);
        // Specular dot, reads as a glossy token.
        sw.fillStyle(0xffffff, 0.5);
        sw.fillCircle(cx - 5, cy - 15, 3.5);
        this.gridObjects.push(sw);
      } else if (this.textures.exists(r.textureKey)) {
        const img = this.add.image(cx, cy - 10, r.textureKey).setDepth(9).setAlpha(artAlpha);
        const maxDim = Math.max(img.width, img.height);
        img.setScale(Math.min(1, 42 / maxDim));
        this.gridObjects.push(img);
      }
      this.gridObjects.push(this.add.text(cx, cy + 16, def.name, {
        fontSize: '10px', color: owned ? '#ffffff' : '#9a93b0',
      }).setOrigin(0.5).setDepth(9));

      if (isEquipped) {
        // Corner check badge
        const badge = this.add.graphics().setDepth(10);
        badge.fillStyle(0xffaa33, 1);
        badge.fillCircle(left + CELL_SIZE - 11, top + 11, 8);
        this.gridObjects.push(badge);
        this.gridObjects.push(this.add.text(left + CELL_SIZE - 11, top + 11, '✓', {
          fontSize: '11px', fontStyle: 'bold', color: '#1a0800',
        }).setOrigin(0.5).setDepth(11));
      }

      if (!owned) {
        // Price pill
        const affordable = getBalance() >= def.price;
        const label = this.add.text(cx + 6, cy + 31, `${def.price}`, {
          fontSize: '10px', fontStyle: 'bold',
          color: affordable ? '#1a0800' : '#7a7488',
        }).setOrigin(0.5).setDepth(11);
        const pillW = label.width + 26;
        const pill = this.add.graphics().setDepth(10);
        pill.fillStyle(affordable ? 0xffb033 : 0x1c1a2e, 1);
        pill.fillRoundedRect(cx - pillW / 2, cy + 23, pillW, 16, 8);
        if (!affordable) {
          pill.lineStyle(1, 0xffffff, 0.1);
          pill.strokeRoundedRect(cx - pillW / 2, cy + 23, pillW, 16, 8);
        }
        // tiny coin
        pill.fillStyle(affordable ? 0x7a4a00 : 0x565064, 1);
        pill.fillCircle(cx - pillW / 2 + 10, cy + 31, 4);
        label.setX(cx - pillW / 2 + 18 + label.width / 2);
        this.gridObjects.push(pill, label);
      }
    }

    const hit = this.add.rectangle(cx, cy, CELL_SIZE, CELL_SIZE, 0x000000, 0)
      .setInteractive({ useHandCursor: true }).setDepth(12);
    hit.on('pointerup', () => {
      // Swallow taps that were really drags, and taps on cells that have
      // scrolled up behind the preview/tabs (hit areas ignore the mask).
      if (this.gridDragMoved > 10) return;
      if (cy + this.gridContainer.y < GRID_TOP - 4) return;
      this.onCellTap(def, owned);
    });
    this.gridObjects.push(hit);
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
    this.rebuildAdjustPanel();
    scheduleLoadoutSync(this);
  }

  // ── Hat fit adjustment (rotate ±15°, scale ±20%) ───────────────────────────

  private adjustObjects: Phaser.GameObjects.GameObject[] = [];

  private rebuildAdjustPanel(): void {
    this.adjustObjects.forEach(o => o.destroy());
    this.adjustObjects = [];

    const hatId = getEquippedCosmetics().hat;
    if (this.activeSlot !== 'hat' || !hatId) return;

    const cx = logicalWidth(this) - 36;
    const adj = getHatAdjustment(hatId);

    const mkButton = (y: number, glyph: string, onTap: () => void): void => {
      const g = this.add.graphics().setDepth(10);
      g.fillStyle(0x0a0c1a, 0.85);
      g.fillCircle(cx, y, 15);
      g.lineStyle(1, 0xffffff, 0.2);
      g.strokeCircle(cx, y, 15);
      const t = this.add.text(cx, y, glyph, {
        fontSize: '17px', color: '#ffcc66', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(11);
      const hit = this.add.rectangle(cx, y, 38, 34, 0x000000, 0)
        .setInteractive({ useHandCursor: true }).setDepth(12);
      hit.on('pointerup', onTap);
      this.adjustObjects.push(g, t, hit);
    };

    const apply = (dAngle: number, dScale: number): void => {
      setHatAdjustment(hatId, {
        dAngle: Phaser.Math.Clamp(dAngle, -HAT_ANGLE_LIMIT, HAT_ANGLE_LIMIT),
        dScale: Phaser.Math.Clamp(dScale, HAT_SCALE_MIN, HAT_SCALE_MAX),
      });
      this.rebuildPreview();
      this.rebuildAdjustPanel();
    };

    mkButton(130, '⟲', () => apply(getHatAdjustment(hatId).dAngle - 2.5, getHatAdjustment(hatId).dScale));
    mkButton(164, '⟳', () => apply(getHatAdjustment(hatId).dAngle + 2.5, getHatAdjustment(hatId).dScale));
    mkButton(198, '+', () => apply(getHatAdjustment(hatId).dAngle, getHatAdjustment(hatId).dScale + 0.05));
    mkButton(232, '−', () => apply(getHatAdjustment(hatId).dAngle, getHatAdjustment(hatId).dScale - 0.05));

    // Readout + reset pill
    const changed = adj.dAngle !== 0 || adj.dScale !== 1;
    const readout = this.add.text(cx, 254,
      `${adj.dAngle > 0 ? '+' : ''}${adj.dAngle}°\n${Math.round(adj.dScale * 100)}%`, {
        fontSize: '11px', color: changed ? '#ffcc66' : '#77738c', align: 'center',
      }).setOrigin(0.5, 0).setDepth(11);
    this.adjustObjects.push(readout);

    if (changed) {
      const rg = this.add.graphics().setDepth(10);
      rg.fillStyle(0x2a1200, 1);
      rg.fillRoundedRect(cx - 26, 288, 52, 20, 10);
      rg.lineStyle(1, 0xff9922, 0.7);
      rg.strokeRoundedRect(cx - 26, 288, 52, 20, 10);
      const rt = this.add.text(cx, 298, 'RESET', {
        fontSize: '10px', color: '#ff9922', fontStyle: 'bold',
      }).setOrigin(0.5).setDepth(11);
      const rh = this.add.rectangle(cx, 298, 56, 24, 0x000000, 0)
        .setInteractive({ useHandCursor: true }).setDepth(12);
      rh.on('pointerup', () => {
        setHatAdjustment(hatId, null);
        this.rebuildPreview();
        this.rebuildAdjustPanel();
      });
      this.adjustObjects.push(rg, rt, rh);
    }
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
    this.balanceText.setText(`${getBalance()}`);
    this.redrawCoinChip();
  }
}
