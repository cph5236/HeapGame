import Phaser from 'phaser';
import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { loadGameAssets } from './loadGameAssets';
import { preloadProgress, preloadComplete } from '../systems/infinitePreload';
import { configReady, hasConfig } from '../systems/ConfigClient';
import { isUpdateRequired, shouldConfirmUpdateGate } from '../systems/UpdateGate';
import { paintSkyGradient } from '../ui/skyGradient';
import { MENU_LOADING_MIN_MS } from '../constants';

// Themed boot loading screen. Blocks MenuScene/TutorialScene until the game's
// image/audio assets have finished loading, so the menu paints fully-built instead
// of hitching as assets stream in behind it. The flair: the heap literally piles up
// as loading progresses, with the trash-bag hero riding the growing crest — a
// pocket version of the game's own "grow the heap" fantasy.
//
// Palette matches InfiniteLoadingOverlay (earthy dirt + gold) so the two loaders
// read as one system. Authored in logical (CSS-pixel) coords via setupUiCamera.
// The sky itself lives in ui/skyGradient.ts, shared with UpdateRequiredScene.

const MOUND_BACK     = 0x1c130c; // dark heap silhouetted against the warm horizon
const MOUND_FRONT    = 0x281b10;
const MOUND_RIM      = 0x6e4e30; // warm rim catching the sunset light
const BAR_BG_COLOR   = 0x241a12;
const BAR_FILL_COLOR = 0xffb03a; // warm gold, keyed to the menu title orange
const TITLE_COLOR    = '#ff9922'; // matches MenuScene title
const TITLE_STROKE   = '#1a0800';
const TAGLINE_COLOR  = '#cc9966'; // matches MenuScene tagline

const CAPTIONS = [
  'Building the heap',
  'Sorting the trash',
  'Stacking the pile',
  'Digging through the junk',
];

/** Points along a smooth sine-bump hill, left→crest→right, at height H. */
function hillPoints(cx: number, baseY: number, halfW: number, height: number, steps = 24): Phaser.Types.Math.Vector2Like[] {
  const pts: Phaser.Types.Math.Vector2Like[] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    pts.push({ x: cx - halfW + 2 * halfW * t, y: baseY - height * Math.sin(Math.PI * t) });
  }
  return pts;
}

export class LoadingScene extends Phaser.Scene {
  private nextScene = 'MenuScene';
  private startTime = 0;
  private loaderFrac = 0;
  private loaderDone = false;
  private shownFrac = 0;      // eased display fraction (smooth growth)
  private transitioning = false;
  /** Boot-time remote-config fetch has settled (or hit its timeout ceiling). */
  private configSettled = false;
  /** Dev-only: hold the screen at a fixed progress for scene-preview screenshots. */
  private freeze: number | null = null;

  private mounds!: Phaser.GameObjects.Graphics;
  private hero!: Phaser.GameObjects.Image;
  private fillBar!: Phaser.GameObjects.Rectangle;
  private glowBar!: Phaser.GameObjects.Rectangle;
  private percentText!: Phaser.GameObjects.Text;

  private cx = 0;
  private baseY = 0;
  private moundMaxH = 0;
  private moundHalfW = 0;
  private heroBob = 0;

  constructor() {
    super({ key: 'LoadingScene' });
  }

  init(data: { next?: string; freeze?: number }): void {
    this.nextScene     = data?.next ?? 'MenuScene';
    this.startTime     = 0;
    this.loaderFrac    = 0;
    this.loaderDone    = false;
    this.shownFrac     = 0;
    this.transitioning = false;
    this.configSettled = false;
    this.heroBob       = 0;
    this.freeze        = import.meta.env.DEV && typeof data?.freeze === 'number'
      ? Phaser.Math.Clamp(data.freeze, 0, 1) : null;
  }

