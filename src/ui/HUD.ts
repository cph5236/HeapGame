import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import type { PlaceableManager } from '../systems/PlaceableManager';

const HUD_Y    = GAME_HEIGHT - 44;
const MARGIN_R = 20;   // gap from right screen edge
const ICON_GAP = 14;   // gap between icon groups
const DASH_W   = 80;
const DASH_H   = 28;
const ICON_BG_R = 30;  // radius of radial-gradient icon backgrounds

/** Draw a dark-grey → transparent radial gradient circle for HUD icon backgrounds. */
function addRadialBg(scene: Phaser.Scene, cx: number, cy: number): void {
  const g = scene.add.graphics().setScrollFactor(0).setDepth(19);
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    // i=0: outermost, most transparent; i=steps-1: innermost, most opaque
    const t      = i / (steps - 1);
    const radius = ICON_BG_R * (1 - t * 0.88) + 1;
    g.fillStyle(0x111111, t * 0.65);
    g.fillCircle(cx, cy, radius);
  }
}

export class HUD {
  private readonly player: Player;
  private readonly dashBar:   Phaser.GameObjects.Graphics;
  private readonly dashLabel: Phaser.GameObjects.Text;
  private readonly cloudIcons:    Phaser.GameObjects.Image[] = [];
  private readonly wallJumpIcons: Phaser.GameObjects.Image[] = [];
  private          dashLeft:      number = 0;

  constructor(scene: Phaser.Scene, player: Player, placeableManager?: PlaceableManager) {
    this.player = player;

    // Build positions right-to-left so the layout adapts to which abilities are unlocked
    let cursorX = GAME_WIDTH - MARGIN_R; // start from right edge

    // ── Dash bar (rightmost) ────────────────────────────────────────────────
    if (player.hasDash) {
      const dashLeft = cursorX - DASH_W;
      const dashCX   = dashLeft + DASH_W / 2;

      scene.add.rectangle(dashCX, HUD_Y, DASH_W, DASH_H, 0x000000, 0.55)
        .setScrollFactor(0).setDepth(19);

      this.dashBar = scene.add.graphics().setScrollFactor(0).setDepth(20);

      this.dashLabel = scene.add.text(dashCX, HUD_Y, 'DASH', {
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

      this.dashLeft = dashLeft;
      cursorX = dashLeft - ICON_GAP;
    } else {
      this.dashBar   = scene.add.graphics();
      this.dashLabel = scene.add.text(0, 0, '').setVisible(false);
    }

    // ── Wall jump icon (1 charge, right of clouds) ──────────────────────────
    if (player.hasWallJump) {
      const iconCX = cursorX - ICON_BG_R;
      addRadialBg(scene, iconCX, HUD_Y);
      const icon = scene.add.image(iconCX, HUD_Y, 'wall-jump')
        .setScrollFactor(0).setDepth(20);
      this.wallJumpIcons.push(icon);
      cursorX = iconCX - ICON_BG_R - ICON_GAP;
    }

    // ── Air jump clouds ─────────────────────────────────────────────────────
    // Lay out clouds right-to-left so the rightmost dims first
    const cloudSpacing = ICON_BG_R * 2 + 6;
    for (let i = player.maxAirJumpsCount - 1; i >= 0; i--) {
      const cx = cursorX - ICON_BG_R;
      addRadialBg(scene, cx, HUD_Y);
      const icon = scene.add.image(cx, HUD_Y, 'cloud')
        .setScrollFactor(0).setDepth(20).setScale(1.1);
      this.cloudIcons[i] = icon;
      cursorX -= cloudSpacing;
    }

    // ── Hotbar bag icon (bottom-left) ──────────────────────────────────────────
    if (placeableManager) {
      const bagX = 36;
      const bagY = GAME_HEIGHT - 44;

      addRadialBg(scene, bagX, bagY);

      scene.add.text(bagX, bagY, '\uD83C\uDF92', {
        fontSize: '26px',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

      const bagHit = scene.add.zone(bagX, bagY, 52, 52)
        .setScrollFactor(0).setDepth(22)
        .setInteractive({ useHandCursor: true });

      bagHit.on('pointerup', () => placeableManager.openHotbar());
    }
  }

  update(): void {
    // Dash fill
    if (this.player.hasDash) {
      const fraction = this.player.dashCooldownFraction;
      const dashLeft = this.dashLeft;
      const fillW    = Math.round((1 - fraction) * DASH_W);
      const ready    = fraction === 0;

      this.dashBar.clear();
      this.dashBar.fillStyle(ready ? 0x44aaff : 0x225588, 1);
      if (fillW > 0) {
        this.dashBar.fillRect(dashLeft, HUD_Y - DASH_H / 2, fillW, DASH_H);
      }
      this.dashLabel.setColor(ready ? '#ffffff' : '#aaccee');
    }

    // Air jump clouds — rightmost dims first as jumps are used
    const jumpsLeft = this.player.airJumpsLeft;
    for (let i = 0; i < this.cloudIcons.length; i++) {
      this.cloudIcons[i]?.setAlpha(i < jumpsLeft ? 1.0 : 0.25);
    }

    // Wall jump icon
    if (this.wallJumpIcons.length > 0) {
      this.wallJumpIcons[0].setAlpha(this.player.wallJumpsLeft > 0 ? 1.0 : 0.25);
    }
  }
}
