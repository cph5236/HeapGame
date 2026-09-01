import Phaser from 'phaser';


import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { AudioManager } from '../systems/AudioManager';
import { getBalance, getPlaced, getPlayerName, setPlayerName, getPlayerGuid, getGpgsPlayerId, getEffectivePlayerId, getControlMode, getEffectiveControlMode, setSessionControlMode, getEquippedCosmetics, getHatAdjustments, getCustomizeHintSeen } from '../systems/SaveData';
import { tiltPromptKind, isTiltPendingPermission } from '../systems/tiltAvailability';
import { composeAvatar } from '../ui/avatar';
import { redeemCode, type RedeemResult } from '../systems/CodeClient';
import { syncSaveToCloud } from '../systems/cloudSave';
import { retryPendingLoadoutSync } from '../systems/cosmeticsSync';
import { TILT_WATCHDOG_MS } from '../constants';
import { InputManager } from '../systems/InputManager';
import { drawCloudShape } from '../systems/backgroundEntities';
import { type HeapParams, DEFAULT_HEAP_PARAMS } from '../../shared/heapTypes';
import { validatePlayerName, MAX_PLAYER_NAME_LEN } from '../../shared/playerName';
import { PlayerNameClient } from '../systems/PlayerNameClient';
import { formatDifficulty } from '../ui/DifficultyStars';
import { loadGameAssets } from './loadGameAssets';
import { entranceScale } from './menuIntro';
import { getLogger } from '../logging';
import { PlayGamesClient } from '../systems/PlayGamesClient';
import { openFeedbackOverlay } from './FeedbackOverlay';
import type { SettingsSceneData } from './SettingsScene';
import { fetchDailyStatus } from '../systems/DailyDropClient';
import { hasPlayedToday, deviceUtcOffsetMin } from '../systems/dailyRunGate';
import { dailyIconState, shouldAutoShowPopup, formatCountdown, type DailyIconState } from '../ui/dailyDropLogic';
import { openDailyDropOverlay } from '../ui/DailyDropOverlay';
import { localDateKey } from '../../shared/dailyDrop';
import type { DailyStatusResponse } from '../../shared/dailyTypes';

export class MenuScene extends Phaser.Scene {
  private farSilhouette!: Phaser.GameObjects.Graphics;
  private nearSilhouette!: Phaser.GameObjects.Graphics;
  private horizonGlow!: Phaser.GameObjects.Graphics;
  private playerFigure!: Phaser.GameObjects.Container;
  private figureY = 388;
  private titleShadow!: Phaser.GameObjects.Text;
  private titleText!: Phaser.GameObjects.Text;
  private taglineText!: Phaser.GameObjects.Text;
  private customizeHint?: Phaser.GameObjects.Text;
  private balanceText!: Phaser.GameObjects.Text;
  private startBg!: Phaser.GameObjects.Graphics;
  private upgradeBg!: Phaser.GameObjects.Graphics;
  private storeBg!: Phaser.GameObjects.Graphics;
  private startText!: Phaser.GameObjects.Text;
  private upgradeText!: Phaser.GameObjects.Text;
  private storeText!: Phaser.GameObjects.Text;
  private twinkleStars: Phaser.GameObjects.Graphics[] = [];
  private playerNameText!: Phaser.GameObjects.Text;
  private heapPickerBg!:    Phaser.GameObjects.Graphics;
  private heapPickerText!:  Phaser.GameObjects.Text;
  private heapPickerStars!: Phaser.GameObjects.Text;
  private leaderboardBg!:   Phaser.GameObjects.Graphics;
  private leaderboardIcon!: Phaser.GameObjects.Text;

  private _forceSettingsOpen = false;
  private tiltPrompt?: Phaser.GameObjects.Container;
  private dailyCanIcon?: Phaser.GameObjects.Container;
  private dailyTick?: Phaser.Time.TimerEvent;

  constructor() {
    super({ key: 'MenuScene' });
  }

  init(data: { forceSettingsOpen?: boolean } = {}): void {
    this._forceSettingsOpen = data.forceSettingsOpen ?? false;
  }

  // On short screens, shift the button group up so coins/name/settings fit below
  private get layoutShift(): number {
    return Math.min(Math.max(0, 780 - logicalHeight(this)), 60);
  }

  create(): void {
    setupUiCamera(this);
    retryPendingLoadoutSync();
    this.twinkleStars = [];

    const im = InputManager.getInstance();

    // Log user:created once per playerGuid via localStorage flag
    const guid = getPlayerGuid();
    const flagKey = `heap_user_created_logged:${guid}`;
    if (!localStorage.getItem(flagKey)) {
      getLogger().event({ type: 'user:created' });
      localStorage.setItem(flagKey, '1');
    }

    this.createSkyGradient();
    this.createStarField();
    this.createFarSilhouette();
    this.createHorizonGlow();
    this.createNearSilhouette();
    this.createPlayerFigure();
    this.createTitle();
    this.createTagline();
    this.createFloatingClouds();
    this.createBalanceText();
    this.createPlayerName();
    // No gpgs:signed-in listener: LoadingScene holds the menu until sign-in has
    // settled, so createPlayerName() above already painted the right label and
    // the id can no longer change underneath us.
    this.game.events.once('gpgs:save-merged', () => {
      if (!this.balanceText?.active) return;
      this.balanceText.setText(`${getBalance()} coins`);
    }, this);
    this.createPrompts(im);
    this.createHeapPicker();
    this.createSettingsButton();
    this.createFeedbackButton();
    this.createVersionLabel();
    if (!im.isMobile) this.createHotkeyLegend();
    this.runEntranceSequence();
    this.registerInput();
    loadGameAssets(this);
    if (this.registry.get('gameAssetsReady')) {
      AudioManager.play('music-menu');
    } else {
      this.load.once(Phaser.Loader.Events.COMPLETE, () => AudioManager.play('music-menu'));
    }
    void this.setupDailyDrop();
  }

  // ── Sky ──────────────────────────────────────────────────────────────────────

  private createSkyGradient(): void {
    const bands: [number, number, number][] = [
      [0,   47,  0x0a0818],
      [47,  47,  0x0e0d24],
      [94,  47,  0x121530],
      [141, 47,  0x161c3a],
      [188, 47,  0x1a2244],
      [235, 47,  0x1e284e],
      [282, 47,  0x222d55],
      [329, 47,  0x2a3460],
      [376, 47,  0x2e3860],
      [423, 47,  0x37415e],
      [470, 47,  0x4a4455],
      [517, 47,  0x5c4840],
      [564, 47,  0x6e4e30],
      [611, 47,  0x7d5228],
      [658, 47,  0x8a5520],
      [705, 47,  0x7a4a1a],
      [752, 47,  0x5e3a14],
      [799, 55,  0x3e280e],
    ];
    const g = this.add.graphics().setDepth(0);
    for (const [y, h, color] of bands) {
      g.fillStyle(color, 1);
      g.fillRect(0, y, logicalWidth(this), h);
    }
    g.fillStyle(0x3e280e, 1);
    g.fillRect(0, 854, logicalWidth(this), Math.max(0, logicalHeight(this) - 854));
  }

  // ── Stars ────────────────────────────────────────────────────────────────────

