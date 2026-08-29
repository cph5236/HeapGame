import Phaser from 'phaser';
import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { AudioManager } from '../systems/AudioManager';
import { InputManager } from '../systems/InputManager';
import { createVolumeSlider } from '../ui/volumeSlider';
import { controlHelpLines } from '../ui/controlHelp';
import { privacyRow, PRIVACY_ROW_STYLE } from '../ui/privacyRow';
import { AdClient } from '../systems/ads/AdClient';
import { getLogger } from '../logging';
import { mountableControlMode, startupControlOverride } from '../systems/tiltAvailability';
import {
  getVerboseLogging, setVerboseLogging,
  setControlMode, getEffectiveControlMode, setSessionControlMode,
  getJoystickSide, setJoystickSide,
  resetAllData,
} from '../systems/SaveData';

export type Tab = 'sounds' | 'controls' | 'player';

/** A host-supplied button on the Player tab. The scene owns the platform rows
 *  (analytics consent, privacy options, reset); anything game-specific — redeem
 *  a code, replay the tutorial — arrives through here so the scene stays free of
 *  game concepts. Rows render top-to-bottom in array order. */
export interface SettingsRow {
  label: string;
  /** Panel fill / stroke / text colors. Defaults to the neutral blue button. */
  color?: { fill: number; stroke: number; text: string };
  /** Invoked on tap. Receives a `setResult` to print a line under the button
   *  (used by Redeem Code to report success/failure without owning UI). */
  onTap: (setResult: (msg: string, ok: boolean) => void) => void;
}

export interface SettingsSceneData {
  /** Scene key to pause while Settings is up, and resume when it closes. */
  returnTo: string;
  /** 'menu' shows destructive/out-of-run rows (Reset All Data); 'game' hides
   *  them — wiping the save or replaying a tutorial mid-run is never right. */
  context: 'menu' | 'game';
  /** Game-specific Player-tab buttons. Ignored when context is 'game'. */
  rows?: SettingsRow[];
  /** Copy for the Reset All Data warning — the platform owns the button, the
   *  game owns the list of what actually gets wiped. */
  resetWarning?: string;
  /** Called after the control mode or side changes, so the host can re-paint
   *  anything that depends on it (MenuScene's tilt-permission prompt). */
  onControlsChanged?: () => void;
  /** Called after a confirmed Reset All Data, before this scene closes. */
  onReset?: () => void;
  /** Tab to open on. Defaults to 'sounds'; exists so scene-preview can shoot a
   *  specific tab without a click. */
  initialTab?: Tab;
}

const PANEL_W = 360;
const PANEL_H = 420;

const D_OVERLAY = 30;
const D_PANEL   = 31;
const D_CHROME  = 32;
const D_CONTENT = 33;

const BTN_FILL_DEFAULT   = { fill: 0x1a3a5c, stroke: 0x4488ff, text: '#aaccff' };
const DEFAULT_RESET_WARNING = 'Clears all saved progress.';

// Player-tab vertical rhythm. The panel is a fixed 360x420, so the rows have to
// fit a 340px content column: at the maximum of two host rows the reset warning
// lands ~30px above the panel's bottom edge. Widen these and the warning renders
// outside the panel.
const ROW_PITCH = 72;

/**
 * The one settings UI, launched as a modal overlay over whatever scene asked for
 * it — the main menu or a paused run. It is a Scene rather than a panel built
 * into its host for three reasons: it must render above an arbitrary scene with
 * its own camera and depth space; its host may `scene.restart()` underneath it
 * (MenuScene does, on resize); and a scene can pause its host, which is the only
 * way to stop the host's own buttons from receiving taps through the overlay —
 * Phaser's `topOnly` hit-testing is per-scene, so a full-screen interactive
 * rectangle blocks siblings in the same scene but nothing in the scene below.
 */
export class SettingsScene extends Phaser.Scene {
  private returnTo!: string;
  private context: 'menu' | 'game' = 'menu';
  private rows: SettingsRow[] = [];
  private resetWarningText = DEFAULT_RESET_WARNING;
  private onControlsChanged?: () => void;
  private onReset?: () => void;
  private initialTab: Tab = 'sounds';

