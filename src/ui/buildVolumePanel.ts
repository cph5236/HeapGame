import Phaser from 'phaser';
import { AudioManager } from '../systems/AudioManager';
import type { SoundCategory } from '../data/soundDefs';

/** Clamp a raw volume to the playable [0,1] range. */
export function clampVolume(v: number): number {
  return Math.max(0, Math.min(1, v));
}

/** Convert a pointer X over a slider track into a clamped [0,1] volume. */
export function volumeFromTrackX(pointerX: number, trackLeft: number, trackW: number): number {
  return clampVolume((pointerX - trackLeft) / trackW);
}

// ── Shared volume slider widget ────────────────────────────────────────────────────

const TRACK_W = 220;
const TRACK_H = 6;
const THUMB_R = 9;

/**
 * Build one labelled volume slider at (x, y). Moved verbatim out of MenuScene so
 * MenuScene's Sounds tab and PauseScene's Volume view share one widget. Returns the
 * display objects (created hidden) so the caller controls visibility.
 */
export function createVolumeSlider(
  scene: Phaser.Scene,
  x: number, y: number, labelText: string,
  cat: SoundCategory | 'master', initialValue: number, depth: number,
): Phaser.GameObjects.GameObject[] {
  const trackLeft = x - TRACK_W / 2;

  const label = scene.add.text(trackLeft, y - 14, labelText, {
    fontSize: '13px', color: '#aaaacc',
  }).setOrigin(0, 0.5).setDepth(depth);

  const track = scene.add.rectangle(x, y, TRACK_W, TRACK_H, 0x334466).setDepth(depth);

  const fill = scene.add.rectangle(
    trackLeft + (TRACK_W * initialValue) / 2, y, TRACK_W * initialValue, TRACK_H, 0x4466cc,
  ).setDepth(depth);

  const thumb = scene.add.circle(trackLeft + TRACK_W * initialValue, y, THUMB_R, 0x6688ff)
    .setDepth(depth + 1).setInteractive({ draggable: true, useHandCursor: true });

  const apply = (newValue: number) => {
    const clamped = clampVolume(newValue);
    const thumbX  = trackLeft + TRACK_W * clamped;
    thumb.setPosition(thumbX, y);
    fill.setPosition(trackLeft + (TRACK_W * clamped) / 2, y);
    fill.setSize(TRACK_W * clamped, TRACK_H);
    AudioManager.setCategoryVolume(cat, clamped);
  };

  scene.input.setDraggable(thumb);
  thumb.on('drag', (_ptr: Phaser.Input.Pointer, dragX: number) => {
    apply(volumeFromTrackX(dragX, trackLeft, TRACK_W));
  });

  track.setInteractive({
    hitArea: new Phaser.Geom.Rectangle(0, -(28 - TRACK_H) / 2, TRACK_W, 28),
    hitAreaCallback: Phaser.Geom.Rectangle.Contains,
    useHandCursor: true,
  });
  track.on('pointerdown', (ptr: Phaser.Input.Pointer) => {
    apply(volumeFromTrackX(ptr.x, trackLeft, TRACK_W));
  });

  [label, track, fill, thumb].forEach(o => o.setVisible(false));
  return [label, track, fill, thumb];
}

// ── Standalone volume panel ────────────────────────────────────────────────────────

export interface VolumePanel {
  parts: Phaser.GameObjects.GameObject[];
  setOpen: (open: boolean) => void;
  relayout: () => void;
}

const PANEL_W = 320;
const PANEL_H = 300;
const MARGIN  = 16;

/**
 * Standalone volume panel (dim bg + panel + title + 5 stacked sliders) for use as a
 * sub-view inside PauseScene. Sized PANEL_W x PANEL_H, clamped to the viewport so it
 * fits narrow 21:9 phones. Sliders read AudioManager.getVolumes() at build time.
 */
export function buildVolumePanel(
  scene: Phaser.Scene,
  opts: { depth: number; onBackgroundTap: () => void },
): VolumePanel {
  const { depth, onBackgroundTap } = opts;
  const vols = AudioManager.getVolumes();

  // Lay everything out at build time. The scene is created when the pause overlay
  // is launched, so scale.width/height are stable here. Sliders MUST be created at
  // their final position — createVolumeSlider captures its track coordinates for the
  // drag/tap math, so moving a slider after creation would desync both the visuals
  // and the interaction.
  const vw = scene.scale.width;
  const vh = scene.scale.height;
  const cx = vw / 2;
  const cy = vh / 2;
  const panelW = Math.min(PANEL_W, vw - MARGIN * 2);
  const panelH = Math.min(PANEL_H, vh - MARGIN * 2);

  const bg = scene.add.rectangle(cx, cy, vw, vh, 0x000000, 0.72)
    .setScrollFactor(0).setDepth(depth).setVisible(false).setInteractive();
  bg.on('pointerup', onBackgroundTap);

  const panel = scene.add.rectangle(cx, cy, panelW, panelH, 0x0d0d20)
    .setScrollFactor(0).setDepth(depth + 1).setVisible(false).setStrokeStyle(2, 0x4455aa).setInteractive();

  const title = scene.add.text(cx, cy - panelH / 2 + 22, 'VOLUME', {
    fontSize: '20px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5).setScrollFactor(0).setDepth(depth + 2).setVisible(false);

  const sliderDepth = depth + 2;
  const top  = cy - panelH / 2 + 64;
  const step = 48;
  const sliderSpecs: Array<[string, SoundCategory | 'master', number]> = [
    ['MASTER',       'master',    vols.master],
    ['Music',        'music',     vols.music],
    ['Player SFX',   'playerSfx', vols.playerSfx],
    ['Enemy SFX',    'enemySfx',  vols.enemySfx],
    ['Environment',  'envSfx',    vols.envSfx],
  ];
  const sliderParts = sliderSpecs.map(([labelText, cat, val], i) =>
    createVolumeSlider(scene, cx, top + i * step, labelText, cat, val, sliderDepth),
  );

  const setOpen = (open: boolean): void => {
    bg.setVisible(open); panel.setVisible(open); title.setVisible(open);
    sliderParts.flat().forEach(o => (o as any).setVisible(open));
  };

  // Keep the dim background covering the viewport if it ever changes size.
  const relayout = (): void => {
    bg.setPosition(scene.scale.width / 2, scene.scale.height / 2)
      .setSize(scene.scale.width, scene.scale.height);
  };

  return {
    parts: [bg, panel, title, ...sliderParts.flat()],
    setOpen,
    relayout,
  };
}