  private createStarField(): void {
    const staticG = this.add.graphics().setDepth(1);

    for (let i = 0; i < 68; i++) {
      const x = Phaser.Math.Between(0, logicalWidth(this));
      const y = Phaser.Math.Between(0, 514);
      const roll = Phaser.Math.Between(0, 9);
      const r = roll < 6 ? 0.7 : roll < 9 ? 1.2 : 2.0;
      const a = roll < 6 ? 0.9 : roll < 9 ? 0.55 : 0.25;
      staticG.fillStyle(0xffffff, a);
      staticG.fillCircle(x, y, r);
    }

    for (let i = 0; i < 12; i++) {
      const g = this.add.graphics().setDepth(1);
      const x = Phaser.Math.Between(0, logicalWidth(this));
      const y = Phaser.Math.Between(0, 514);
      g.fillStyle(0xffffff, 1);
      g.fillCircle(x, y, 1.2);
      this.twinkleStars.push(g);
    }
  }

  // ── Heap silhouettes ─────────────────────────────────────────────────────────

  private createFarSilhouette(): void {
    const sx = logicalWidth(this) / 480;
    const points = [
      { x: -20 * sx, y: logicalHeight(this) }, { x: -20 * sx, y: 700 }, { x: 10  * sx, y: 660 }, { x: 40  * sx, y: 680 },
      { x: 60  * sx, y: 620 }, { x: 90  * sx, y: 590 }, { x: 115 * sx, y: 610 }, { x: 140 * sx, y: 570 },
      { x: 170 * sx, y: 540 }, { x: 195 * sx, y: 560 }, { x: 220 * sx, y: 510 }, { x: 240 * sx, y: 440 },
      { x: 265 * sx, y: 480 }, { x: 290 * sx, y: 455 }, { x: 320 * sx, y: 490 }, { x: 345 * sx, y: 520 },
      { x: 370 * sx, y: 500 }, { x: 395 * sx, y: 540 }, { x: 420 * sx, y: 580 }, { x: 440 * sx, y: 555 },
      { x: 460 * sx, y: 610 }, { x: 490 * sx, y: 640 }, { x: 500 * sx, y: 700 }, { x: 500 * sx, y: logicalHeight(this) },
    ];
    this.farSilhouette = this.add.graphics().setDepth(2).setAlpha(0);
    this.farSilhouette.fillStyle(0x1a1225, 1);
    this.farSilhouette.fillPoints(points, true);
  }

  private createNearSilhouette(): void {
    const sx = logicalWidth(this) / 480;
    const points = [
      { x: 0,         y: logicalHeight(this) }, { x: 0,         y: 720 }, { x: 18  * sx, y: 695 }, { x: 35  * sx, y: 710 },
      { x: 50  * sx,  y: 670 }, { x: 68  * sx, y: 640 }, { x: 82  * sx, y: 655 }, { x: 100 * sx, y: 615 },
      { x: 118 * sx,  y: 595 }, { x: 130 * sx, y: 610 }, { x: 148 * sx, y: 575 }, { x: 162 * sx, y: 548 },
      { x: 175 * sx,  y: 565 }, { x: 192 * sx, y: 530 }, { x: 208 * sx, y: 505 }, { x: 220 * sx, y: 520 },
      { x: 235 * sx,  y: 490 }, { x: 248 * sx, y: 465 }, { x: 255 * sx, y: 478 }, { x: 262 * sx, y: 450 },
      { x: 268 * sx,  y: 420 }, { x: 272 * sx, y: 395 }, { x: 278 * sx, y: 410 }, { x: 284 * sx, y: 388 },
      { x: 290 * sx,  y: 400 }, { x: 296 * sx, y: 415 }, { x: 304 * sx, y: 435 }, { x: 316 * sx, y: 455 },
      { x: 328 * sx,  y: 440 }, { x: 340 * sx, y: 465 }, { x: 355 * sx, y: 490 }, { x: 368 * sx, y: 475 },
      { x: 382 * sx,  y: 505 }, { x: 395 * sx, y: 530 }, { x: 408 * sx, y: 515 }, { x: 422 * sx, y: 545 },
      { x: 438 * sx,  y: 570 }, { x: 450 * sx, y: 555 }, { x: 462 * sx, y: 590 }, { x: 472 * sx, y: 625 },
      { x: 480 * sx,  y: 660 }, { x: 480 * sx, y: logicalHeight(this) },
    ];
    this.nearSilhouette = this.add.graphics().setDepth(4).setAlpha(0);
    this.nearSilhouette.fillStyle(0x0d0910, 1);
    this.nearSilhouette.fillPoints(points, true);
  }

  // ── Horizon glow ─────────────────────────────────────────────────────────────

  private createHorizonGlow(): void {
    this.horizonGlow = this.add.graphics().setDepth(3).setAlpha(0);
    this.horizonGlow.fillStyle(0xff8833, 0.12);
    this.horizonGlow.fillEllipse(logicalWidth(this) / 2, 450, 460, 60);
    this.horizonGlow.fillStyle(0xff6611, 0.07);
    this.horizonGlow.fillEllipse(logicalWidth(this) / 2, 445, 360, 40);
    this.horizonGlow.fillStyle(0xffaa44, 0.05);
    this.horizonGlow.fillEllipse(logicalWidth(this) / 2, 455, 300, 25);
  }

  // ── Player figure ────────────────────────────────────────────────────────────

  /** Logo bag scale: matches the old static 'trashbag' image at 0.9 (~177px tall). */
  private static readonly LOGO_AVATAR_SCALE = 3.85;

  private createPlayerFigure(): void {
    const cx = logicalWidth(this) / 2;
    const s  = MenuScene.LOGO_AVATAR_SCALE;
    // Old image was bottom-anchored at y=388; the avatar container is centred.
    this.figureY = 388 - (46 * s) / 2;

    if (this.textures.exists('trashbag-nostrings')) {
      this.playerFigure = composeAvatar(this, getEquippedCosmetics(),
        { x: cx, y: this.figureY, scale: s }, getHatAdjustments()).setDepth(5).setAlpha(0);
    } else {
      // Assets not loaded yet — placeholder container, swap when ready.
      this.playerFigure = this.add.container(cx, this.figureY).setDepth(5).setAlpha(0);
      this.game.events.once('gameAssetsReady', () => {
        const oldAlpha = this.playerFigure.alpha;
        this.playerFigure.destroy();
        this.playerFigure = composeAvatar(this, getEquippedCosmetics(),
          { x: cx, y: this.figureY, scale: s }, getHatAdjustments()).setDepth(5).setAlpha(oldAlpha);
        this.startFigureBob();
        if (oldAlpha < 0.85) {
          this.tweens.add({ targets: this.playerFigure, alpha: 0.85, duration: 300 });
        }
      });
    }

    // The logo bag IS the wardrobe entry point.
    this.add.zone(cx, this.figureY, 160, 46 * s + 16)
      .setDepth(6).setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.scene.start('CustomizationScene'));

