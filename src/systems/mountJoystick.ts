import Phaser from 'phaser';
import { InputManager } from './InputManager';
import { JoystickController } from './JoystickController';
import { Player } from '../entities/Player';
import { getEffectiveControlMode, getJoystickSide } from './SaveData';
import { logicalWidth, logicalHeight } from './displayMetrics';
import { addToGameplayUi } from './GameplayUiCamera';
import { JOYSTICK_RADIUS, JOYSTICK_MARGIN, DASH_BUTTON_RADIUS, HUD_PLACE_W, HUD_PLACE_H, HUD_PLACE_GAP } from '../constants';
import { controlClusterLayout } from '../ui/hudLogic';
import { HUD_THEME } from '../ui/hudTheme';

export interface JoystickHandle {
  update(delta: number): void;
  destroy(): void;
}

const DASH_SUPPRESS_ID = 'dash';
const JOYSTICK_SUPPRESS_ID = 'joystick';

/** When controlMode === 'joystick', build the stick + dash button for `scene`.
 *  The stick sits in one bottom corner (per joystickSide); the dash button in the
 *  opposite corner. Returns null in tilt mode. Caller updates BEFORE im.update()
 *  and calls destroy() on scene shutdown. */
export function mountJoystick(
  scene: Phaser.Scene, im: InputManager, player: Player,
): JoystickHandle | null {
  // Sync the singleton's control mode from the effective mode (session override
  // from the tilt watchdog, else the saved pref) on every gameplay-scene mount. The
  // InputManager persists across scenes, so this both ACTIVATES joystick gating
  // (gamma tilt + window gestures off) and RESETS to tilt when switched back.
  // Without this the saved/effective mode never reaches the live input system.
  const mode = getEffectiveControlMode();
  im.setControlMode(mode);
  if (mode !== 'joystick') return null;

  const side = getJoystickSide();
  const w = logicalWidth(scene);
  const h = logicalHeight(scene);
  const layout = controlClusterLayout(side, w, h, {
    joyRadius: JOYSTICK_RADIUS, joyMargin: JOYSTICK_MARGIN, dashRadius: DASH_BUTTON_RADIUS,
    placeW: HUD_PLACE_W, placeH: HUD_PLACE_H, placeGap: HUD_PLACE_GAP,
  });

  const controller = new JoystickController(scene, layout.stick.x, layout.stick.y);

  im.setSuppressionRect(JOYSTICK_SUPPRESS_ID, {
    x: layout.stick.x - JOYSTICK_RADIUS, y: layout.stick.y - JOYSTICK_RADIUS,
    w: JOYSTICK_RADIUS * 2, h: JOYSTICK_RADIUS * 2,
  });

  const dashX = layout.dash.x, dashY = layout.dash.y;
  const dashBtn = scene.add.circle(dashX, dashY, DASH_BUTTON_RADIUS, 0x14100c, 0.5)
    .setStrokeStyle(2, HUD_THEME.dashStroke).setScrollFactor(0).setDepth(40).setVisible(player.hasDash);
  const dashLabel = scene.add.text(dashX, dashY, '»', {
    fontSize: '26px', color: '#ffd0c2', fontStyle: 'bold',
  }).setOrigin(0.5).setScrollFactor(0).setDepth(41).setVisible(player.hasDash);
  const dashRing = scene.add.graphics().setScrollFactor(0).setDepth(41).setVisible(player.hasDash);
  addToGameplayUi(scene, [dashBtn, dashLabel, dashRing]);

  if (player.hasDash) {
    dashBtn.setInteractive({ useHandCursor: true });
    dashBtn.on('pointerdown', () => {
      const dir: 1 | -1 = im.tiltFactor > 0.05 ? 1
        : im.tiltFactor < -0.05 ? -1
        : (player.sprite.flipX ? -1 : 1);
      im.pulseDash(dir);
    });
    // Suppress so the tap never leaks into a gesture (belt-and-suspenders).
    im.setSuppressionRect(DASH_SUPPRESS_ID, {
      x: dashX - DASH_BUTTON_RADIUS, y: dashY - DASH_BUTTON_RADIUS,
      w: DASH_BUTTON_RADIUS * 2, h: DASH_BUTTON_RADIUS * 2,
    });
  }

  const RING_R = DASH_BUTTON_RADIUS + 3;
  const TWO_PI = Math.PI * 2;
  const drawRing = (): void => {
    if (!player.hasDash) return;
    const filled = 1 - Math.max(0, Math.min(1, player.dashCooldownFraction));
    dashRing.clear();
    dashRing.lineStyle(4, filled >= 1 ? 0xff7755 : 0xaa5544, 1);
    dashRing.beginPath();
    dashRing.arc(dashX, dashY, RING_R, -Math.PI / 2, -Math.PI / 2 + TWO_PI * filled, false);
    dashRing.strokePath();
  };

  return {
    update: (delta: number) => { controller.update(delta); drawRing(); },
    destroy: () => {
      controller.destroy();
      dashBtn.destroy();
      dashLabel.destroy();
      dashRing.destroy();
      im.setSuppressionRect(DASH_SUPPRESS_ID, null);
      im.setSuppressionRect(JOYSTICK_SUPPRESS_ID, null);
    },
  };
}