  private soundsItems:   Phaser.GameObjects.GameObject[] = [];
  private controlsItems: Phaser.GameObjects.GameObject[] = [];
  private playerItems:   Phaser.GameObjects.GameObject[] = [];

  private resetConfirmed = false;
  private onScaleResize = (): void => { this.close(); };

  constructor() { super({ key: 'SettingsScene' }); }

  init(data: SettingsSceneData): void {
    this.returnTo          = data.returnTo;
    this.context           = data.context;
    this.rows              = data.context === 'game' ? [] : (data.rows ?? []);
    this.resetWarningText  = data.resetWarning ?? DEFAULT_RESET_WARNING;
    this.onControlsChanged = data.onControlsChanged;
    this.onReset           = data.onReset;
    this.initialTab        = data.initialTab ?? 'sounds';
    this.resetConfirmed    = false;
    this.soundsItems = []; this.controlsItems = []; this.playerItems = [];
  }

  create(): void {
    setupUiCamera(this);

    // Stop the host processing input and updates while the modal is up. Each
    // scene runs its own InputPlugin, so without this the host's buttons stay
    // live under the dim.
    this.scene.pause(this.returnTo);

    // Swallow taps over the whole overlay so dismissing Settings never leaks a
    // jump/dash into a resumed run. Keyed 'settings', NOT 'pause': when Settings
    // is opened from the pause menu both are up, and sharing a key would let
    // this scene's teardown clear PauseScene's suppression too.
    InputManager.getInstance().setSuppressionRect('settings', {
      x: 0, y: 0, w: logicalWidth(this), h: logicalHeight(this),
    });

    const cx = logicalWidth(this) / 2;
    const cy = logicalHeight(this) / 2;

    const overlayBg = this.add.rectangle(cx, cy, logicalWidth(this), logicalHeight(this), 0x000000, 0.72)
      .setScrollFactor(0).setDepth(D_OVERLAY).setInteractive();
    // The panel is interactive so taps landing on it (a slider track, empty panel
    // space) are absorbed here rather than falling through to overlayBg, whose
    // pointerup closes. Only taps on the true backdrop should close.
    this.add.rectangle(cx, cy, PANEL_W, PANEL_H, 0x0d0d20)
      .setScrollFactor(0).setDepth(D_PANEL).setStrokeStyle(2, 0x4455aa).setInteractive();

    this.add.text(cx, cy - PANEL_H / 2 + 22, 'SETTINGS', {
      fontSize: '22px', color: '#ffffff', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CHROME);

    const closeBtn = this.add.text(cx + PANEL_W / 2 - 20, cy - PANEL_H / 2 + 14, '✕', {
      fontSize: '20px', color: '#aaaaaa',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CHROME).setInteractive({ useHandCursor: true });

    overlayBg.on('pointerup', () => this.close());
    closeBtn.on('pointerup',  () => this.close());

    // ── Tab bar ───────────────────────────────────────────────────────────────
    const TAB_Y = cy - PANEL_H / 2 + 52;
    const TAB_W = 108, TAB_H = 32, TAB_GAP = 6;
    const tabXs = [cx - (TAB_W + TAB_GAP), cx, cx + (TAB_W + TAB_GAP)];

    const mkTab = (x: number, label: string, tab: Tab) => {
      const bg = this.add.rectangle(x, TAB_Y, TAB_W, TAB_H, 0x1a1a2e)
        .setScrollFactor(0).setDepth(D_CHROME).setInteractive({ useHandCursor: true });
      const txt = this.add.text(x, TAB_Y, label, { fontSize: '13px', color: '#888888' })
        .setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT).setInteractive({ useHandCursor: true });
      bg.on('pointerup',  () => this.showTab(tab));
      txt.on('pointerup', () => this.showTab(tab));
      return { bg, txt };
    };
    this.tabs = {
      sounds:   mkTab(tabXs[0], 'Sounds',   'sounds'),
      controls: mkTab(tabXs[1], 'Controls', 'controls'),
      player:   mkTab(tabXs[2], 'Player',   'player'),
    };

    const CONTENT_TOP = TAB_Y + TAB_H / 2 + 12;
    this.buildSoundsTab(cx, CONTENT_TOP);
    this.buildControlsTab(cx, CONTENT_TOP);
    this.buildPlayerTab(cx, CONTENT_TOP);

    this.showTab(this.initialTab);

    // The host restarts itself on resize (RESIZE_SAFE_SCENES in main.ts), which
    // would leave this modal sitting over a freshly rebuilt scene holding stale
    // callbacks. Sliders also capture their track coordinates at build time and
    // cannot be re-laid-out. Closing is the honest answer to both.
    this.scale.on(Phaser.Scale.Events.RESIZE, this.onScaleResize);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off(Phaser.Scale.Events.RESIZE, this.onScaleResize);
    });