    // One-time nudge toward the (otherwise unlabeled) avatar button — hidden
    // for good once the player has actually opened the customizer.
    if (!getCustomizeHintSeen()) {
      // Sits beside the hood, above the HEAP wordmark's bounding box — the
      // logo text is wide enough that any lower placement gets covered by it.
      this.customizeHint = this.add.text(cx + 100, this.figureY -50, 'Try out the\nCharacter Customizer!\n<-------', {
        fontSize: '14px',
        fontStyle: 'italic',
        color: '#cc9966',
        stroke: '#000000',
        strokeThickness: 2,
      }).setOrigin(0, 0.5).setAlpha(0).setDepth(8);
    }
  }

  private startFigureBob(): void {
    this.tweens.add({
      targets: this.playerFigure,
      y: this.figureY - 4,
      duration: 1800,
      yoyo: true,
      loop: -1,
      ease: 'Sine.easeInOut',
    });
  }

  // ── Title ────────────────────────────────────────────────────────────────────

  private createTitle(): void {
    this.titleShadow = this.add.text(logicalWidth(this) / 2 + 4, 306, 'HEAP', {
      fontSize: '96px',
      fontStyle: 'bold',
      color: '#000000',
      stroke: '#000000',
      strokeThickness: 12,
    }).setOrigin(0.5).setAlpha(0).setDepth(6);

    this.titleText = this.add.text(logicalWidth(this) / 2, 300, 'HEAP', {
      fontSize: '96px',
      fontStyle: 'bold',
      color: '#ff9922',
      stroke: '#1a0800',
      strokeThickness: 8,
    }).setOrigin(0.5).setAlpha(0).setDepth(6);
  }

  // ── Tagline ──────────────────────────────────────────────────────────────────

  private createTagline(): void {
    this.taglineText = this.add.text(logicalWidth(this) / 2, 368, 'How high can you climb?', {
      fontSize: '18px',
      fontStyle: 'italic',
      color: '#cc9966',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(7);
  }

  // ── Floating clouds ──────────────────────────────────────────────────────────

  private createFloatingClouds(): void {
    const data: [number, number, number, boolean, number][] = [
      [logicalWidth(this), 80,  2.2, true,  18000],
      [300,  155, 1.4, true,  22000],
      [100,  220, 3.0, true,  28000],
      [-32,  310, 1.8, false, 20000],
      [200,  420, 1.2, true,  16000],
    ];
    const alphas = [0.55, 0.65, 0.5, 0.6, 0.7];
    data.forEach(([x, y, scale, goLeft, duration], i) => {
      this.spawnCloud(x, y, scale, goLeft, duration, alphas[i]);
    });
  }

  private spawnCloud(x: number, y: number, scaleVal: number, goLeft: boolean, duration: number, alpha: number): void {
    const gfx = this.add.graphics()
      .setAlpha(alpha)
      .setDepth(3)
      .setScrollFactor(0);

    drawCloudShape(gfx);
    gfx.setScale(scaleVal);
    gfx.setPosition(x, y);

    // Cloud shape spans ~120px wide — ensure it fully clears the screen edge
    const offscreen = 130 * scaleVal;
    const targetX = goLeft ? -offscreen : logicalWidth(this) + offscreen;
    const startX  = goLeft ? logicalWidth(this) + offscreen : -offscreen;

    this.tweens.add({
      targets: gfx,
      x: targetX,
      duration,
      ease: 'Linear',
      repeat: -1,
      onRepeat: () => { gfx.setX(startX); },
    });
  }

  // ── Balance ──────────────────────────────────────────────────────────────────

  private createBalanceText(): void {
    const shift = this.layoutShift;
    const y = Math.max(688 - shift, Math.min(logicalHeight(this) - 134, 756));
    this.balanceText = this.add.text(logicalWidth(this) / 2, y, `${getBalance()} coins`, {
      fontSize: '16px',
      color: '#ffdd77',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(8);
  }

  private createPlayerName(): void {
    const name  = getPlayerName();
    const shift = this.layoutShift;
    const nameY = Math.max(710 - shift, Math.min(logicalHeight(this) - 106, 778));

    const isGpgs   = getGpgsPlayerId() !== null;
    const label    = isGpgs ? `${name}  ▶ Play Games` : `${name}  [edit]`;
    const onTap    = isGpgs
      ? () => PlayGamesClient.showPlayerProfile()
      : () => this.openNameDialog();

    this.playerNameText = this.add.text(
      logicalWidth(this) / 2, nameY,
      label,
      {
        fontSize:        '13px',
        fontFamily:      'monospace',
        color:           '#8899aa',
        stroke:          '#000000',
        strokeThickness: 1,
      },
    ).setOrigin(0.5).setAlpha(0).setDepth(8)
     .setInteractive({ useHandCursor: true });

    this.playerNameText.on('pointerover', () => this.playerNameText.setColor('#aabbcc'));
    this.playerNameText.on('pointerout',  () => this.playerNameText.setColor('#8899aa'));
    this.playerNameText.on('pointerup',   onTap);
  }

  /**
   * Gate ALL Phaser input for this scene while a DOM modal (name editor, redeem
   * dialog) is open. `this.input.enabled` only covers the pointer plugin; the
   * menu's keyboard shortcuts live on `this.input.keyboard`, which has its own
   * `enabled` flag — without muting it, typing a code (e.g. "LAUNCH") fires
   * U→Upgrades, S→Store, H→HeapSelect, L→Leaderboard, etc. behind the modal.
   * The DOM <input> has its own listeners and keeps working regardless.
   */
  private setMenuInputEnabled(enabled: boolean): void {
    this.input.enabled = enabled;
    if (this.input.keyboard) this.input.keyboard.enabled = enabled;
  }

  private openNameDialog(): void {
    const current = getPlayerName();

    // On mobile the soft keyboard covers the lower half of the screen, so anchor
    // the panel near the top (top ~50%) instead of vertically centring it.
    const isMobile = InputManager.getInstance().isMobile;

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
      'display:flex', `align-items:${isMobile ? 'flex-start' : 'center'}`, 'justify-content:center',
      'z-index:9999', 'font-family:monospace',
      isMobile ? 'padding-top:6vh' : '',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:#0d0d20', 'border:2px solid #ff9922', 'border-radius:12px',
      'padding:28px 22px 22px', 'text-align:center', 'width:300px',
      'box-shadow:0 0 32px rgba(255,153,34,0.18)', 'box-sizing:border-box',
    ].join(';');

    const heap = document.createElement('div');
    heap.style.cssText = 'color:#ff9922;font-size:13px;font-weight:bold;letter-spacing:3px;margin-bottom:6px';
    heap.textContent = 'HEAP';

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'color:#cc9966;font-size:14px;font-style:italic;margin-bottom:22px';
    subtitle.textContent = 'What do they call you?';

    const input = document.createElement('input');
    input.maxLength = MAX_PLAYER_NAME_LEN;
    input.value = current;
    input.style.cssText = [
      'width:100%', 'box-sizing:border-box', 'background:transparent', 'border:none',
      'border-bottom:2px solid #ff9922', 'color:#ffffff', 'font-size:20px',
      'text-align:center', 'padding:6px 0 8px', 'font-family:monospace',
      'outline:none', 'margin-bottom:6px',
    ].join(';');

    const counterRow = document.createElement('div');
    counterRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:6px';
    const counter = document.createElement('span');
    counter.style.cssText = 'color:#556677;font-size:10px';
    counter.textContent = `${current.length} / ${MAX_PLAYER_NAME_LEN}`;
    counterRow.appendChild(counter);

    const errorMsg = document.createElement('div');
    errorMsg.style.cssText = 'min-height:16px;font-size:12px;margin-bottom:14px;color:#ff9988;visibility:hidden';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'CONFIRM';
    confirmBtn.style.cssText = [
      'width:100%', 'padding:13px', 'background:#ff9922', 'border:none',
      'border-radius:8px', 'color:#0a0818', 'font-size:15px', 'font-weight:bold',
      'font-family:monospace', 'letter-spacing:1px', 'cursor:pointer', 'margin-bottom:10px',
    ].join(';');

    const cancelEl = document.createElement('div');
    cancelEl.textContent = 'cancel';
    cancelEl.style.cssText = 'color:#556677;font-size:12px;cursor:pointer;letter-spacing:1px';

    panel.append(heap, subtitle, input, counterRow, errorMsg, confirmBtn, cancelEl);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.setMenuInputEnabled(false);

    const close = (): void => {
      this.setMenuInputEnabled(true);
      document.body.removeChild(overlay);
    };

    const NAME_ERROR_COPY: Record<'empty' | 'too-long' | 'profanity', string> = {
      empty:     'Name cannot be empty',
      'too-long': `Max ${MAX_PLAYER_NAME_LEN} characters`,
      profanity: "That name isn't allowed",
    };

    const confirm = (): void => {
      const validated = validatePlayerName(input.value);
      if (!validated.ok) {
        errorMsg.textContent = NAME_ERROR_COPY[validated.reason];
        errorMsg.style.visibility = 'visible';
        return;
      }
      setPlayerName(validated.name);
      this.playerNameText.setText(`${getPlayerName()}  [edit]`);
      void PlayerNameClient.updateName(getEffectivePlayerId(), validated.name);
      close();
    };

    input.addEventListener('input', () => {
      const len = input.value.length;
      counter.textContent = `${len} / ${MAX_PLAYER_NAME_LEN}`;
      counter.style.color = len >= 19 ? '#ff4444' : '#556677';
      errorMsg.style.visibility = 'hidden';
    });

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter')  confirm();
      if (e.key === 'Escape') close();
      // A DOM overlay owns its own keys. Phaser's keyboard plugin listens on
      // window, so without this the same Escape also reaches whichever scene is
      // on top — SettingsScene closes on Escape, so cancelling the code entry
      // would drop the player out of Settings entirely.
      if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation();
    });

    confirmBtn.addEventListener('click', confirm);
    cancelEl.addEventListener('click', close);
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) close();
    });

    requestAnimationFrame(() => input.focus());
  }

  private openRedeemDialog(onResult: (result: RedeemResult) => void): void {
    // On mobile the soft keyboard covers the lower half of the screen, so anchor
    // the panel near the top (top ~50%) instead of vertically centring it.
    const isMobile = InputManager.getInstance().isMobile;

    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
      'display:flex', `align-items:${isMobile ? 'flex-start' : 'center'}`, 'justify-content:center',
      'z-index:9999', 'font-family:monospace',
      isMobile ? 'padding-top:6vh' : '',
    ].join(';');

    const panel = document.createElement('div');
    panel.style.cssText = [
      'background:#0d0d20', 'border:2px solid #4488ff', 'border-radius:12px',
      'padding:28px 22px 22px', 'text-align:center', 'width:300px',
      'box-shadow:0 0 32px rgba(68,136,255,0.18)', 'box-sizing:border-box',
    ].join(';');

    const heap = document.createElement('div');
    heap.style.cssText = 'color:#4488ff;font-size:13px;font-weight:bold;letter-spacing:3px;margin-bottom:6px';
    heap.textContent = 'REDEEM CODE';

    const subtitle = document.createElement('div');
    subtitle.style.cssText = 'color:#6699cc;font-size:14px;font-style:italic;margin-bottom:22px';
    subtitle.textContent = 'Enter a reward code';

    const input = document.createElement('input');
    input.maxLength = 32;
    input.autocapitalize = 'characters';
    input.style.cssText = [
      'width:100%', 'box-sizing:border-box', 'background:transparent', 'border:none',
      'border-bottom:2px solid #4488ff', 'color:#ffffff', 'font-size:20px',
      'text-align:center', 'padding:6px 0 8px', 'font-family:monospace',
      'outline:none', 'margin-bottom:18px', 'text-transform:uppercase',
    ].join(';');

    const msg = document.createElement('div');
    msg.style.cssText = 'min-height:16px;font-size:12px;margin-bottom:14px;color:#88aacc';

    const confirmBtn = document.createElement('button');
    confirmBtn.textContent = 'REDEEM';
    confirmBtn.style.cssText = [
      'width:100%', 'padding:13px', 'background:#4488ff', 'border:none',
      'border-radius:8px', 'color:#0a0818', 'font-size:15px', 'font-weight:bold',
      'font-family:monospace', 'letter-spacing:1px', 'cursor:pointer', 'margin-bottom:10px',
    ].join(';');

    const cancelEl = document.createElement('div');
    cancelEl.textContent = 'close';
    cancelEl.style.cssText = 'color:#556677;font-size:12px;cursor:pointer;letter-spacing:1px';

    panel.append(heap, subtitle, input, msg, confirmBtn, cancelEl);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);
    this.setMenuInputEnabled(false);

    const close = (): void => {
      this.setMenuInputEnabled(true);
      if (overlay.parentNode) document.body.removeChild(overlay);
    };

    let busy = false;
    const submit = async (): Promise<void> => {
      if (busy) return;
      busy = true;
      confirmBtn.disabled = true;
      msg.style.color = '#88aacc';
      msg.textContent = 'Redeeming…';
      const result = await redeemCode(input.value);
      onResult(result);
      if (result.status === 'success') {
        // Reward already written to local SaveData — push it to the cloud now so
        // a stale snapshot can't clobber the redeemed coins/items on next launch.
        syncSaveToCloud();
        msg.style.color = '#88ff88';
        msg.textContent = result.message;
        setTimeout(close, 900);
      } else {
        msg.style.color = '#ff9988';
        msg.textContent = result.message;
        busy = false;
        confirmBtn.disabled = false;
      }
    };

    input.addEventListener('keydown', (e: KeyboardEvent) => {
      if (e.key === 'Enter')  void submit();
      if (e.key === 'Escape') close();
      // See openNameDialog: stop the key reaching Phaser's window-level listener,
      // or this Escape closes SettingsScene as well as this dialog.
      if (e.key === 'Enter' || e.key === 'Escape') e.stopPropagation();
    });
    confirmBtn.addEventListener('click', () => void submit());
    cancelEl.addEventListener('click', close);
    overlay.addEventListener('click', (e: MouseEvent) => {
      if (e.target === overlay) close();
    });

    requestAnimationFrame(() => input.focus());
  }

  // ── Start / Upgrade prompts ──────────────────────────────────────────────────

  private createPrompts(im: InputManager): void {
    const shift = this.layoutShift;

    // Start button
    this.startBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.startBg.fillStyle(0x000000, 0.5);
    this.startBg.fillRoundedRect(logicalWidth(this) / 2 - 160, 540 - shift, 320, 56, 12);
    this.startBg.lineStyle(2, 0x8899bb, 0.8);
    this.startBg.strokeRoundedRect(logicalWidth(this) / 2 - 160, 540 - shift, 320, 56, 12);

    this.startText = this.add.text(logicalWidth(this) / 2, 570 - shift, 'START RUN', {
      fontSize: '24px',
      fontStyle: 'bold',
      color: '#ffffff',
      stroke: '#000000',
      strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0).setDepth(9);

    // Upgrades + Store — side by side, same total width as Start Run (320px)
    // Each button: (320 - 8 gap) / 2 = 156px
    const subBtnW  = 156;
    const subBtnH  = 56;
    const subBtnGap = 8;
    const subLeft  = logicalWidth(this) / 2 - 160;        // same left edge as Start Run
    const subY     = 612 - shift;
    const subCY    = subY + subBtnH / 2;

    this.upgradeBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.upgradeBg.fillStyle(0x000000, 0.5);
    this.upgradeBg.fillRoundedRect(subLeft, subY, subBtnW, subBtnH, 12);
    this.upgradeBg.lineStyle(2, 0x8899bb, 0.6);
    this.upgradeBg.strokeRoundedRect(subLeft, subY, subBtnW, subBtnH, 12);

    this.upgradeText = this.add.text(subLeft + subBtnW / 2, subCY, 'UPGRADES', {
      fontSize: '20px',
      color: '#ffdd44',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(9);

    this.storeBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.storeBg.fillStyle(0x000000, 0.5);
    this.storeBg.fillRoundedRect(subLeft + subBtnW + subBtnGap, subY, subBtnW, subBtnH, 12);
    this.storeBg.lineStyle(2, 0x8899bb, 0.6);
    this.storeBg.strokeRoundedRect(subLeft + subBtnW + subBtnGap, subY, subBtnW, subBtnH, 12);

    this.storeText = this.add.text(subLeft + subBtnW + subBtnGap + subBtnW / 2, subCY, 'STORE', {
      fontSize: '20px',
      color: '#44ffaa',
      stroke: '#000000',
      strokeThickness: 2,
    }).setOrigin(0.5).setAlpha(0).setDepth(9);

    // The joystick is already the active mode whenever tilt is pending permission
    // (settled in main.ts before any scene starts), so this only decides which
    // affordance to surface — never whether the player can move.
    const promptKind = tiltPromptKind(im, getControlMode());
    if (promptKind === 'blocked') {
      // Cross-origin iframe (e.g. itch.io): the tilt-permission dialog can never
      // appear, so don't offer it. Explain why the joystick is on instead — but
      // only once per session, or it re-fires on every return to the menu.
      if (!this.registry.get('tiltBlockedNoticeShown')) {
        this.registry.set('tiltBlockedNoticeShown', true);
        this.showControlNotice(
          'Joystick controls enabled — your browser blocks tilt steering. Change controls in Settings.',
        );
      }
    } else if (isTiltPendingPermission(im) && !im.tiltPermissionBlocked) {
      // Build the prompt whenever a grant is still reachable — INDEPENDENT of the
      // saved preference. Visibility is what the preference gates. Tying existence
      // to it would strand a player who saved 'joystick' (e.g. as a workaround for
      // this very bug): Settings → Tilt calls refreshTiltPrompt(), which can only
      // reveal a container that already exists.
      {
        const cx = logicalWidth(this) / 2;
        const mkBtn = (y: number, label: string, bg: string, color: string) =>
          this.add.text(cx, y, label, {
            fontSize: '17px',
            color,
            backgroundColor: bg,
            padding: { x: 14, y: 8 },
            stroke: '#000000',
            strokeThickness: 2,
          }).setOrigin(0.5).setInteractive({ useHandCursor: true });

        const enableBtn = mkBtn(logicalHeight(this) - 116, 'Enable Tilt Controls', '#2244aa', '#ffffff');
        const keepBtn   = mkBtn(logicalHeight(this) - 66,  'Keep Joystick Controls', '#1a1a2e', '#cccccc');

        enableBtn.on('pointerup', () => {
          this.registry.set('tiltPromptAnswered', true);
          im.requestTiltPermission().then((granted) => {
            this.setTiltPromptVisible(false);
            if (!granted) {
              this.showControlNotice('Tilt unavailable — joystick controls enabled. Change controls in Settings.');
              return;
            }
            // Deliberately do NOT switch to tilt here. The automatic override
            // lifts itself the instant a real orientation reading arrives
            // (InputManager.onFirstTiltData). If none ever does, the joystick
            // simply stays — so a player who taps START RUN before the check
            // completes can never end up in a scene with dead controls.
            this.time.delayedCall(TILT_WATCHDOG_MS, () => {
              if (im.tiltDataReceived) return;
              this.showControlNotice('Tilt unavailable — joystick controls enabled. Change controls in Settings.');
            });
          });
        });

        keepBtn.on('pointerup', () => {
          // Explicit dismiss: the joystick is already the active mode, so this only
          // hides the prompt. No "unavailable" toast — this is a choice, not a failure.
          this.registry.set('tiltPromptAnswered', true);
          this.setTiltPromptVisible(false);
        });

        const container = this.add.container(0, 0, [enableBtn, keepBtn]).setDepth(9).setAlpha(0);
        this.tweens.add({ targets: container, alpha: 1, duration: 300, delay: 2000 });
        this.tiltPrompt = container;
        // Offer it only until the player answers once — after that it is reachable
        // on demand via Settings → Tilt, rather than re-asking on every menu visit.
        this.setTiltPromptVisible(
          promptKind === 'permission' && this.registry.get('tiltPromptAnswered') !== true,
        );
      }
    }

    this.startTiltWatchdog(im);
  }

  /** Show/hide the tilt-prompt container and toggle its buttons' interactivity in
   *  step, so a hidden prompt can never receive taps. */
  private setTiltPromptVisible(visible: boolean): void {
    if (!this.tiltPrompt) return;
    this.tiltPrompt.setVisible(visible);
    for (const child of this.tiltPrompt.list) {
      const input = (child as Phaser.GameObjects.GameObject).input;
      if (input) input.enabled = visible;
    }
  }

  /** On mobile in tilt mode, auto-fall back to the joystick if device-tilt never
   *  delivers data — a device that reports a gyro but stays silent. Tilt that is
   *  merely awaiting an iOS permission grant is already on the joystick and needs
   *  no watchdog; this covers the case where the mode is live but the data isn't. */
  private startTiltWatchdog(im: InputManager): void {
    // No mode guard for pending permission is needed: tilt that can't deliver data
    // is already overridden to joystick at startup, so this returns on the first
    // check. It arms only when tilt is genuinely live (Android, or iOS post-grant),
    // which is exactly when a silent no-gyro device must still be caught.
    if (!im.isMobile || getEffectiveControlMode() !== 'tilt') return;
    this.time.delayedCall(TILT_WATCHDOG_MS, () => {
      if (getEffectiveControlMode() === 'tilt' && !im.tiltDataReceived) this.fallbackToJoystick();
    });
  }

  /** Switch to the joystick for this session (does NOT overwrite the saved pref),
   *  hide the tilt prompt, and briefly notify the player. */
  private fallbackToJoystick(
    message = 'Tilt unavailable — joystick controls enabled. Change controls in Settings.',
  ): void {
    if (getEffectiveControlMode() === 'joystick') return;
    setSessionControlMode('joystick');
    this.setTiltPromptVisible(false);
    this.showControlNotice(message);
  }

  /** Briefly surface a controls message just above the bottom of the menu. */
  private showControlNotice(message: string): void {
    const notice = this.add.text(logicalWidth(this) / 2, logicalHeight(this) - 94,
      message, {
        fontSize: '15px', color: '#ffd070', stroke: '#000000', strokeThickness: 2,
        align: 'center', wordWrap: { width: logicalWidth(this) - 40 },
      }).setOrigin(0.5).setDepth(10).setAlpha(0);
    this.tweens.add({ targets: notice, alpha: 1, duration: 250, hold: 2600, yoyo: true,
      onComplete: () => notice.destroy() });
  }

  // ── Heap picker ──────────────────────────────────────────────────────────

  private createHeapPicker(): void {
    const shift = this.layoutShift;
    const rowY  = 504 - shift;
    const left  = logicalWidth(this) / 2 - 160;

    // Heap-picker bar \u2014 left ~65% of the 320px row (208px), 8px gap, 48px trophy, 8px gap, 48px wardrobe.
    this.heapPickerBg = this.add.graphics().setDepth(8).setAlpha(0);
    this.heapPickerBg.fillStyle(0x000000, 0.5);
    this.heapPickerBg.fillRoundedRect(left, 480 - shift, 264, 48, 10);
    this.heapPickerBg.lineStyle(1, 0x8899bb, 0.6);
    this.heapPickerBg.strokeRoundedRect(left, 480 - shift, 264, 48, 10);

    this.heapPickerText = this.add.text(0, rowY, '', {
      fontSize: '16px', color: '#ffffff',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5).setAlpha(0).setDepth(9);

    this.heapPickerStars = this.add.text(0, rowY, '', {
      fontSize: '16px', color: '#ff9922',
      stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0, 0.5).setAlpha(0).setDepth(9);

    // Leaderboard trophy button \u2014 right 48px square of the row.
    const trophyLeft = left + 264 + 8;   // = width/2 + 112
    const trophyCx   = trophyLeft + 24;  // = width/2 + 136
    this.leaderboardBg = this.add.graphics().setDepth(8).setAlpha(0);
    const drawTrophyBg = (enabled: boolean): void => {
      this.leaderboardBg.clear();
      this.leaderboardBg.fillStyle(0x000000, 0.5);
      this.leaderboardBg.fillRoundedRect(trophyLeft, 480 - shift, 48, 48, 10);
      this.leaderboardBg.lineStyle(1, 0x8899bb, enabled ? 0.6 : 0.25);
      this.leaderboardBg.strokeRoundedRect(trophyLeft, 480 - shift, 48, 48, 10);
    };
    drawTrophyBg(false);
    this.leaderboardIcon = this.add.text(trophyCx, rowY, '\uD83C\uDFC6', {
      fontSize: '22px',
    }).setOrigin(0.5).setAlpha(0).setDepth(9);

    // Centre of the picker bar (text centres within the 208px bar, not the row).
    const barCx = left + 132;            // = width/2 - 28

    // Refresh from current registry \u2014 runs once now (placeholder if catalog is
    // still loading) and again when `heapCatalogReady` fires from BootScene.
    const refresh = (): void => {
      const ready  = this.game.registry.get('heapCatalogReady') === true;
      const params = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;

      const nameLabel  = ready ? `\u25BE ${params.name}  ` : 'Heaps loading\u2026';
      const starsLabel = ready ? formatDifficulty(params.difficulty) : '';

      this.heapPickerText.setText(nameLabel);
      this.heapPickerStars.setText(starsLabel);
      this.heapPickerText.setColor(ready ? '#ffffff' : '#778899');

      // Re-center both texts together each refresh \u2014 widths change with text.
      const totalW = this.heapPickerText.width + this.heapPickerStars.width;
      const startX = barCx - totalW / 2;
      this.heapPickerText.setX(startX);
      this.heapPickerStars.setX(startX + this.heapPickerText.width);

      drawTrophyBg(ready);
    };

    refresh();
    this.game.events.once('heapCatalogReady', refresh);

    // Picker tap zone \u2014 left 208px of the row \u2192 heap selector.
    this.add.zone(barCx, rowY, 208, 48)
      .setDepth(9).setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        if (this.game.registry.get('heapCatalogReady') !== true) return;
        this.scene.start('HeapSelectScene');
      });

    // Trophy tap zone \u2192 leaderboard for the active heap.
    this.add.zone(trophyCx, rowY, 48, 48)
      .setDepth(9).setInteractive({ useHandCursor: true })
      .on('pointerup', () => this.openLeaderboard());

  }

  /** Launch the leaderboard modal for the active heap, over a paused menu. */
  private openLeaderboard(): void {
    if (this.game.registry.get('heapCatalogReady') !== true) return;
    const heapId = (this.game.registry.get('activeHeapId') as string) ?? '';
    const params = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;
    this.scene.launch('LeaderboardScene', {
      heapId,
      heapName: params.name,
      playerId: getEffectivePlayerId(),
      returnScene: 'MenuScene',
    });
    this.scene.pause();
  }

  // ── Settings button ──────────────────────────────────────────────────────────

  private createHotkeyLegend(): void {
    const keys = [
      { key: 'Space', label: 'Start Run' },
      { key: 'U',     label: 'Upgrades'  },
      { key: 'S',     label: 'Store'     },
      { key: 'H',     label: 'Heap'      },
      { key: 'W',     label: 'Trash Stash' },
      { key: 'L',     label: 'Leaderboard' },
    ];
    const parts = keys.map(k => `${k.key}: ${k.label}`).join('   ');
    this.add.text(logicalWidth(this) / 2, logicalHeight(this) - 52, parts, {
      fontSize:      '11px',
      fontFamily:    'monospace',
      color:         '#667799',
      letterSpacing: 1,
    }).setOrigin(0.5, 0.5).setDepth(9);
  }

  private createSettingsButton(): void {
    const bx = logicalWidth(this) - 22;
    const by = 22;

    const btnGfx = this.add.graphics().setDepth(20);
    btnGfx.fillStyle(0x000000, 0.65);
    btnGfx.fillCircle(bx, by, 14);
    btnGfx.lineStyle(2, 0x8899bb, 1);
    btnGfx.strokeCircle(bx, by, 14);
    this.add.text(bx, by, '\u2630', { fontSize: '16px', color: '#ffffff', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3 }).setOrigin(0.5).setDepth(20);
    const hitZone = this.add.zone(bx, by, 36, 36).setDepth(20).setInteractive({ useHandCursor: true });

    hitZone.on('pointerup', () => this.openSettings());
    if (this._forceSettingsOpen) this.time.delayedCall(2200, () => this.openSettings());
  }

  /** Launch the shared Settings modal over the menu. SettingsScene pauses this
   *  scene while it is up and resumes it on close, so the menu's own buttons
   *  cannot be tapped through the dim. */
  private openSettings(): void {
    if (this.scene.isActive('SettingsScene')) return; // guard against double-open
    this.scene.launch('SettingsScene', {
      returnTo: this.scene.key,
      context:  'menu',
      resetWarning: 'Clears all coins, upgrades\nand placed blocks.',
      rows: [
        {
          label: 'REDEEM CODE',
          onTap: (setResult: (msg: string, ok: boolean) => void) => {
            this.openRedeemDialog((result) => {
              setResult(result.message, result.status === 'success');
              if (result.status === 'success' && result.reward?.rewardType === 'coins') {
                this.balanceText.setText(`${getBalance()} coins`);
              }
            });
          },
        },
        {
          label: 'HOW TO PLAY',
          color: { fill: 0x2a2a4c, stroke: 0x8888cc, text: '#ccccff' },
          // Close through the modal, not scene.stop(), so its teardown runs and
          // this scene is resumed before we navigate away from it.
          onTap: (_setResult: (msg: string, ok: boolean) => void, close: () => void) => {
            close();
            this.scene.start('TutorialScene');
          },
        },
      ],
      // Toggling control mode changes whether the tilt-permission prompt behind
      // the modal applies, so re-evaluate it whenever Settings touches controls.
      onControlsChanged: () => {
        this.setTiltPromptVisible(
          tiltPromptKind(InputManager.getInstance(), getEffectiveControlMode()) === 'permission',
        );
      },
      onReset: () => { this.scene.restart(); },
    } satisfies SettingsSceneData);
  }


  private createFeedbackButton(): void {
    const label = this.add.text(14, 22, 'Send Feedback', {
      fontFamily: 'monospace',
      fontSize: '15px',
      fontStyle: 'normal',
      color: '#a34930',
    }).setOrigin(0, 0.5).setDepth(20);

    label.setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        this.setMenuInputEnabled(false);
        openFeedbackOverlay({
          heapId: null,
          onClose: () => this.setMenuInputEnabled(true),
        });
      });
  }

  // ── Version label ────────────────────────────────────────────────────────────

  private createVersionLabel(): void {
    const version = import.meta.env.VITE_APP_VERSION ?? '0.0.0';
    // Release builds show just the version; dev builds append a git hash + build
    // time (injected per page-load by the dev-build-id Vite plugin into
    // window.__BUILD_ID__) so it's obvious at a glance which build is on the device.
    const label = import.meta.env.DEV
      ? `V${version} · ${window.__BUILD_ID__ ?? 'dev'}`
      : `V${version}`;
    this.add.text(8, logicalHeight(this) - 6, label, {
      fontSize:   '11px',
      fontFamily: 'monospace',
      color:      '#556677',
      stroke:     '#000000',
      strokeThickness: 2,
    }).setOrigin(0, 1).setDepth(20).setScrollFactor(0);
  }

  // ── Entrance animation ───────────────────────────────────────────────────────

  private runEntranceSequence(): void {
    // Play the full cinematic once per app-session; compress every return to the
    // menu (from Game/Upgrade/Store) into a brief window. The registry flag lives
    // for the game instance's lifetime and resets on a true page reload.
    const firstTime = this.game.registry.get('menuIntroSeen') !== true;
    this.game.registry.set('menuIntroSeen', true);
    const s = entranceScale(firstTime);

    this.tweens.add({ targets: this.farSilhouette,  alpha: 1,    duration: 600 * s, delay: 0          });
    this.tweens.add({ targets: this.nearSilhouette, alpha: 1,    duration: 600 * s, delay: 300  * s   });
    this.tweens.add({ targets: this.horizonGlow,    alpha: 1,    duration: 400 * s, delay: 600  * s   });
    this.tweens.add({ targets: this.playerFigure,   alpha: 0.85, duration: 500 * s, delay: 700  * s   });
    if (this.customizeHint) {
      this.tweens.add({ targets: this.customizeHint, alpha: 0.8, duration: 500 * s, delay: 1200 * s });
    }
    this.tweens.add({ targets: this.titleShadow,    alpha: 0.65, duration: 400 * s, delay: 900  * s   });
    this.tweens.add({ targets: this.titleText,      alpha: 1,    duration: 500 * s, delay: 1000 * s   });
    this.tweens.add({ targets: this.taglineText,    alpha: 1,    duration: 400 * s, delay: 1300 * s   });
    this.tweens.add({ targets: [this.balanceText, this.playerNameText], alpha: 1, duration: 300 * s, delay: 1500 * s });
    this.tweens.add({ targets: [this.heapPickerBg, this.heapPickerText, this.heapPickerStars, this.leaderboardBg, this.leaderboardIcon], alpha: 1, duration: 300 * s, delay: 1600 * s });
    this.tweens.add({ targets: this.startBg,   alpha: 1, duration: 400 * s, delay: 1700 * s });
    this.tweens.add({
      targets: this.startText,
      alpha: 1,
      duration: 400 * s,
      delay: 1700 * s,
      onComplete: () => this.startPulse(),
    });
    this.tweens.add({ targets: this.upgradeBg,   alpha: 1, duration: 300 * s, delay: 1900 * s });
    this.tweens.add({ targets: this.upgradeText, alpha: 1, duration: 300 * s, delay: 1900 * s });
    this.tweens.add({ targets: this.storeBg,   alpha: 1, duration: 300 * s, delay: 2000 * s });
    this.tweens.add({ targets: this.storeText, alpha: 1, duration: 300 * s, delay: 2000 * s });

    this.time.delayedCall(2100 * s, () => this.startTwinkle());

    // Player idle bob (start immediately — subtle at 0 alpha, becomes visible with fade)
    this.startFigureBob();
  }

  private startPulse(): void {
    this.tweens.add({
      targets: this.startText,
      alpha: { from: 1.0, to: 0.35 },
      duration: 900,
      yoyo: true,
      loop: -1,
      ease: 'Sine.easeInOut',
    });
  }

  private startTwinkle(): void {
    for (const star of this.twinkleStars) {
      this.tweens.add({
        targets: star,
        alpha: { from: 0.9, to: 0.15 },
        duration: Phaser.Math.Between(1200, 2800),
        yoyo: true,
        loop: -1,
        delay: Phaser.Math.Between(0, 2000),
      });
    }
  }

  // ── Input ────────────────────────────────────────────────────────────────────

  private registerInput(): void {
    this.time.delayedCall(100, () => {
      const startGame = (): void => {
        if (this.game.registry.get('gameAssetsReady') !== true) return;
        const activeHeapId  = (this.game.registry.get('activeHeapId') as string) ?? '';
        const activeParams  = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;
        if (activeParams.isInfinite) {
          this.scene.start('InfiniteGameScene');
          return;
        }
        const hasCheckpoint = getPlaced(activeHeapId).some(
          p => p.id === 'checkpoint' && (p.meta?.spawnsLeft ?? 0) > 0,
        );
        this.scene.start('GameScene', hasCheckpoint ? { useCheckpoint: true } : undefined);
      };

      const refreshStartLabel = (): void => {
        const ready = this.game.registry.get('gameAssetsReady') === true;
        this.startText.setText(ready ? 'START RUN' : 'LOADING…');
        this.startText.setColor(ready ? '#ffffff' : '#778899');
      };

      refreshStartLabel();
      this.game.events.once('gameAssetsReady', refreshStartLabel);

      // .on (not .once) for SPACE — startGame early-returns while gameAssetsReady
      // is false, and .once would burn the binding on any pre-ready press,
      // leaving the player unable to start with the keyboard until they
      // navigated away and back. Same logic as the pointerup handler below.
      this.input.keyboard!.on('keydown-SPACE', startGame);
      this.input.keyboard!.once('keydown-U',     () => this.scene.start('UpgradeScene'));
      this.input.keyboard!.once('keydown-F2',    () => this.scene.start('TexturePreviewScene'));
      this.input.keyboard!.once('keydown-W',     () => this.scene.start('CustomizationScene'));

      this.startText.setInteractive(
        new Phaser.Geom.Rectangle(-200, -40, 400, 80),
        Phaser.Geom.Rectangle.Contains,
      );
      this.startText.on('pointerup', startGame);  // .on, not .once — START stays armed across the LOADING→READY transition

      this.upgradeText.setInteractive(
        new Phaser.Geom.Rectangle(-78, -28, 156, 56),
        Phaser.Geom.Rectangle.Contains,
      );
      this.upgradeText.once('pointerup', () => this.scene.start('UpgradeScene'));

      this.storeText.setInteractive(
        new Phaser.Geom.Rectangle(-78, -28, 156, 56),
        Phaser.Geom.Rectangle.Contains,
      );
      this.storeText.once('pointerup', () => this.scene.start('StoreScene'));

      this.input.keyboard!.once('keydown-S', () => this.scene.start('StoreScene'));
      this.input.keyboard!.once('keydown-H', () => this.scene.start('HeapSelectScene'));
      this.input.keyboard!.once('keydown-L', () => this.openLeaderboard());
    });
  }

  // ── Daily Drop ─────────────────────────────────────────────────────────────

  private async setupDailyDrop(): Promise<void> {
    this.clearDailyCanIcon();
    const result = await fetchDailyStatus();
    if (!this.scene.isActive()) return; // player already navigated away
    const status = result.status === 'ok' ? result.data : null;
    const played = hasPlayedToday(deviceUtcOffsetMin());
    const state = dailyIconState(status, played);
    if (state === 'hidden') return;

    this.addDailyCanIcon(state, status);

    const POPUP_KEY = 'heap_daily_popup_shown';
    const todayKey = localDateKey(Date.now(), deviceUtcOffsetMin());
    if (status && shouldAutoShowPopup(state, localStorage.getItem(POPUP_KEY), todayKey)) {
      localStorage.setItem(POPUP_KEY, todayKey);
      this.openDaily(status);
    }
  }

  /** Tear down the can and its countdown together — the tick closes over the
   *  label, so orphaning one leaks into the next render. */
  private clearDailyCanIcon(): void {
    this.dailyTick?.remove();
    this.dailyTick = undefined;
    this.dailyCanIcon?.destroy();
    this.dailyCanIcon = undefined;
  }

  /** Re-render the can when the countdown reaches zero. Reads the cached
   *  status — the snapshot has not changed, only `now` has, so this costs no
   *  network call. */
  private refreshDailyDrop(): void {
    this.clearDailyCanIcon();
    void this.setupDailyDrop();
  }

  private addDailyCanIcon(state: DailyIconState, status: DailyStatusResponse | null): void {
    const x = 36;
    const y = 96;
    const icon = this.add.container(x, y).setDepth(20);

    const g = this.add.graphics();
    const bodyColor = state === 'ready' ? 0x8d96ad : 0x565d70;
    g.fillStyle(0x0a0c1a, 0.55);
    g.fillRoundedRect(-22, -22, 44, 44, 10);
    g.lineStyle(1, 0xffffff, 0.18);
    g.strokeRoundedRect(-22, -22, 44, 44, 10);
    g.fillStyle(bodyColor, 1);
    g.fillRoundedRect(-9, -6, 18, 18, 3);   // can body
    g.fillRoundedRect(-12, -11, 24, 5, 2);  // lid
    icon.add(g);

    if (state === 'ready') {
      const badge = this.add.circle(16, -16, 8, 0xff9922).setStrokeStyle(1, 0xb3650f);
      const bang = this.add.text(16, -16, '!', {
        fontSize: '12px', color: '#1a0f00', fontStyle: 'bold',
      }).setOrigin(0.5);
      icon.add([badge, bang]);
      this.tweens.add({
        targets: icon, angle: { from: -4, to: 4 }, duration: 130,
        yoyo: true, repeat: -1, repeatDelay: 1600,
      });
    } else if (state === 'waiting') {
      const label = this.add.text(0, 26, '', {
        fontSize: '10px', color: '#c8cee0', fontStyle: 'bold',
      }).setOrigin(0.5);
      icon.add(label);
      const until = status?.nextEligibleAt ?? 0;
      const paint = (): void => {
        if (!this.scene.isActive()) return;
        const left = until - Date.now();
        if (left <= 0) { this.refreshDailyDrop(); return; }
        label.setText(formatCountdown(left));
      };
      paint();
      this.dailyTick = this.time.addEvent({ delay: 15_000, loop: true, callback: paint });
    } else if (state === 'locked') {
      const lock = this.add.text(16, -16, '🔒', { fontSize: '12px' }).setOrigin(0.5);
      icon.add(lock);
    } else { // offline
      icon.setAlpha(0.5);
    }

    const zone = this.add.zone(0, 0, 48, 48).setInteractive({ useHandCursor: true });
    icon.add(zone);
    zone.on('pointerup', () => {
      if (state === 'ready' && status) { this.openDaily(status); return; }
      // Locked: previews the streak track + today's reward (spec) rather than
      // just telling the player to come back — no claim path from here.
      if (state === 'locked' && status) { this.openDailyLockedPreview(status, 'locked'); return; }
      if (state === 'waiting' && status) { this.openDailyLockedPreview(status, 'waiting'); return; }
      this.showDailyToast('Offline — rewards need a connection');
    });

    this.dailyCanIcon = icon;
  }

  private openDaily(status: DailyStatusResponse): void {
    openDailyDropOverlay(this, status, (claimed) => {
      if (!claimed) return;
      this.clearDailyCanIcon();
      if (this.balanceText?.active) this.balanceText.setText(`${getBalance()} coins`);
    });
  }

  /** Preview with no claim path. A waiting preview re-renders the can on close:
   *  the countdown can reach zero while the overlay is up, and waiting for the
   *  next 15s tick would leave a stale "<1m" can behind it. Reads the cached
   *  status, so the refresh costs no request. */
  private openDailyLockedPreview(status: DailyStatusResponse, mode: 'locked' | 'waiting'): void {
    openDailyDropOverlay(this, status, () => {
      if (mode === 'waiting') this.refreshDailyDrop();
    }, mode);
  }

  private showDailyToast(msg: string): void {
    const t = this.add.text(36, 132, msg, {
      fontSize: '13px', color: '#ffce8a', stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0, 0.5).setDepth(21);
    this.tweens.add({ targets: t, alpha: 0, delay: 1800, duration: 400, onComplete: () => t.destroy() });
  }
}
