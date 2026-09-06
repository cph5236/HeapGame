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
 * Build one labelled volume slider at (x, y). The single volume widget, used by
 * SettingsScene's Sounds tab. Returns the display objects (created hidden) so the
 * caller controls visibility.
 *
 * The slider captures its track coordinates for the drag/tap math, so it MUST be
 * created at its final position — moving it afterwards desyncs the visuals from
 * the interaction.
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
