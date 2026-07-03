import Phaser from 'phaser';
import { setupUiCamera, logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { ScoreClient } from '../systems/ScoreClient';
import type { LeaderboardEntry } from '../../shared/scoreTypes';
import { composeAvatar } from '../ui/avatar';

const PAGE_LIMIT = 50;
const ROW_H      = 28;

export interface LeaderboardSceneData {
  heapId:   string;
  heapName: string;
  playerId: string;
  /** Scene to resume when the modal closes. Defaults to 'HeapSelectScene'
   *  so existing call sites are unaffected. */
  returnScene?: string;
}

export class LeaderboardScene extends Phaser.Scene {
  private heapId!:   string;
  private heapName!: string;
  private playerId!: string;
  private returnScene!: string;

  private page:        number = 0;
  private total:       number = 0;
  private playerRank:  number | null = null;

  private bodyContainer!: Phaser.GameObjects.Container;
  private statusText!:    Phaser.GameObjects.Text;
  private pageLabel!:     Phaser.GameObjects.Text;
  private prevBtn!:       Phaser.GameObjects.Text;
  private nextBtn!:       Phaser.GameObjects.Text;
  private jumpBtn!:       Phaser.GameObjects.Text;

  private bodyTop:    number = 0;
  private bodyBottom: number = 0;
  private bodyLeft:   number = 0;
  private bodyWidth:  number = 0;
  private scrollY:    number = 0;
  private contentH:   number = 0;

  constructor() { super({ key: 'LeaderboardScene' }); }

  init(data: LeaderboardSceneData): void {
    this.heapId   = data.heapId;
    this.heapName = data.heapName;
    this.playerId = data.playerId;
    this.returnScene = data.returnScene ?? 'HeapSelectScene';
    this.page     = 0;
    this.total    = 0;
    this.playerRank = null;
    this.scrollY  = 0;
  }

  create(): void {
    setupUiCamera(this);
    const W = logicalWidth(this);
    const H = logicalHeight(this);

    // Backdrop — clicking outside the panel closes the modal
    const backdrop = this.add.rectangle(W / 2, H / 2, W, H, 0x000000, 0.7).setInteractive();
    backdrop.on('pointerup', () => this.closeModal());

    // Panel — interactive so clicks inside don't bubble to the backdrop
    const panelW = Math.floor(W * 0.92);
    const panelH = Math.floor(H * 0.86);
    const panelX = Math.floor((W - panelW) / 2);
    const panelY = Math.floor((H - panelH) / 2);
    this.add.rectangle(W / 2, H / 2, panelW, panelH, 0x10131f)
      .setStrokeStyle(2, 0x334466)
      .setInteractive();

    // Header
    this.add.text(panelX + 16, panelY + 20, this.heapName, {
      fontSize: '18px', fontStyle: 'bold', color: '#ffcc88',
      stroke: '#000000', strokeThickness: 3,
    });
    const close = this.add.text(panelX + panelW - 20, panelY + 20, '✕', {
      fontSize: '24px', color: '#667799',
    }).setOrigin(1, 0);
    const closeHit = this.add.rectangle(
      panelX + panelW - 20, panelY + 20 + 16, 56, 56, 0x000000, 0,
    ).setOrigin(1, 0.5).setInteractive({ useHandCursor: true });
    closeHit.on('pointerover', () => close.setColor('#ffffff'));
    closeHit.on('pointerout',  () => close.setColor('#667799'));
    closeHit.on('pointerup',   () => this.closeModal());
    this.add.rectangle(W / 2, panelY + 56, panelW - 32, 1, 0x334466);

    // Body region geometry
    const FOOTER_H  = 50;
    this.bodyTop    = panelY + 70;
    this.bodyBottom = panelY + panelH - FOOTER_H;
    this.bodyLeft   = panelX + 16;
    this.bodyWidth  = panelW - 32;

    // Body container (clipped via mask)
    this.bodyContainer = this.add.container(0, 0);
    const maskShape = this.make.graphics({ x: 0, y: 0 });
    maskShape.fillStyle(0xffffff);
    maskShape.fillRect(this.bodyLeft, this.bodyTop, this.bodyWidth, this.bodyBottom - this.bodyTop);
    this.bodyContainer.setMask(maskShape.createGeometryMask());

    this.statusText = this.add.text(W / 2, (this.bodyTop + this.bodyBottom) / 2, 'Loading…', {
      fontSize: '16px', color: '#8899aa',
    }).setOrigin(0.5);

    // Footer
    const footerY = panelY + panelH - 24;
    this.prevBtn = this.add.text(panelX + 16, footerY, '‹ Prev', {
      fontSize: '14px', color: '#7799bb',
    }).setInteractive({ useHandCursor: true });
    this.prevBtn.on('pointerup', () => this.gotoPage(this.page - 1));

    this.pageLabel = this.add.text(panelX + 100, footerY, '', {
      fontSize: '13px', color: '#8899aa',
    });

    this.nextBtn = this.add.text(panelX + 200, footerY, 'Next ›', {
      fontSize: '14px', color: '#7799bb',
    }).setInteractive({ useHandCursor: true });
    this.nextBtn.on('pointerup', () => this.gotoPage(this.page + 1));

    this.jumpBtn = this.add.text(panelX + panelW - 16, footerY, 'Jump to my score', {
      fontSize: '14px', color: '#ffcc88',
    }).setOrigin(1, 0).setInteractive({ useHandCursor: true });
    this.jumpBtn.on('pointerup', () => this.jumpToPlayer());
    this.jumpBtn.setVisible(false);  // hidden until we know playerRank

    this.input.keyboard?.on('keydown-ESC',      () => this.closeModal());
    this.input.keyboard?.on('keydown-UP',       () => this.scrollBy(-ROW_H));
    this.input.keyboard?.on('keydown-DOWN',     () => this.scrollBy(ROW_H));
    this.input.keyboard?.on('keydown-PAGE_UP',  () => this.scrollBy(-(this.bodyBottom - this.bodyTop)));
    this.input.keyboard?.on('keydown-PAGE_DOWN', () => this.scrollBy(this.bodyBottom - this.bodyTop));

    // Wheel scroll for desktop
    this.input.on('wheel', (_p: Phaser.Input.Pointer, _o: unknown, _x: number, deltaY: number) => {
      this.scrollBy(deltaY);
    });

    // Drag scroll for touch
    let dragStartY = 0;
    let dragStartScroll = 0;
    this.input.on('pointerdown', (p: Phaser.Input.Pointer) => {
      if (p.y < this.bodyTop || p.y > this.bodyBottom) return;
      dragStartY = p.y;
      dragStartScroll = this.scrollY;
    });
    this.input.on('pointermove', (p: Phaser.Input.Pointer) => {
      if (!p.isDown) return;
      if (p.y < this.bodyTop || p.y > this.bodyBottom) return;
      this.scrollY = dragStartScroll - (p.y - dragStartY);
      this.clampScroll();
      this.bodyContainer.y = -this.scrollY;
    });

    void this.loadInitial();
  }

  private async loadInitial(): Promise<void> {
    const [page0, ctx] = await Promise.all([
      ScoreClient.getLeaderboardPage(this.heapId, 0, PAGE_LIMIT),
      ScoreClient.getContext({ heapId: this.heapId, playerId: this.playerId, limit: 0 }),
    ]);
    if (!page0) {
      this.showError();
      return;
    }
    this.playerRank = ctx?.player?.rank ?? null;
    this.jumpBtn.setVisible(this.playerRank !== null);
    this.renderPage(page0.entries, page0.total, page0.page);
  }

  private async gotoPage(page: number): Promise<void> {
    if (page < 0) return;
    if (this.total > 0 && page * PAGE_LIMIT >= this.total) return;
    const data = await ScoreClient.getLeaderboardPage(this.heapId, page, PAGE_LIMIT);
    if (!data) {
      this.showError();
      return;
    }
    this.renderPage(data.entries, data.total, data.page);
  }

  private renderPage(entries: LeaderboardEntry[], total: number, page: number): void {
    this.statusText.setVisible(false);
    this.bodyContainer.removeAll(true);
    this.scrollY = 0;
    this.bodyContainer.y = 0;
    this.page  = page;
    this.total = total;

    entries.forEach((entry, i) => {
      const rowY    = this.bodyTop + i * ROW_H + ROW_H / 2;
      const isMe    = entry.playerId === this.playerId;
      const stripe  = isMe ? 0x3a2a14 : (i % 2 === 0 ? 0x141629 : 0x0f1020);
      const stroke  = isMe ? 0xff9922 : 0x1e2a44;

      const bg = this.add.rectangle(
        this.bodyLeft + this.bodyWidth / 2, rowY,
        this.bodyWidth, ROW_H - 2,
        stripe,
      ).setStrokeStyle(isMe ? 2 : 1, stroke);
      this.bodyContainer.add(bg);

      const rankColor = isMe ? '#ffcc88' : '#7799bb';
      const nameColor = isMe ? '#ffffff' : '#ccddee';

      const showAvatar = entry.rank <= 5;

      const rankText = this.add.text(this.bodyLeft + 12, rowY,
        `#${entry.rank}`, { fontSize: '13px', color: rankColor },
      ).setOrigin(0, 0.5);
      if (showAvatar && this.textures.exists('trashbag-nostrings')) {
        const avatar = composeAvatar(this, entry.loadout ?? {}, {
          x: this.bodyLeft + 44, y: rowY, scale: 0.5,
        });
        this.bodyContainer.add(avatar);
      }
      const nameText = this.add.text(this.bodyLeft + (showAvatar ? 62 : 70), rowY,
        entry.name, { fontSize: '13px', color: nameColor },
      ).setOrigin(0, 0.5);
      const scoreText = this.add.text(this.bodyLeft + this.bodyWidth - 12, rowY,
        entry.score.toLocaleString(), {
          fontSize: '13px', fontStyle: 'bold',
          color: isMe ? '#ffcc88' : '#88ddff',
        },
      ).setOrigin(1, 0.5);
      this.bodyContainer.add([rankText, nameText, scoreText]);
    });

    this.contentH = entries.length * ROW_H;
    this.updateFooter();
  }

  private updateFooter(): void {
    const totalPages = Math.max(1, Math.ceil(this.total / PAGE_LIMIT));
    this.pageLabel.setText(`Page ${this.page + 1} / ${totalPages}`);
    this.prevBtn.setColor(this.page === 0 ? '#445566' : '#7799bb');
    const atEnd = (this.page + 1) >= totalPages;
    this.nextBtn.setColor(atEnd ? '#445566' : '#7799bb');
  }

  private async jumpToPlayer(): Promise<void> {
    if (this.playerRank === null) return;
    const targetPage = Math.floor((this.playerRank - 1) / PAGE_LIMIT);
    if (targetPage !== this.page) {
      await this.gotoPage(targetPage);
    }
    // Scroll the player's row into view
    const indexOnPage = (this.playerRank - 1) - targetPage * PAGE_LIMIT;
    const rowCenterY  = this.bodyTop + indexOnPage * ROW_H + ROW_H / 2;
    const viewportH   = this.bodyBottom - this.bodyTop;
    const desiredScroll = Math.max(0, Math.min(
      this.contentH - viewportH,
      rowCenterY - this.bodyTop - viewportH / 2,
    ));
    this.scrollY = desiredScroll;
    this.bodyContainer.y = -this.scrollY;
    this.flashPlayerRow(indexOnPage);
  }

  private flashPlayerRow(indexOnPage: number): void {
    // Locate the rectangle for that row (first child of the trio per index).
    // Each row contributed 1 rect + 3 texts = 4 children. Rect is at index*4.
    const child = this.bodyContainer.list[indexOnPage * 4];
    if (!(child instanceof Phaser.GameObjects.Rectangle)) return;
    this.tweens.add({
      targets:  child,
      alpha:    { from: 1, to: 0.3 },
      duration: 180,
      yoyo:     true,
      repeat:   2,
    });
  }

  private scrollBy(deltaY: number): void {
    this.scrollY += deltaY;
    this.clampScroll();
    this.bodyContainer.y = -this.scrollY;
  }

  private clampScroll(): void {
    const viewportH = this.bodyBottom - this.bodyTop;
    const max = Math.max(0, this.contentH - viewportH);
    if (this.scrollY < 0)   this.scrollY = 0;
    if (this.scrollY > max) this.scrollY = max;
  }

  private showError(): void {
    this.statusText
      .setText('Couldn\'t load — tap to retry')
      .setColor('#ff7777')
      .setVisible(true)
      .setInteractive({ useHandCursor: true })
      .once('pointerup', () => {
        this.statusText.disableInteractive().setColor('#8899aa');
        void this.loadInitial();
      });
  }

  private closeModal(): void {
    this.scene.resume(this.returnScene);
    this.scene.stop();
  }
}
