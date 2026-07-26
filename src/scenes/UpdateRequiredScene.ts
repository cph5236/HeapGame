import Phaser from 'phaser';
import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { paintSkyGradient } from '../ui/skyGradient';
import {
  getClientVersion,
  getMinVersionConfig,
  openUpdateDestination,
  updateActionLabel,
} from '../systems/UpdateGate';
import { parseMinVersionConfig, type MinVersionConfig } from '../../shared/versionGate';

// Terminal screen shown when remote config's `min_version` puts this build below
// the supported floor. LoadingScene routes here instead of the menu, and there is
// no way back — that is the point of a hard gate. It only ever appears on a
// config fetched this launch (see UpdateGate), so a player who is merely offline
// never lands here.
//
// Palette is the loader's, via ui/skyGradient, so the boot sequence stays visually
// continuous even when it dead-ends.

const TITLE_COLOR   = '#ff9922'; // matches MenuScene / LoadingScene title
const TITLE_STROKE  = '#1a0800';
const BODY_COLOR    = '#e8d9c4';
const MUTED_COLOR   = '#cc9966'; // matches the loader tagline
const BTN_FILL      = 0xffb03a;  // warm gold, keyed to the loader's progress bar
const BTN_FILL_DOWN = 0xd9902c;
const BTN_TEXT      = '#2a1a08';

const DEFAULT_MESSAGE =
  'This version of Heap is no longer supported.\nUpdate to keep playing.';

export class UpdateRequiredScene extends Phaser.Scene {
  /** Dev-only: stand in for remote config so scene-preview can pose this screen. */
  private previewGate: MinVersionConfig | null = null;

  constructor() {
    super({ key: 'UpdateRequiredScene' });
  }

  init(data?: { gate?: MinVersionConfig }): void {
    this.previewGate = import.meta.env.DEV
      ? parseMinVersionConfig(data?.gate)
      : null;
  }

  create(): void {
    setupUiCamera(this);
    const w = logicalWidth(this);
    const h = logicalHeight(this);
    const cx = w / 2;

    paintSkyGradient(this, w, h);

    const gate    = this.previewGate ?? getMinVersionConfig();
    const message = gate?.message?.trim() || DEFAULT_MESSAGE;

    // ── Title ────────────────────────────────────────────────────────────────
    const titleY = h * 0.26;
    this.add.text(cx + 3, titleY + 5, 'UPDATE', {
      fontSize: '52px', fontStyle: 'bold', color: '#000000', stroke: '#000000', strokeThickness: 10,
    }).setOrigin(0.5);
    this.add.text(cx, titleY, 'UPDATE', {
      fontSize: '52px', fontStyle: 'bold', color: TITLE_COLOR, stroke: TITLE_STROKE, strokeThickness: 7,
    }).setOrigin(0.5);
    this.add.text(cx, titleY + 46, 'REQUIRED', {
      fontSize: '26px', fontStyle: 'bold', color: TITLE_COLOR, stroke: TITLE_STROKE, strokeThickness: 5,
    }).setOrigin(0.5);

    // ── Reason ───────────────────────────────────────────────────────────────
    // Flowed downward from the message rather than pinned to fixed fractions, so
    // a one-line message and a wrapped three-line one both stay evenly spaced.
    // wordWrap keeps an admin-authored message from running off a phone screen.
    const body = this.add.text(cx, h * 0.52, message, {
      fontSize: '17px', color: BODY_COLOR, align: 'center',
      stroke: '#000000', strokeThickness: 3,
      wordWrap: { width: Math.round(w * 0.82) },
    }).setOrigin(0.5);

    let flowY = body.getBounds().bottom;

    // ── Version line ─────────────────────────────────────────────────────────
    if (gate) {
      flowY += 22;
      this.add.text(cx, flowY, `You have V${getClientVersion()}  ·  V${gate.version} required`, {
        fontFamily: 'sans-serif', fontSize: '13px', color: MUTED_COLOR,
        stroke: '#000000', strokeThickness: 3,
      }).setOrigin(0.5, 0);
      flowY += 20;
    }

    this.buildActionButton(cx, flowY + 56, Math.round(w * 0.6));

    this.cameras.main.fadeIn(180, 0, 0, 0);
  }

  /** Gold action button — opens the Play listing on Android, reloads on web. */
  private buildActionButton(cx: number, cy: number, btnW: number): void {
    const btnH = 52;

    const shadow = this.add.rectangle(cx + 3, cy + 4, btnW, btnH, 0x000000, 0.45).setOrigin(0.5);
    const face   = this.add.rectangle(cx, cy, btnW, btnH, BTN_FILL, 1)
      .setOrigin(0.5)
      .setStrokeStyle(3, 0x000000, 0.75);
    const label  = this.add.text(cx, cy, updateActionLabel(), {
      fontSize: '22px', fontStyle: 'bold', color: BTN_TEXT,
    }).setOrigin(0.5);

    face.setInteractive({ useHandCursor: true });
    face.on(Phaser.Input.Events.GAMEOBJECT_POINTER_DOWN, () => {
      face.setFillStyle(BTN_FILL_DOWN, 1);
      label.setY(cy + 2);
    });
    face.on(Phaser.Input.Events.GAMEOBJECT_POINTER_OUT, () => {
      face.setFillStyle(BTN_FILL, 1);
      label.setY(cy);
    });
    face.on(Phaser.Input.Events.GAMEOBJECT_POINTER_UP, () => {
      face.setFillStyle(BTN_FILL, 1);
      label.setY(cy);
      openUpdateDestination();
    });

    // Gentle pulse so the only actionable thing on screen reads as actionable.
    this.tweens.add({
      targets: [face, shadow], scaleX: 1.03, scaleY: 1.06,
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });
  }
}
