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
    // Clamp to the viewport and shrink the body copy to fit, the same way
    // TutorialOverlay.layoutInfoPanel() does. Sizing purely from content means
    // a three-beat refund message runs off the bottom of a short (landscape)
    // screen, taking the dismiss button with it. Tapping the backdrop still
    // closes the modal, so it is never a trap — but the player would lose the
    // refund figure, which is the one number this modal exists to show.
    const MAX_PANEL_H = h - 48;
    const MIN_BODY_FONT_PX = 10;
    const chrome = PAD_TOP + titleText.height + GAP + GAP + dismissBtn.height + PAD_BOTTOM;
    let bodyFontPx = 15;
    while (chrome + bodyText.height > MAX_PANEL_H && bodyFontPx > MIN_BODY_FONT_PX) {
      bodyFontPx -= 1;
      bodyText.setFontSize(bodyFontPx);
    }
    const contentH = titleText.height + GAP + bodyText.height + GAP + dismissBtn.height;
    const panelH = Math.min(MAX_PANEL_H, PAD_TOP + contentH + PAD_BOTTOM);
    const panelTop = Math.max(24, (h - panelH) / 2);

    titleText.setPosition(cx, panelTop + PAD_TOP);
    bodyText.setPosition(cx, titleText.y + titleText.height + GAP);
    // The shrink loop above can still bottom out at MIN_BODY_FONT_PX with body
    // copy taller than the space left for it (a very short/narrow viewport with
    // the longest beats this modal shows) — without this clamp the button would
    // stack past the panel's bottom edge, or off the viewport entirely. The
    // backdrop tap still dismisses either way, but this keeps GOT IT reachable.
    const dismissY = bodyText.y + bodyText.height + GAP + dismissBtn.height / 2;
    const maxDismissY = Math.min(panelTop + panelH, h - 24) - PAD_BOTTOM - dismissBtn.height / 2;
    dismissBtn.setPosition(cx, Math.min(dismissY, maxDismissY));

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
