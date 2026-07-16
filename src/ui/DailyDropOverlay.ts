// src/ui/DailyDropOverlay.ts
//
// Daily Drop claim overlay: dimmed backdrop, panel with the 7-day streak
// strip, a procedural trash can that pops open on tap, and the repair prompt
// when the streak broke. All positions are logical-layout coordinates.

import Phaser from 'phaser';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { claimDaily } from '../systems/DailyDropClient';
import { AdClient } from '../systems/ads/AdClient';
import { streakChips } from './dailyDropLogic';
import type { DailyStatusResponse } from '../../shared/dailyTypes';

const DEPTH = 300;
const ACCENT = 0xff9922;
const ACCENT_DARK = 0xb3650f;
const PANEL = 0x12152e;
const GOLD = 0xffce8a;

export function openDailyDropOverlay(
  scene: Phaser.Scene,
  status: DailyStatusResponse,
  onClosed: (claimed: boolean) => void,
): void {
  const w = logicalWidth(scene);
  const h = logicalHeight(scene);
  const cx = w / 2;
  const root = scene.add.container(0, 0).setDepth(DEPTH);
  let claimed = false;
  let busy = false;

  // Full-screen backdrop; swallows input behind the panel.
  const backdrop = scene.add.rectangle(w / 2, h / 2, w, h, 0x04050c, 0.62)
    .setInteractive();
  root.add(backdrop);

  const close = (): void => { root.destroy(); onClosed(claimed); };
  backdrop.on('pointerup', () => { if (!busy) close(); });

  // Panel.
  const panelTop = h * 0.2;
  const panelH = 340;
  const panel = scene.add.graphics();
  panel.fillStyle(PANEL, 0.97);
  panel.fillRoundedRect(cx - 190, panelTop, 380, panelH, 16);
  panel.lineStyle(2, ACCENT, 0.9);
  panel.strokeRoundedRect(cx - 190, panelTop, 380, panelH, 16);
  root.add(panel);
  // Panel area eats taps so they don't hit the backdrop-dismiss.
  const panelZone = scene.add.zone(cx, panelTop + panelH / 2, 380, panelH).setInteractive();
  root.add(panelZone);

  const day = status.nextClaimDay;
  const title = scene.add.text(cx, panelTop + 30, `DAILY DROP — DAY ${day}`, {
    fontSize: '22px', color: '#ffce8a', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5);
  root.add(title);

  // Dismiss ✕.
  const closeBtn = scene.add.text(cx + 165, panelTop + 28, '✕', {
    fontSize: '22px', color: '#9a95a8',
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  closeBtn.on('pointerup', () => { if (!busy) close(); });
  root.add(closeBtn);

  // 7-day streak strip.
  const chips = streakChips(day);
  const stripY = panelTop + 70;
  chips.forEach((chip, i) => {
    const x = cx - 132 + i * 44;
    const g = scene.add.graphics();
    const fill = chip === 'done' ? ACCENT_DARK : chip === 'now' ? ACCENT : 0x0e1124;
    g.fillStyle(fill, 1);
    g.fillRoundedRect(x - 16, stripY - 16, 32, 32, 8);
    g.lineStyle(1, 0xffffff, chip === 'now' ? 0.8 : 0.15);
    g.strokeRoundedRect(x - 16, stripY - 16, 32, 32, 8);
    root.add(g);
    const label = chip === 'done' ? '✓' : String(i + 1);
    root.add(scene.add.text(x, stripY, label, {
      fontSize: '14px', color: chip === 'now' ? '#1a0f00' : '#e9e4d8', fontStyle: 'bold',
    }).setOrigin(0.5));
  });

  // Procedural trash can (day 7 goes golden).
  const golden = day === 7;
  const canY = panelTop + 200;
  const can = scene.add.container(cx, canY);
  const body = scene.add.graphics();
  const bodyColor = golden ? GOLD : 0x8d96ad;
  const ridgeColor = golden ? 0xd9a743 : 0x6f7890;
  body.fillStyle(bodyColor, 1);
  body.fillRoundedRect(-34, -30, 68, 62, 6);
  body.fillStyle(ridgeColor, 1);
  for (let i = -22; i <= 22; i += 11) body.fillRect(i - 2, -26, 4, 54);
  const lid = scene.add.graphics();
  lid.fillStyle(golden ? 0xffe1a8 : 0xaab3c9, 1);
  lid.fillRoundedRect(-38, -44, 76, 12, 6);
  lid.fillRoundedRect(-10, -50, 20, 7, 3);
  can.add([body, lid]);
  root.add(can);
  if (golden) {
    const glow = scene.add.graphics();
    glow.fillStyle(ACCENT, 0.18);
    glow.fillCircle(cx, canY, 70);
    root.addAt(glow, root.getIndex(can));
  }

  const hint = scene.add.text(cx, panelTop + 285, 'TAP THE CAN!', {
    fontSize: '15px', color: '#ffce8a', fontStyle: 'bold',
  }).setOrigin(0.5);
  root.add(hint);
  scene.tweens.add({ targets: hint, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
  const wiggle = scene.tweens.add({
    targets: can, angle: { from: -2.5, to: 2.5 }, duration: 140,
    yoyo: true, repeat: -1, repeatDelay: 1400,
  });

  const setHint = (msg: string, color = '#e9e4d8'): void => {
    hint.setText(msg).setColor(color);
  };

  const showRewards = (messages: string[], streakDay: number): void => {
    claimed = true;
    wiggle.stop();
    can.setAngle(0);
    // Lid pops off.
    scene.tweens.add({
      targets: lid, angle: -95, x: -46, y: -34, duration: 420, ease: 'Back.easeOut',
    });
    // Coin burst.
    for (let i = 0; i < 8; i++) {
      const coin = scene.add.circle(cx, canY - 34, 6, ACCENT).setStrokeStyle(1, ACCENT_DARK);
      root.add(coin);
      const a = -Math.PI / 2 + (i - 3.5) * 0.32;
      scene.tweens.add({
        targets: coin,
        x: cx + Math.cos(a) * Phaser.Math.Between(50, 90),
        y: canY - 34 + Math.sin(a) * Phaser.Math.Between(60, 100),
        alpha: { from: 1, to: 0.85 },
        duration: 620, ease: 'Cubic.easeOut',
      });
    }
    title.setText(`DAY ${streakDay} CLAIMED!`);
    const lines = messages.join('\n');
    const rewardText = scene.add.text(cx, canY - 96, lines, {
      fontSize: '18px', color: '#ffffff', fontStyle: 'bold', align: 'center',
      stroke: '#000000', strokeThickness: 3,
    }).setOrigin(0.5).setAlpha(0);
    root.add(rewardText);
    scene.tweens.add({ targets: rewardText, alpha: 1, y: canY - 108, duration: 350, delay: 250 });
    setHint('TAP ANYWHERE TO CLOSE');
    busy = false;
  };

  const showRepairPrompt = (repairableDay: number): void => {
    setHint(`Streak broken! Keep Day ${repairableDay}?`, '#e08a7a');
    const adBtn = scene.add.text(cx - 80, panelTop + 315, '▶ WATCH AD', {
      fontSize: '15px', color: '#1a0f00', fontStyle: 'bold',
      backgroundColor: '#ff9922', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const resetBtn = scene.add.text(cx + 85, panelTop + 315, 'START OVER', {
      fontSize: '15px', color: '#e9e4d8',
      backgroundColor: '#2b2f4a', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    root.add(adBtn);
    root.add(resetBtn);

    const finish = async (resolution: 'repair' | 'reset'): Promise<void> => {
      busy = true;
      adBtn.destroy(); resetBtn.destroy();
      const out = await claimDaily(resolution);
      if (out.status === 'claimed') showRewards(out.messages, out.streakDay);
      else { setHint('Something went wrong — try again later'); busy = false; }
    };
    adBtn.on('pointerup', async () => {
      if (busy) return;
      busy = true;
      const watched = await AdClient.showRewarded();
      busy = false;
      if (watched) await finish('repair');
      else setHint('Ad unavailable — try again or start over', '#e08a7a');
    });
    resetBtn.on('pointerup', () => { if (!busy) void finish('reset'); });
  };

  // The can is the claim button.
  const canZone = scene.add.zone(cx, canY, 110, 110).setInteractive({ useHandCursor: true });
  root.add(canZone);
  canZone.on('pointerup', async () => {
    if (busy || claimed) return;
    busy = true;
    setHint('…');
    const out = await claimDaily();
    switch (out.status) {
      case 'claimed':      showRewards(out.messages, out.streakDay); break;
      case 'streakBroken': busy = false; showRepairPrompt(out.repairableDay); break;
      case 'notEligible':  busy = false; setHint('Already claimed — come back tomorrow!'); break;
      case 'offline':      busy = false; setHint('Offline — rewards need a connection', '#e08a7a'); break;
      default:             busy = false; setHint('Something went wrong — try again later', '#e08a7a');
    }
  });
}
