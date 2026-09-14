// src/ui/AnnouncementModal.ts
//
// A reusable id-keyed, one-time informational modal: dimmed backdrop, panel
// with a title and a stack of body paragraphs ("beats"), and a single dismiss
// button. Seeded for the movement-rework announcement, but not specific to it
// — any future one-time announcement can reuse this with its own id/title/beats.
//
// Styling follows DailyDropOverlay.ts (the closest existing one-time overlay)
// and the HUD_THEME palette, rather than inventing a new look.

import Phaser from 'phaser';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { HUD_THEME } from './hudTheme';
import { markAnnouncementSeen } from '../systems/SaveData';

const DEPTH = 400; // above normal menu content (max ~20), below the coach-mark tour (500) —
                    // though the two are never shown together, this modal always wins the gate.

/**
 * Renders the modal and calls `markAnnouncementSeen(id)` the moment the
 * player dismisses it, so it never shows again for this id. The caller is
 * responsible for only constructing this when `!hasSeenAnnouncement(id)`.
 */
export class AnnouncementModal {
  constructor(
    scene: Phaser.Scene,
    id: string,
    title: string,
    beats: string[],
    onDismiss?: () => void,
  ) {
    const w = logicalWidth(scene);
    const h = logicalHeight(scene);
    const cx = w / 2;
    const root = scene.add.container(0, 0).setDepth(DEPTH);

    const backdrop = scene.add.rectangle(w / 2, h / 2, w, h, 0x04050c, 0.68)
      .setInteractive();
    root.add(backdrop);

    const panelW = Math.min(380, w - 32);
    const panelLeft = cx - panelW / 2;
    const bodyWrapWidth = panelW - 48;

    const titleText = scene.add.text(0, 0, title, {
      fontSize: '22px', color: HUD_THEME.textAccent, fontStyle: 'bold',
      stroke: '#000000', strokeThickness: 3, align: 'center', wordWrap: { width: bodyWrapWidth },
    }).setOrigin(0.5, 0);

    const bodyText = scene.add.text(0, 0, beats.join('\n\n'), {
      fontSize: '15px', color: HUD_THEME.textWhite, align: 'left',
      wordWrap: { width: bodyWrapWidth }, lineSpacing: 6,
    }).setOrigin(0.5, 0);

    const dismissBtn = scene.add.text(0, 0, 'GOT IT', {
      fontSize: '16px', color: '#1a0f00', fontStyle: 'bold',
      backgroundColor: '#ff9922', padding: { x: 22, y: 10 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });

    // Stack top-down (content height first, independent of final y), then
    // size the panel to fit and center the whole group vertically.
    const PAD_TOP = 24;
    const GAP = 18;
    const PAD_BOTTOM = 24;
    const contentH = titleText.height + GAP + bodyText.height + GAP + dismissBtn.height;
    const panelH = PAD_TOP + contentH + PAD_BOTTOM;
    const panelTop = Math.max(24, (h - panelH) / 2);

    titleText.setPosition(cx, panelTop + PAD_TOP);
    bodyText.setPosition(cx, titleText.y + titleText.height + GAP);
    dismissBtn.setPosition(cx, bodyText.y + bodyText.height + GAP + dismissBtn.height / 2);

    const panel = scene.add.graphics();
    panel.fillStyle(HUD_THEME.panelFill, 0.97);
    panel.fillRoundedRect(panelLeft, panelTop, panelW, panelH, 16);
    panel.lineStyle(2, HUD_THEME.accent, 0.9);
    panel.strokeRoundedRect(panelLeft, panelTop, panelW, panelH, 16);
    const panelZone = scene.add.zone(cx, panelTop + panelH / 2, panelW, panelH)
      .setInteractive();

    root.add([panel, panelZone, titleText, bodyText, dismissBtn]);

    const dismiss = (): void => {
      markAnnouncementSeen(id);
      root.destroy();
      onDismiss?.();
    };
    dismissBtn.on('pointerup', dismiss);
    // Backdrop tap also dismisses — matches DailyDropOverlay's tap-outside-to-close.
    backdrop.on('pointerup', dismiss);
  }
}
