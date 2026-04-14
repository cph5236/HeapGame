import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT, LADDER_WIDTH, LADDER_HEIGHT, IBEAM_WIDTH, IBEAM_HEIGHT } from '../constants';

interface TextureEntry {
  key: string;
  w: number;
  h: number;
  label: string;
}

const ENTRIES: TextureEntry[] = [
  { key: 'enemy-percher',   w: 24,          h: 24,          label: 'enemy-percher\n24×24' },
  { key: 'enemy-ghost',     w: 36,          h: 36,          label: 'enemy-ghost\n36×36' },
  { key: 'item-checkpoint', w: 32,          h: 32,          label: 'item-checkpoint\n32×32' },
  { key: 'wall-jump',       w: 24,          h: 32,          label: 'wall-jump\n24×32' },
  { key: 'cloud',           w: 32,          h: 22,          label: 'cloud\n32×22' },
  { key: 'item-ibeam',      w: IBEAM_WIDTH, h: IBEAM_HEIGHT, label: `item-ibeam\n${IBEAM_WIDTH}×${IBEAM_HEIGHT}` },
  { key: 'item-ladder',     w: LADDER_WIDTH, h: LADDER_HEIGHT, label: `item-ladder\n${LADDER_WIDTH}×${LADDER_HEIGHT}` },
  { key: 'platform',        w: 200,         h: 64,          label: 'platform\n200×64' },
];

const COLS      = 2;
const CELL_W    = 210;
const CELL_H    = 150;
const CELL_GAP  = 12;
const MARGIN_X  = (GAME_WIDTH - COLS * CELL_W - (COLS - 1) * CELL_GAP) / 2;
const HEADER_H  = 64;
const PREVIEW_BOX = 96; // max px for texture display inside a cell

export class TexturePreviewScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TexturePreviewScene' });
  }

  create(): void {
    // Background
    this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x0c0c1a).setOrigin(0, 0);

    // Header
    this.add.text(GAME_WIDTH / 2, 22, 'TEXTURE PREVIEW', {
      fontSize: '20px', fontStyle: 'bold', color: '#99aabb',
    }).setOrigin(0.5);
    this.add.text(GAME_WIDTH / 2, 46, 'tap a sprite to zoom', {
      fontSize: '12px', color: '#445566',
    }).setOrigin(0.5);

    // Grid
    ENTRIES.forEach((entry, i) => {
      const col = i % COLS;
      const row = Math.floor(i / COLS);
      const cx = MARGIN_X + col * (CELL_W + CELL_GAP) + CELL_W / 2;
      const cy = HEADER_H + row * (CELL_H + CELL_GAP) + CELL_H / 2;
      this.createTile(cx, cy, entry);
    });

    // Footer
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 18, 'ESC or F2 — back to menu', {
      fontSize: '12px', color: '#334455',
    }).setOrigin(0.5);

    this.input.keyboard!.on('keydown-ESC', () => this.scene.start('MenuScene'));
    this.input.keyboard!.on('keydown-F2',  () => this.scene.start('MenuScene'));
  }

  private createTile(cx: number, cy: number, entry: TextureEntry): void {
    const bg = this.add.rectangle(cx, cy, CELL_W, CELL_H, 0x14141e)
      .setStrokeStyle(1, 0x222d44)
      .setInteractive({ useHandCursor: true });

    const scaleX = PREVIEW_BOX / entry.w;
    const scaleY = PREVIEW_BOX / entry.h;
    const scale  = Math.min(scaleX, scaleY, 6);   // cap upscale at 6×

    // Image sits in the upper ~60% of the cell
    const imgY = cy - 26;
    const img = this.add.image(cx, imgY, entry.key)
      .setScale(scale)
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    this.add.text(cx, cy + CELL_H / 2 - 28, entry.label, {
      fontSize: '11px', color: '#667788', align: 'center',
    }).setOrigin(0.5);

    const onTap = () => this.showZoom(entry);
    bg.on('pointerup', onTap);
    img.on('pointerup', onTap);

    // Hover highlight
    bg.on('pointerover', () => bg.setStrokeStyle(1, 0x4466aa));
    bg.on('pointerout',  () => bg.setStrokeStyle(1, 0x222d44));
  }

  private showZoom(entry: TextureEntry): void {
    const ZOOM_DEPTH = 20;

    const overlay = this.add.rectangle(0, 0, GAME_WIDTH, GAME_HEIGHT, 0x000000, 0.88)
      .setOrigin(0, 0)
      .setDepth(ZOOM_DEPTH)
      .setInteractive();

    // Scale to fill ~80% of whichever dimension is the constraint
    const maxW = GAME_WIDTH  * 0.82;
    const maxH = GAME_HEIGHT * 0.58;
    const scale = Math.min(maxW / entry.w, maxH / entry.h);

    const displayH = entry.h * scale;

    const img = this.add.image(GAME_WIDTH / 2, GAME_HEIGHT / 2 - 30, entry.key)
      .setScale(scale)
      .setOrigin(0.5)
      .setDepth(ZOOM_DEPTH + 1);

    const info = this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 + displayH / 2 + 18,
      `${entry.label}   ·   ${scale.toFixed(1)}× zoom`,
      { fontSize: '14px', color: '#99aabb', align: 'center' },
    ).setOrigin(0.5).setDepth(ZOOM_DEPTH + 1);

    const hint = this.add.text(
      GAME_WIDTH / 2,
      GAME_HEIGHT / 2 + displayH / 2 + 44,
      'tap to close',
      { fontSize: '11px', color: '#334455' },
    ).setOrigin(0.5).setDepth(ZOOM_DEPTH + 1);

    const close = () => [overlay, img, info, hint].forEach(o => o.destroy());
    overlay.on('pointerup', close);
  }
}
