import Phaser from 'phaser';
import { controlHelpLines } from './controlHelp';
import { getEffectiveControlMode } from '../systems/SaveData';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';

/** Handle for a controls overlay built by {@link buildControlsOverlay}. */
export interface ControlsOverlay {
  /** All display objects making up the overlay (dim bg, panel, text). */
  parts: Phaser.GameObjects.GameObject[];
  /** Show or hide the overlay. Re-reads the current control mode when shown. */
  setOpen: (open: boolean) => void;
  /** Re-layout against the current scale.width/height (call on resize). */
  relayout: () => void;
}

interface BuildOpts {
  isMobile: boolean;
  /** Base depth; bg/panel/text are placed at depth, depth+1, depth+2. */
  depth: number;
  /** Invoked when the dim background is tapped (usually closes the overlay). */
  onBackgroundTap: () => void;
}

const MARGIN  = 16; // min gap between panel and screen edge
const PAD_X    = 24; // text inset from panel sides
const PAD_Y    = 22; // text inset from panel top/bottom
const FONT_PX  = 17;
const LINE_GAP = 5;

/**
 * Build a responsive, content-sized CONTROLS overlay shared by MenuScene and the
 * in-game scenes. The panel sizes itself to the (mode-aware) help text plus
 * padding, then clamps to the viewport with a margin — so it never runs off the
 * edge of narrow (21:9) phones the way the old fixed 380×320 panel did. In
 * Phaser's RESIZE scale mode scale.width/height track the real device size, so
 * everything is positioned relative to those.
 */
export function buildControlsOverlay(scene: Phaser.Scene, opts: BuildOpts): ControlsOverlay {
  const { depth, onBackgroundTap } = opts;

  const overlayBg = scene.add.rectangle(0, 0, 10, 10, 0x000000, 0.72)
    .setScrollFactor(0).setDepth(depth).setVisible(false).setInteractive();
  overlayBg.on('pointerup', onBackgroundTap);

  const panel = scene.add.rectangle(0, 0, 10, 10, 0x0d0d20)
    .setScrollFactor(0).setDepth(depth + 1).setVisible(false)
    .setStrokeStyle(2, 0x4455aa);

  const text = scene.add.text(0, 0, '', {
    fontSize: `${FONT_PX}px`, color: '#ccccdd',
    stroke: '#000000', strokeThickness: 1,
    lineSpacing: LINE_GAP, align: 'left',
  }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2).setVisible(false);

  const relayout = (): void => {
    const vw = logicalWidth(scene);
    const vh = logicalHeight(scene);
    const cx = vw / 2;
    const cy = vh / 2;

    // Full-screen dim that always covers the viewport.
    overlayBg.setPosition(cx, cy).setSize(vw, vh);

    // Wrap the help text so the longest line fits a panel that respects the
    // screen margin, then size the panel to the wrapped text + padding.
    const maxTextW = vw - MARGIN * 2 - PAD_X * 2;
    text.setWordWrapWidth(maxTextW, true);

    const panelW = Math.min(text.width + PAD_X * 2, vw - MARGIN * 2);
    const panelH = Math.min(text.height + PAD_Y * 2, vh - MARGIN * 2);
    panel.setPosition(cx, cy).setSize(panelW, panelH);
    text.setPosition(cx, cy);
  };

  const setOpen = (open: boolean): void => {
    if (open) {
      text.setText(controlHelpLines(opts.isMobile, getEffectiveControlMode()).join('\n'));
      relayout();
    }
    overlayBg.setVisible(open);
    panel.setVisible(open);
    text.setVisible(open);
  };

  return { parts: [overlayBg, panel, text], setOpen, relayout };
}