  create(): void {
    setupUiCamera(this);
    const w = logicalWidth(this);
    const h = logicalHeight(this);
    this.cx = w / 2;

    // ── Backdrop: the game's night-sky → sunset gradient, plus faint stars ────
    paintSkyGradient(this, w, h);

    this.baseY      = h;               // heap grows up from the very bottom of the screen
    this.moundMaxH  = Math.min(h * 0.5, w * 0.7);
    this.moundHalfW = w * 0.62;         // wide enough to fill the bottom edge-to-edge

    // Drifting dust motes rising off the pile.
    this.spawnDustFlecks(w);

    // The growing heap (redrawn each frame in update()).
    this.mounds = this.add.graphics();

    // ── Hero: the trash-bag, riding the crest ────────────────────────────────
    this.hero = this.add.image(this.cx, this.baseY, 'trashbag').setOrigin(0.5, 1);
    const heroScale = Math.min(1, (this.moundMaxH * 0.42) / Math.max(1, this.hero.height));
    this.hero.setScale(heroScale);
    this.tweens.add({
      targets: this.hero, angle: { from: -5, to: 5 },
      duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut',
    });

    // ── Title + animated caption (same font/styling as the menu) ─────────────
    const titleY = h * 0.18;
    // Offset drop shadow, mirroring MenuScene.createTitle.
    this.add.text(this.cx + 4, titleY + 6, 'HEAP', {
      fontSize: '84px', fontStyle: 'bold', color: '#000000', stroke: '#000000', strokeThickness: 12,
    }).setOrigin(0.5);
    this.add.text(this.cx, titleY, 'HEAP', {
      fontSize: '84px', fontStyle: 'bold', color: TITLE_COLOR, stroke: TITLE_STROKE, strokeThickness: 8,
    }).setOrigin(0.5);

    const caption = CAPTIONS[Math.floor(Math.random() * CAPTIONS.length)];
    const captionText = this.add.text(this.cx, titleY + 60, caption, {
      fontSize: '18px', fontStyle: 'italic', color: TAGLINE_COLOR, stroke: '#000000', strokeThickness: 2,
    }).setOrigin(0.5);
    let dots = 0;
    this.time.addEvent({
      delay: 350, loop: true,
      callback: () => { dots = (dots + 1) % 4; captionText.setText(caption + '.'.repeat(dots)); },
    });

    // ── Progress bar + percent (in front of the heap, glowing for readability) ─
    const barW = Math.round(w * 0.62);
    const barH = 14;
    const barY = h * 0.9;
    // Dark contrast backing so the bar reads over the dark heap silhouette.
    this.add.rectangle(this.cx, barY, barW + 20, barH + 22, 0x000000, 0.4).setDepth(9);
    // Soft gold halo behind the fill — a renderer-agnostic "glow".
    this.glowBar = this.add.rectangle(this.cx - barW / 2, barY, barW, barH + 14, BAR_FILL_COLOR, 0.25)
      .setOrigin(0, 0.5).setDepth(9).setScale(0, 1);
    // Track with a white outline so the empty portion stays visible too.
    this.add.rectangle(this.cx, barY, barW, barH, BAR_BG_COLOR, 1)
      .setStrokeStyle(2, 0xffffff, 0.9).setDepth(10);
    this.fillBar = this.add.rectangle(this.cx - barW / 2, barY, barW, barH, BAR_FILL_COLOR, 1)
      .setOrigin(0, 0.5).setDepth(11).setScale(0, 1);
    this.percentText = this.add.text(this.cx, barY + 26, '0%', {
      fontFamily: 'sans-serif', fontSize: '14px', color: '#fff2d0', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5).setDepth(11);

    // Only *wait* on the boot config fetch when there's nothing to fall back on
    // (first-ever launch). BootScene already warmed the cache synchronously from
    // last-known-good before starting this scene, so if hasConfig() is true a
    // usable value is live — open the menu now and let the fetch refresh the
    // cache in the background rather than stalling up to CONFIG_FETCH_TIMEOUT_MS
    // on a flaky connection. Dev preview (freeze) never transitions, so skip it.
    //
    // The one case that overrides the shortcut: last-known-good already says
    // this build is below the update floor. A block must never fire on stale
    // config, so we spend the wait to confirm it against the server — if the
    // fetch fails the gate simply doesn't fire and the menu opens as usual.
    if (this.freeze !== null || (hasConfig() && !shouldConfirmUpdateGate())) {
      this.configSettled = true;
    } else {
      void configReady().then(() => { this.configSettled = true; });
    }

    // ── Kick off the real asset load ─────────────────────────────────────────
    if (this.freeze !== null) {
      // Dev preview: don't load or transition — just pose at the frozen progress.
      this.loaderFrac = this.freeze;
    } else if (this.registry.get('gameAssetsReady') === true) {
      this.loaderFrac = 1;
      this.loaderDone = true;
    } else {
      this.load.on(Phaser.Loader.Events.PROGRESS, (v: number) => { this.loaderFrac = v; });
      this.game.events.once('gameAssetsReady', () => { this.loaderFrac = 1; this.loaderDone = true; });
      loadGameAssets(this);
    }

    this.cameras.main.fadeIn(180, 0, 0, 0);
    this.startTime = this.time.now;
  }

  update(time: number, delta: number): void {
    if (this.transitioning) return;
    const elapsed = time - this.startTime;

    // Target fraction obeys both real load progress and the min-duration ramp so
    // the heap always grows visibly even when assets are already cached. In dev
    // freeze mode the target is simply the frozen fraction (no transition).
    const target = this.freeze !== null
      ? this.freeze
      : preloadProgress(this.loaderFrac, 1, elapsed, MENU_LOADING_MIN_MS);
    // Ease the shown fraction toward target for smooth pile growth.
    this.shownFrac += (target - this.shownFrac) * Math.min(1, delta / 120);
    const f = this.shownFrac;

    this.redrawMounds(f);

    // Hero rides the crest of the front mound, with a gentle bob.
    this.heroBob += delta * 0.006;
    this.hero.y = this.baseY - this.moundMaxH * f + Math.sin(this.heroBob) * 4;

    this.fillBar.setScale(f, 1);
    this.glowBar.setScale(f, 1);
    this.percentText.setText(`${Math.round(f * 100)}%`);

    if (this.freeze !== null) return; // dev preview holds; never transitions
    if (this.configSettled && preloadComplete(!this.loaderDone, elapsed, MENU_LOADING_MIN_MS) && this.shownFrac > 0.995) {
      this.transitioning = true;
      this.cameras.main.fadeOut(200, 0, 0, 0);
      // A confirmed update gate replaces the menu entirely — this build is below
      // the floor the server published, so there is nowhere useful to let the
      // player go. isUpdateRequired() is false unless config landed this launch.
      const target = isUpdateRequired() ? 'UpdateRequiredScene' : this.nextScene;
      this.cameras.main.once(Phaser.Cameras.Scene2D.Events.FADE_OUT_COMPLETE, () => {
        this.scene.start(target);
      });
    }
  }

  // ── Helpers ──────────────────────────────────────────────────────────────────

  private redrawMounds(f: number): void {
    const g = this.mounds;
    g.clear();
    // Back mound: wider, darker, a touch shorter — depth behind the main pile.
    g.fillStyle(MOUND_BACK, 1);
    g.fillPoints(this.closedHill(this.cx + this.moundHalfW * 0.12, this.moundHalfW * 1.15, this.moundMaxH * 0.82 * f), true);
    // Front mound.
    g.fillStyle(MOUND_FRONT, 1);
    g.fillPoints(this.closedHill(this.cx, this.moundHalfW, this.moundMaxH * f), true);
    // Crest rim highlight.
    if (f > 0.02) {
      g.lineStyle(2, MOUND_RIM, 0.7);
      g.strokePoints(hillPoints(this.cx, this.baseY, this.moundHalfW, this.moundMaxH * f), false);
    }
  }

  /** Hill outline closed along the base line, ready for fillPoints. */
  private closedHill(cx: number, halfW: number, height: number): Phaser.Types.Math.Vector2Like[] {
    return [
      ...hillPoints(cx, this.baseY, halfW, height),
      { x: cx + halfW, y: this.baseY },
      { x: cx - halfW, y: this.baseY },
    ];
  }

  private spawnDustFlecks(w: number): void {
    for (let i = 0; i < 12; i++) {
      const fleck = this.add.rectangle(
        Phaser.Math.Between(0, w), this.baseY, Phaser.Math.Between(2, 4), Phaser.Math.Between(2, 4),
        MOUND_RIM, Phaser.Math.FloatBetween(0.2, 0.5),
      );
      const drift = (): void => {
        fleck.setPosition(Phaser.Math.Between(0, w), this.baseY + Phaser.Math.Between(-10, 20));
        fleck.setAlpha(Phaser.Math.FloatBetween(0.2, 0.5));
        this.tweens.add({
          targets: fleck,
          y: fleck.y - Phaser.Math.Between(120, 260),
          x: fleck.x + Phaser.Math.Between(-30, 30),
          alpha: 0,
          duration: Phaser.Math.Between(2600, 4200),
          ease: 'Sine.easeOut',
          onComplete: drift,
        });
      };
      this.time.delayedCall(Phaser.Math.Between(0, 2500), drift);
    }
  }
}
