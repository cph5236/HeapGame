import Phaser from 'phaser';
import { Player } from '../entities/Player';
import { HUD, makePanel } from './hudTheme';
import { airJumpPipStates, dashBarFillFraction } from './hudLogic';
import { HUD_DASH_BAR_W, HUD_DASH_BAR_H, HUD_INSET, HUD_TRAY_PAD } from '../constants';

export class AbilityTray {
  readonly objects: Phaser.GameObjects.GameObject[] = [];
  private readonly player: Player;
  private readonly pips: Phaser.GameObjects.Arc[] = [];
  private readonly wallIcon?: Phaser.GameObjects.Image;
  private readonly dashFill?: Phaser.GameObjects.Rectangle;
  private readonly showDash: boolean;

  constructor(scene: Phaser.Scene, player: Player, showDashIndicator: boolean) {
    this.player = player;
    this.showDash = showDashIndicator;

    // Tray geometry: a column anchored top-left under the inset.
    const left = HUD_INSET;
    const top  = HUD_INSET;
    const colW = 56;
    const max  = player.maxAirJumpsCount;
    const hasWall = player.hasWallJump;
    const rows = 1 + (hasWall ? 1 : 0) + (showDashIndicator ? 1 : 0);
    const rowH = 26;
    const panelH = HUD_TRAY_PAD * 2 + rows * rowH;
    const cx = left + colW / 2;

    this.objects.push(
      makePanel(scene, cx, top + panelH / 2, colW, panelH, 14).setDepth(19),
    );

    let rowY = top + HUD_TRAY_PAD + rowH / 2;

    // Air-jump: cloud glyph + pip row.
    this.objects.push(
      scene.add.image(cx, rowY - 4, 'cloud').setScrollFactor(0).setDepth(20).setScale(0.9),
    );
    const pipGap = 9;
    const startX = cx - ((max - 1) * pipGap) / 2;
    for (let i = 0; i < max; i++) {
      const pip = scene.add.circle(startX + i * pipGap, rowY + 8, 3, HUD.cloud)
        .setScrollFactor(0).setDepth(20);
      this.pips.push(pip);
      this.objects.push(pip);
    }
    rowY += rowH;

    // Wall-jump icon (single charge → lit/dim).
    if (hasWall) {
      this.wallIcon = scene.add.image(cx, rowY, 'wall-jump').setScrollFactor(0).setDepth(20);
      this.objects.push(this.wallIcon);
      rowY += rowH;
    }

    // Dash bar: » glyph + slim cooldown bar (only when no on-screen dash button).
    if (showDashIndicator && player.hasDash) {
      const barLeft = cx - HUD_DASH_BAR_W / 2 + 6;
      this.objects.push(
        scene.add.text(barLeft - 12, rowY, '»', {
          fontSize: '13px', color: '#9cf', fontStyle: 'bold',
        }).setOrigin(0.5).setScrollFactor(0).setDepth(20),
      );
      this.objects.push(
        scene.add.rectangle(barLeft, rowY, HUD_DASH_BAR_W, HUD_DASH_BAR_H, 0x000000, 0.45)
          .setOrigin(0, 0.5).setScrollFactor(0).setDepth(20).setStrokeStyle(1, HUD.border, HUD.borderAlpha),
      );
      this.dashFill = scene.add.rectangle(barLeft, rowY, HUD_DASH_BAR_W, HUD_DASH_BAR_H, HUD.dashGlow, 1)
        .setOrigin(0, 0.5).setScrollFactor(0).setDepth(21);
      this.objects.push(this.dashFill);
    }
  }

  update(): void {
    const states = airJumpPipStates(this.player.airJumpsLeft, this.pips.length);
    for (let i = 0; i < this.pips.length; i++) this.pips[i].setAlpha(states[i] ? 1 : 0.22);

    if (this.wallIcon) this.wallIcon.setAlpha(this.player.canWallJump ? 1 : 0.25);

    if (this.showDash && this.dashFill) {
      const f = dashBarFillFraction(this.player.dashCooldownFraction);
      this.dashFill.scaleX = f;
      this.dashFill.fillColor = f >= 1 ? HUD.dashGlow : HUD.dashDim;
    }
  }
}
