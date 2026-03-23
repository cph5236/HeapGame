import Phaser from 'phaser';
import { GAME_WIDTH, GAME_HEIGHT } from '../constants';
import { UPGRADE_DEFS } from '../data/upgradeDefs';
import { getBalance, getUpgradeLevel, purchaseUpgrade } from '../systems/SaveData';

const ROW_START_Y  = 230;
const ROW_SPACING  = 140;
const COL_LEFT     = 30;
const COL_RIGHT    = GAME_WIDTH - 30;

export class UpgradeScene extends Phaser.Scene {
  private selectedIndex: number = 0;
  private balanceText!:  Phaser.GameObjects.Text;
  private rows:          UpgradeRow[] = [];

  constructor() {
    super({ key: 'UpgradeScene' });
  }

  create(): void {
    this.add.rectangle(GAME_WIDTH / 2, GAME_HEIGHT / 2, GAME_WIDTH, GAME_HEIGHT, 0x0d0d1a);

    this.add.text(GAME_WIDTH / 2, 60, 'UPGRADES', {
      fontSize: '40px', color: '#ffffff', stroke: '#000000', strokeThickness: 4,
    }).setOrigin(0.5);

    this.balanceText = this.add.text(GAME_WIDTH / 2, 110, '', {
      fontSize: '20px', color: '#aaddff',
    }).setOrigin(0.5);

    // Build upgrade rows
    this.rows = UPGRADE_DEFS.map((def, i) => {
      const y = ROW_START_Y + i * ROW_SPACING;
      return new UpgradeRow(this, def.id, def.name, y);
    });

    // Footer hint
    this.add.text(GAME_WIDTH / 2, GAME_HEIGHT - 40, '\u2191\u2193 navigate    ENTER buy    ESC menu', {
      fontSize: '16px', color: '#666666',
    }).setOrigin(0.5);

    this.refreshAll();

    // Input
    const kb = this.input.keyboard!;
    kb.on('keydown-UP',    () => this.move(-1));
    kb.on('keydown-DOWN',  () => this.move(1));
    kb.on('keydown-ENTER', () => this.buy());
    kb.on('keydown-SPACE', () => this.buy());
    kb.on('keydown-ESC',   () => this.scene.start('MenuScene'));
  }

  private move(dir: number): void {
    this.selectedIndex = (this.selectedIndex + dir + UPGRADE_DEFS.length) % UPGRADE_DEFS.length;
    this.refreshAll();
  }

  private buy(): void {
    const id = UPGRADE_DEFS[this.selectedIndex].id;
    purchaseUpgrade(id);
    this.refreshAll();
  }

  private refreshAll(): void {
    this.balanceText.setText(`Balance: ${getBalance()} coins`);
    const balance = getBalance();
    this.rows.forEach((row, i) => {
      const def      = UPGRADE_DEFS[i];
      const level    = getUpgradeLevel(def.id);
      const maxed    = level >= def.maxLevel;
      const nextCost = maxed ? 0 : def.cost(level + 1);
      const canAfford = !maxed && balance >= nextCost;
      row.refresh(level, def.maxLevel, nextCost, def.description(level),
                  i === this.selectedIndex, maxed, canAfford);
    });
  }
}

// ── Helper class: one upgrade row ──────────────────────────────────────────

class UpgradeRow {
  private bg:       Phaser.GameObjects.Rectangle;
  private nameText: Phaser.GameObjects.Text;
  private levelText:Phaser.GameObjects.Text;
  private costText: Phaser.GameObjects.Text;
  private descText: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, _id: string, name: string, y: number) {
    this.bg = scene.add.rectangle(GAME_WIDTH / 2, y + 45, GAME_WIDTH - 20, 120, 0x1a1a2e)
      .setStrokeStyle(2, 0x333366);

    this.nameText  = scene.add.text(COL_LEFT, y + 10, name,
      { fontSize: '22px', color: '#ffffff' });
    this.levelText = scene.add.text(COL_RIGHT, y + 10, '',
      { fontSize: '20px', color: '#aaaaaa' }).setOrigin(1, 0);
    this.costText  = scene.add.text(COL_LEFT, y + 45, '',
      { fontSize: '17px', color: '#ffdd44' });
    this.descText  = scene.add.text(COL_LEFT, y + 75, '',
      { fontSize: '15px', color: '#888888' });
  }

  refresh(
    level:     number,
    maxLevel:  number,
    nextCost:  number,
    desc:      string,
    selected:  boolean,
    maxed:     boolean,
    canAfford: boolean,
  ): void {
    // Background highlight
    const bgColor = selected ? 0x2a2a5a : 0x1a1a2e;
    const stroke   = selected ? 0xffdd44 : 0x333366;
    this.bg.setFillStyle(bgColor).setStrokeStyle(2, stroke);

    // Level indicator
    this.levelText.setText(`Lv ${level} / ${maxLevel}`);

    // Cost / status
    if (maxed) {
      this.costText.setText('MAX').setColor('#44ff88');
    } else {
      const affordable = canAfford ? '#ffdd44' : '#884400';
      this.costText.setText(`${nextCost} coins`).setColor(affordable);
    }

    // Description
    this.descText.setText(desc).setColor(maxed ? '#44ff88' : '#888888');

    // Dim everything if not selected and can't afford (and not maxed)
    const alpha = (!maxed && !canAfford && !selected) ? 0.5 : 1;
    this.nameText.setAlpha(alpha);
    this.levelText.setAlpha(alpha);
    this.costText.setAlpha(alpha);
    this.descText.setAlpha(alpha);
  }
}
