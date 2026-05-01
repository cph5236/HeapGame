import Phaser from 'phaser';
import { Player } from '../entities/Player';
import type { PlaceableManager } from '../systems/PlaceableManager';
const MARGIN_R = 20;   // gap from right screen edge
const ICON_GAP = 14;   // gap between icon groups
const DASH_W   = 80;
const DASH_H   = 28;
const ICON_BG_R = 30;  // radius of radial-gradient icon backgrounds
const RADIAL_TEX_KEY = 'hud-radial-bg';
const RADIAL_TEX_SIZE = ICON_BG_R * 2 + 2; // a bit of padding for the +1 outer radius

/**
 * Bakes the radial-gradient circle once per game into a cached texture so HUD
 * icons can use a single textured quad instead of 14 live fillCircle ops/frame.
 */
function ensureRadialTexture(scene: Phaser.Scene): void {
  if (scene.textures.exists(RADIAL_TEX_KEY)) return;
  const g = scene.make.graphics({ x: 0, y: 0 }, false);
  const c = RADIAL_TEX_SIZE / 2;
  const steps = 14;
  for (let i = 0; i < steps; i++) {
    const t      = i / (steps - 1);
    const radius = ICON_BG_R * (1 - t * 0.88) + 1;
    g.fillStyle(0x111111, t * 0.65);
    g.fillCircle(c, c, radius);
  }
  g.generateTexture(RADIAL_TEX_KEY, RADIAL_TEX_SIZE, RADIAL_TEX_SIZE);
  g.destroy();
}

function addRadialBg(scene: Phaser.Scene, cx: number, cy: number): void {
  ensureRadialTexture(scene);
  scene.add.image(cx, cy, RADIAL_TEX_KEY).setScrollFactor(0).setDepth(19);
}

export class HUD {
  private readonly player: Player;
  private readonly dashFill:  Phaser.GameObjects.Rectangle;
  private readonly dashLabel: Phaser.GameObjects.Text;
  private readonly cloudIcons:    Phaser.GameObjects.Image[] = [];
  private readonly wallJumpIcons: Phaser.GameObjects.Image[] = [];
  private readonly hudY:          number;

  constructor(scene: Phaser.Scene, player: Player, placeableManager?: PlaceableManager) {
    this.hudY = scene.scale.height - 44;
    this.player = player;

    // Build positions right-to-left so the layout adapts to which abilities are unlocked
    let cursorX = scene.scale.width - MARGIN_R; // start from right edge

    // ── Dash bar (rightmost) ────────────────────────────────────────────────
    if (player.hasDash) {
      const dashLeft = cursorX - DASH_W;
      const dashCX   = dashLeft + DASH_W / 2;

      scene.add.rectangle(dashCX, this.hudY, DASH_W, DASH_H, 0x000000, 0.55)
        .setScrollFactor(0).setDepth(19);

      // Left-anchored fill: scaleX maps directly to fillW (no geometry rebuild).
      this.dashFill = scene.add.rectangle(dashLeft, this.hudY, DASH_W, DASH_H, 0x44aaff, 1)
        .setOrigin(0, 0.5)
        .setScrollFactor(0)
        .setDepth(20)
        .setVisible(false);

      this.dashLabel = scene.add.text(dashCX, this.hudY, 'DASH', {
        fontSize: '14px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        fontStyle: 'bold',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(21);

      cursorX = dashLeft - ICON_GAP;
    } else {
      this.dashFill  = scene.add.rectangle(0, 0, 1, 1, 0).setVisible(false);
      this.dashLabel = scene.add.text(0, 0, '').setVisible(false);
    }

    // ── Wall jump icon (1 charge, right of clouds) ──────────────────────────
    if (player.hasWallJump) {
      const iconCX = cursorX - ICON_BG_R;
      addRadialBg(scene, iconCX, this.hudY);
      const icon = scene.add.image(iconCX, this.hudY, 'wall-jump')
        .setScrollFactor(0).setDepth(20);
      this.wallJumpIcons.push(icon);
      cursorX = iconCX - ICON_BG_R - ICON_GAP;
    }

    // ── Air jump clouds ─────────────────────────────────────────────────────
    // Lay out clouds right-to-left so the rightmost dims first
    const cloudSpacing = ICON_BG_R * 2 + 6;
    for (let i = player.maxAirJumpsCount - 1; i >= 0; i--) {
      const cx = cursorX - ICON_BG_R;
      addRadialBg(scene, cx, this.hudY);
      const icon = scene.add.image(cx, this.hudY, 'cloud')
        .setScrollFactor(0).setDepth(20).setScale(1.1);
      this.cloudIcons[i] = icon;
      cursorX -= cloudSpacing;
    }

    // ── Hotbar bag icon (bottom-left) ──────────────────────────────────────────
    if (placeableManager) {
      const bagX = 36;
      const bagY = this.hudY;

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
      const fillW    = Math.round((1 - fraction) * DASH_W);
      const ready    = fraction === 0;

      if (fillW > 0) {
        this.dashFill.setVisible(true);
        this.dashFill.scaleX = fillW / DASH_W;
        this.dashFill.fillColor = ready ? 0x44aaff : 0x225588;
      } else {
        this.dashFill.setVisible(false);
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
