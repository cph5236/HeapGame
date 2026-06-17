import Phaser from 'phaser';
import { Player } from '../entities/Player';
import type { PlaceableManager } from '../systems/PlaceableManager';
import { logicalWidth } from '../systems/displayMetrics';
import { addToGameplayUi } from '../systems/GameplayUiCamera';
import { InputManager } from '../systems/InputManager';
import { AbilityTray } from './AbilityTray';
import { HUD_THEME as TH, makePanel } from './hudTheme';
import { HUD_INSET, HUD_NOTCH_DROP } from '../constants';

export interface HudOptions {
  placeableManager?: PlaceableManager;
  showDashIndicator: boolean;
  onPause: () => void;
}

export class HUD {
  private readonly tray: AbilityTray;
  private readonly scoreText: Phaser.GameObjects.Text;
  private readonly reviveBadge: Phaser.GameObjects.Text;
  private readonly player: Player;

  constructor(scene: Phaser.Scene, player: Player, opts: HudOptions) {
    this.player = player;
    const w = logicalWidth(scene);
    const parts: Phaser.GameObjects.GameObject[] = [];

    // ── Ability tray (top-left) ──────────────────────────────────────────────
    this.tray = new AbilityTray(scene, player, opts.showDashIndicator);
    parts.push(...this.tray.objects);

    // ── Score chip (top-center) ──────────────────────────────────────────────
    const chipY = HUD_INSET + 16;
    // Drop the centred score chip on mobile so it clears a front-camera notch.
    const scoreY = chipY + (InputManager.getInstance().isMobile ? HUD_NOTCH_DROP : 0);
    // Darker fill (0.66) than the default panel so the readout stays legible
    // against the bright sky at the top of a run.
    parts.push(makePanel(scene, w / 2, scoreY, 116, 30, 16, 0.66).setDepth(19));
    this.scoreText = scene.add.text(w / 2, scoreY, '0 ft', {
      fontSize: '14px', color: TH.textWhite, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20);
    parts.push(this.scoreText);

    // ── Pause button (top-right) ─────────────────────────────────────────────
    const pauseX = w - HUD_INSET - 19;
    parts.push(makePanel(scene, pauseX, chipY, 38, 38, 12).setDepth(19));
    parts.push(scene.add.text(pauseX, chipY, '☰', {
      fontSize: '18px', color: TH.textWhite, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20));
    const pauseHit = scene.add.zone(pauseX, chipY, 44, 44).setScrollFactor(0).setDepth(21)
      .setInteractive({ useHandCursor: true });
    pauseHit.on('pointerup', opts.onPause);
    parts.push(pauseHit);

    // ── Hotbar bag (top strip, left of pause) ── DECISION: moved off bottom-left
    if (opts.placeableManager) {
      const bagX = pauseX - 44;
      parts.push(makePanel(scene, bagX, chipY, 38, 38, 12).setDepth(19));
      parts.push(scene.add.text(bagX, chipY, '🎒', { fontSize: '20px' })
        .setOrigin(0.5).setScrollFactor(0).setDepth(20));
      const bagHit = scene.add.zone(bagX, chipY, 44, 44).setScrollFactor(0).setDepth(21)
        .setInteractive({ useHandCursor: true });
      const pm = opts.placeableManager;
      bagHit.on('pointerup', () => pm.openHotbar());
      parts.push(bagHit);
    }

    // ── Revive badge (below score, center) ───────────────────────────────────
    this.reviveBadge = scene.add.text(w / 2, scoreY + 26, '♥ REVIVE', {
      fontSize: '12px', color: '#ff6688', stroke: '#000000', strokeThickness: 3, fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(20).setVisible(false);
    parts.push(this.reviveBadge);

    addToGameplayUi(scene, parts);
  }

  /** Update the centered score/height readout. */
  setScore(text: string): void {
    this.scoreText.setText(text);
  }

  update(): void {
    this.tray.update();
    this.reviveBadge.setVisible(this.player.isReviveArmed);
  }
}