    this.input.keyboard?.on('keydown-ESC', () => this.close());
  }

  private tabs!: Record<Tab, { bg: Phaser.GameObjects.Rectangle; txt: Phaser.GameObjects.Text }>;

  // ── Sounds ──────────────────────────────────────────────────────────────────

  private buildSoundsTab(cx: number, top: number): void {
    const vols = AudioManager.getVolumes();
    const divider = this.add.rectangle(cx, top + 66, 280, 1, 0x334466)
      .setScrollFactor(0).setDepth(D_CONTENT);
    const specs: Array<[string, Parameters<typeof createVolumeSlider>[4], number, number]> = [
      ['MASTER',      'master',    vols.master,    24],
      ['Music',       'music',     vols.music,     96],
      ['Player SFX',  'playerSfx', vols.playerSfx, 150],
      ['Enemy SFX',   'enemySfx',  vols.enemySfx,  204],
      ['Environment', 'envSfx',    vols.envSfx,    258],
    ];
    const sliders = specs.flatMap(([label, cat, val, dy]) =>
      createVolumeSlider(this, cx, top + dy, label, cat, val, D_CONTENT),
    );
    sliders.forEach(o => (o as any).setScrollFactor?.(0));
    this.soundsItems = [divider, ...sliders];
  }

  // ── Controls ────────────────────────────────────────────────────────────────

  private buildControlsTab(cx: number, top: number): void {
    const im = InputManager.getInstance();
    // Show the mode actually in effect (an auto-fallback session override, if
    // any, else the saved pref) so the toggle reflects reality after the tilt
    // watchdog has run.
    let mode = getEffectiveControlMode();
    let side = getJoystickSide();

    const modeLabel = this.add.text(cx - 130, top + 20, 'Control Mode', { fontSize: '14px', color: '#aaaacc' })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(D_CONTENT);
    const tiltOpt = this.add.text(cx + 16, top + 20, 'Tilt', {
      fontSize: '15px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#2244aa', padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT).setInteractive({ useHandCursor: true });
    const joyOpt = this.add.text(cx + 96, top + 20, 'Joystick', {
      fontSize: '15px', color: '#888888', backgroundColor: '#1a1a2e', padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT).setInteractive({ useHandCursor: true });

    const sideLabel = this.add.text(cx - 130, top + 64, 'Joystick Side', { fontSize: '14px', color: '#aaaacc' })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(D_CONTENT);
    const leftOpt = this.add.text(cx + 16, top + 64, 'Left', {
      fontSize: '15px', color: '#ffffff', fontStyle: 'bold', backgroundColor: '#2244aa', padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT).setInteractive({ useHandCursor: true });
    const rightOpt = this.add.text(cx + 96, top + 64, 'Right', {
      fontSize: '15px', color: '#888888', backgroundColor: '#1a1a2e', padding: { x: 10, y: 4 },
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT).setInteractive({ useHandCursor: true });

    const hint = this.add.text(cx, top + 108, controlHelpLines(im.isMobile, mode).join('\n'), {
      fontSize: '13px', color: '#d8dcf2', align: 'left', lineSpacing: 3,
    }).setOrigin(0.5, 0).setScrollFactor(0).setDepth(D_CONTENT);

    const paintMode = () => {
      const on = (t: Phaser.GameObjects.Text, active: boolean) => t
        .setColor(active ? '#ffffff' : '#888888')
        .setBackgroundColor(active ? '#2244aa' : '#1a1a2e')
        .setFontStyle(active ? 'bold' : 'normal');
      on(tiltOpt, mode === 'tilt');
      on(joyOpt,  mode === 'joystick');
      const sideDim = mode !== 'joystick';
      [sideLabel, leftOpt, rightOpt].forEach(o => o.setAlpha(sideDim ? 0.4 : 1));
      // The toggle shows the player's CHOICE; the hint must describe the controls
      // actually on screen, which differ while tilt awaits its permission grant.
      hint.setText(controlHelpLines(im.isMobile, mountableControlMode(mode, im)).join('\n'));
    };
    const paintSide = () => {
      const on = (t: Phaser.GameObjects.Text, active: boolean) => t
        .setColor(active ? '#ffffff' : '#888888')
        .setBackgroundColor(active ? '#2244aa' : '#1a1a2e')
        .setFontStyle(active ? 'bold' : 'normal');
      on(leftOpt,  side === 'left');
      on(rightOpt, side === 'right');
    };
    paintMode(); paintSide();

    // An explicit choice clears any auto-fallback session override (it wins) —
    // but picking Tilt saves the PREFERENCE without making it active on a device
    // that still can't deliver orientation data. startupControlOverride re-asserts
    // the joystick there, and the host's prompt offers the permission grant;
    // without this the player could leave Settings with no working controls.
    tiltOpt.on('pointerup', () => {
      mode = 'tilt';
      setControlMode('tilt');
      // Any joystick override left standing here is a capability limit, NOT the
      // player's choice — they just picked Tilt. Marking it auto is what lets
      // clearAutoControlOverride() hand tilt back the instant data arrives;
      // without that flag the player stays pinned to the joystick all session.
      const override = startupControlOverride(im);
      setSessionControlMode(override, { auto: override !== null });
      paintMode();
      this.onControlsChanged?.();
    });
    joyOpt.on('pointerup', () => {
      mode = 'joystick';
      setControlMode('joystick');
      setSessionControlMode(null);
      paintMode();
      this.onControlsChanged?.();
    });
    leftOpt.on('pointerup',  () => { if (mode !== 'joystick') return; side = 'left';  setJoystickSide('left');  paintSide(); });
    rightOpt.on('pointerup', () => { if (mode !== 'joystick') return; side = 'right'; setJoystickSide('right'); paintSide(); });

    this.repaintControls = () => { paintMode(); paintSide(); };
    this.controlsItems = [modeLabel, tiltOpt, joyOpt, sideLabel, leftOpt, rightOpt, hint];
  }

  private repaintControls: () => void = () => {};

  // ── Player ──────────────────────────────────────────────────────────────────

  private buildPlayerTab(cx: number, top: number): void {
    const items: Phaser.GameObjects.GameObject[] = [];
    let y = top + 24;

    // Host-supplied rows first (Redeem Code, How to Play …), each with an
    // optional result line underneath.
    for (const row of this.rows) {
      const c = row.color ?? BTN_FILL_DEFAULT;
      const bg = this.add.rectangle(cx, y, 260, 48, c.fill)
        .setScrollFactor(0).setDepth(D_CHROME).setStrokeStyle(2, c.stroke).setInteractive({ useHandCursor: true });
      const label = this.add.text(cx, y, row.label, {
        fontSize: '18px', color: c.text, fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT);
      const result = this.add.text(cx, y + 34, '', { fontSize: '13px', color: '#88ccff', align: 'center' })
        .setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT);
      bg.on('pointerup', () => row.onTap((msg, ok) => {
        result.setText(msg).setColor(ok ? '#88ff88' : '#ff9988');
      }));
      items.push(bg, label, result);
      y += ROW_PITCH;
    }

    // Analytics consent — platform, not game.
    let analyticsEnabled = getVerboseLogging();
    const aBg = this.add.rectangle(cx, y, 260, 48, 0x1a3a1a)
      .setScrollFactor(0).setDepth(D_CHROME).setStrokeStyle(2, 0x44aa44).setInteractive({ useHandCursor: true });
    const aBox = this.add.text(cx - 110, y, analyticsEnabled ? '☑' : '☐', {
      fontSize: '20px', color: '#44ff44', fontStyle: 'bold',
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT);
    const aLabel = this.add.text(cx - 35, y - 8, 'Send anonymous\ngameplay analytics', { fontSize: '13px', color: '#aaffaa' })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(D_CONTENT);
    const aHint = this.add.text(cx - 35, y + 9, 'Errors are always reported.', { fontSize: '11px', color: '#88aa88' })
      .setOrigin(0, 0.5).setScrollFactor(0).setDepth(D_CONTENT);
    aBg.on('pointerup', () => {
      analyticsEnabled = !analyticsEnabled;
      setVerboseLogging(analyticsEnabled);
      getLogger().setVerbose(analyticsEnabled);
      aBox.setText(analyticsEnabled ? '☑' : '☐');
    });
    items.push(aBg, aBox, aLabel, aHint);
    y += 38;

    // Privacy options — reopens Google's consent form so the player can change or
    // withdraw ad consent. Named in PRIVACY_POLICY.md as the revocation route, so
    // the wording here and there must stay in step. Built unconditionally but
    // shown from the live flag each time the tab opens: consent can settle after
    // this scene is already up (it is bounded by CONSENT_TIMEOUT_MS, not
    // guaranteed to beat it).
    this.privacyLabel = this.add.text(cx, y, PRIVACY_ROW_STYLE.label, {
      fontSize: '14px', color: PRIVACY_ROW_STYLE.color,
    }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT)
      .setInteractive({ useHandCursor: true })
      .on('pointerup', () => { void AdClient.showPrivacyOptions(); });
    items.push(this.privacyLabel);
    y += 42;

    // Reset All Data — menu only. Wiping the save mid-run is never right.
    if (this.context === 'menu') {
      const rBg = this.add.rectangle(cx, y + 28, 260, 52, 0x881111)
        .setScrollFactor(0).setDepth(D_CHROME).setStrokeStyle(2, 0xff4444).setInteractive({ useHandCursor: true });
      const rLabel = this.add.text(cx, y + 28, 'Reset All Data', {
        fontSize: '20px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 2,
      }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CONTENT);
      const rWarn = this.add.text(cx, y + 70, this.resetWarningText, {
        fontSize: '14px', color: '#aa8888', align: 'center',
      }).setOrigin(0.5).setScrollFactor(0).setDepth(D_CHROME);
      rBg.on('pointerup', () => {
        if (!this.resetConfirmed) {
          this.resetConfirmed = true;
          rLabel.setText('Tap again to confirm');
          rBg.setFillStyle(0xcc2222);
          rWarn.setText('This cannot be undone.').setColor('#ff6666');
          return;
        }
        resetAllData();
        this.onReset?.();
        this.close();
      });
      items.push(rBg, rLabel, rWarn);
    }

    this.playerItems = items;
  }

  private privacyLabel!: Phaser.GameObjects.Text;

  // ── Tab switching ───────────────────────────────────────────────────────────

  private showTab(tab: Tab): void {
    const groups: Record<Tab, Phaser.GameObjects.GameObject[]> = {
      sounds:   this.soundsItems,
      controls: this.controlsItems,
      player:   this.playerItems,
    };
    (Object.keys(groups) as Tab[]).forEach(k => {
      const active = k === tab;
      groups[k].forEach(o => (o as any).setVisible(active));
      this.tabs[k].bg.setFillStyle(active ? 0x2244aa : 0x1a1a2e);
      this.tabs[k].txt.setColor(active ? '#ffffff' : '#888888').setFontStyle(active ? 'bold' : 'normal');
    });
    if (tab === 'controls') this.repaintControls();
    // Re-read consent each time rather than trusting create()-time state; must
    // follow the sweep above, which has just shown every player item including
    // this one.
    if (tab === 'player') {
      this.privacyLabel.setVisible(privacyRow(AdClient.privacyOptionsRequired) !== null);
    }
  }

  // ── Close ───────────────────────────────────────────────────────────────────

  private close(): void {
    const im = InputManager.getInstance();
    im.setSuppressionRect('settings', null);
    // Drop the dismiss tap so it can't fire a jump on the resumed run.
    im.clearBufferedActions();
    this.scene.resume(this.returnTo);
    this.scene.stop();
  }
}
