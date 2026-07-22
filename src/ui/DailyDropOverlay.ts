// src/ui/DailyDropOverlay.ts
//
// Daily Drop claim overlay: dimmed backdrop, panel with the 7-day streak
// strip, a procedural trash can that pops open on tap, and the repair prompt
// when the streak broke. All positions are logical-layout coordinates.
//
// `locked = true` renders the same streak-strip panel as a read-only preview
// (spec: tapping the locked can-icon "previews the streak track and today's
// reward") — no wiggle, no tap-to-claim, no claimDaily call; the can is
// replaced by static "Finish a run to open" copy. Dismiss (backdrop / ✕)
// behaves identically in both modes.

import Phaser from 'phaser';
import { logicalWidth, logicalHeight } from '../systems/displayMetrics';
import { claimDaily } from '../systems/DailyDropClient';
import { AdClient } from '../systems/ads/AdClient';
import { streakChips, dailyRewardPreview, burstColorsForRewards } from './dailyDropLogic';
import { ITEM_DEFS } from '../data/itemDefs';
import type { DailyStatusResponse } from '../../shared/dailyTypes';
import type { RewardPayload } from '../../shared/codeTypes';

const itemName = (id: string): string => ITEM_DEFS.find((d) => d.id === id)?.name ?? id;

const DEPTH = 300;
const ACCENT = 0xff9922;
const ACCENT_DARK = 0xb3650f;
const PANEL = 0x12152e;
const GOLD = 0xffce8a;

export function openDailyDropOverlay(
  scene: Phaser.Scene,
  status: DailyStatusResponse,
  onClosed: (claimed: boolean) => void,
  locked = false,
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

  // Panel — width clamps to the viewport so it never bleeds off the sides on
  // narrow phones (many report innerWidth 360–375, below the 380 design width).
  const panelW = Math.min(380, w - 32);
  const panelLeft = cx - panelW / 2;
  const panelTop = h * 0.2;
  // Compact by default (can + hint). The extra height only exists for the rare
  // streak-repair buttons, so the panel grows to REPAIR_H when that prompt shows
  // instead of leaving dead space below the hint the rest of the time.
  const COMPACT_H = 292;
  const REPAIR_H = 332;
  let panelH = COMPACT_H;
  const panel = scene.add.graphics();
  // Panel area eats taps so they don't hit the backdrop-dismiss.
  const panelZone = scene.add.zone(cx, panelTop + panelH / 2, panelW, panelH).setInteractive();
  const drawPanel = (): void => {
    panel.clear();
    panel.fillStyle(PANEL, 0.97);
    panel.fillRoundedRect(panelLeft, panelTop, panelW, panelH, 16);
    panel.lineStyle(2, ACCENT, 0.9);
    panel.strokeRoundedRect(panelLeft, panelTop, panelW, panelH, 16);
    panelZone.setSize(panelW, panelH).setPosition(cx, panelTop + panelH / 2);
  };
  drawPanel();
  root.add(panel);
  root.add(panelZone);

  const day = status.nextClaimDay;
  const title = scene.add.text(cx, panelTop + 30, `DAILY DROP — DAY ${day}`, {
    fontSize: '22px', color: '#ffce8a', fontStyle: 'bold', stroke: '#000000', strokeThickness: 3,
  }).setOrigin(0.5);
  root.add(title);

  // Dismiss ✕.
  const closeBtn = scene.add.text(panelLeft + panelW - 25, panelTop + 28, '✕', {
    fontSize: '22px', color: '#9a95a8',
  }).setOrigin(0.5).setInteractive({ useHandCursor: true });
  closeBtn.on('pointerup', () => { if (!busy) close(); });
  root.add(closeBtn);

  // 7-day streak strip.
  const chips = streakChips(day);
  const stripY = panelTop + 70;
  // Chip spacing shrinks only if the (clamped) panel is too narrow for the
  // 7-wide strip at the design gap; centered on cx either way.
  const chipGap = Math.min(44, (panelW - 44) / 6);
  chips.forEach((chip, i) => {
    const x = cx + (i - 3) * chipGap;
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

  // Locked preview: no claim yet today, so show today's reward instead of
  // waiting for a claim result to reveal it.
  if (locked) {
    root.add(scene.add.text(cx, stripY + 38, `Today: ${dailyRewardPreview(status.todayGrants, itemName)}`, {
      fontSize: '14px', color: '#cfd6ff', align: 'center', wordWrap: { width: panelW - 40 },
    }).setOrigin(0.5));
  }

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

  const hint = scene.add.text(cx, panelTop + 262, locked ? 'Finish a run to open' : 'TAP THE CAN!', {
    fontSize: '15px', color: '#ffce8a', fontStyle: 'bold',
  }).setOrigin(0.5);
  root.add(hint);
  let wiggle: Phaser.Tweens.Tween | undefined;
  if (!locked) {
    scene.tweens.add({ targets: hint, alpha: 0.4, duration: 700, yoyo: true, repeat: -1 });
    wiggle = scene.tweens.add({
      targets: can, angle: { from: -2.5, to: 2.5 }, duration: 140,
      yoyo: true, repeat: -1, repeatDelay: 1400,
    });
  }

  const setHint = (msg: string, color = '#e9e4d8'): void => {
    hint.setText(msg).setColor(color);
  };

  const showRewards = (messages: string[], streakDay: number, rewards: RewardPayload[]): void => {
    claimed = true;
    wiggle?.stop();
    can.setAngle(0);
    // The hint has done its job — drop it (the modal closes via ✕ / backdrop
    // like any other), rather than lingering on the stale "TAP THE CAN!".
    scene.tweens.killTweensOf(hint);
    hint.setVisible(false);
    // Lid pops off.
    scene.tweens.add({
      targets: lid, angle: -95, x: -46, y: -34, duration: 420, ease: 'Back.easeOut',
    });
    // Token burst — colored per reward (coins orange, items their store accent).
    // Each token shoots up out of the can mouth, then falls under "gravity" and
    // bounces to a settle line at the base before fading where it lands, so the
    // payout reads as a physical spill instead of dots that hang in the air.
    const TOKEN_COUNT = 10;
    const mouthY = canY - 34;   // where the lid sat
    const settleY = canY + 26;  // can base
    burstColorsForRewards(rewards, TOKEN_COUNT).forEach((color, i) => {
      const dir = i % 2 === 0 ? 1 : -1;
      const spread = Phaser.Math.Between(24, 96) * dir;
      const peakY = mouthY - Phaser.Math.Between(52, 98);
      const token = scene.add.circle(cx, mouthY, 6, color)
        .setStrokeStyle(1, ACCENT_DARK).setDepth(1);
      root.add(token);
      // Launch up-and-out (slight lag behind the lid crack)…
      scene.tweens.add({
        targets: token, x: cx + spread * 0.6, y: peakY,
        duration: 260, delay: 120 + i * 18, ease: 'Quad.easeOut',
        onComplete: () => {
          // …then fall + bounce to the settle line, and fade where it lands.
          scene.tweens.add({
            targets: token, x: cx + spread, y: settleY,
            duration: 760, ease: 'Bounce.easeOut',
          });
          scene.tweens.add({
            targets: token, alpha: 0,
            duration: 300, delay: 760, ease: 'Quad.easeIn',
            onComplete: () => token.destroy(),
          });
        },
      });
    });
    title.setText(`DAY ${streakDay} CLAIMED!`);
    const lines = messages.join('\n');
    const rewardText = scene.add.text(cx, canY - 96, lines, {
      fontSize: '18px', color: '#ffffff', fontStyle: 'bold', align: 'center',
      stroke: '#000000', strokeThickness: 3, wordWrap: { width: panelW - 40 },
    }).setOrigin(0.5).setAlpha(0).setDepth(2);
    root.add(rewardText);
    scene.tweens.add({ targets: rewardText, alpha: 1, y: canY - 108, duration: 350, delay: 250 });
    busy = false;
  };

  const showRepairPrompt = (repairableDay: number): void => {
    // Grow the panel to make room for the two repair buttons below the hint.
    panelH = REPAIR_H;
    drawPanel();
    setHint(`Streak broken! Keep Day ${repairableDay}?`, '#e08a7a');
    const btnY = panelTop + 300;
    const adBtn = scene.add.text(cx - 80, btnY, '▶ WATCH AD', {
      fontSize: '15px', color: '#1a0f00', fontStyle: 'bold',
      backgroundColor: '#ff9922', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    const resetBtn = scene.add.text(cx + 85, btnY, 'START OVER', {
      fontSize: '15px', color: '#e9e4d8',
      backgroundColor: '#2b2f4a', padding: { x: 12, y: 6 },
    }).setOrigin(0.5).setInteractive({ useHandCursor: true });
    root.add(adBtn);
    root.add(resetBtn);

    const finish = async (resolution: 'repair' | 'reset'): Promise<void> => {
      busy = true;
      adBtn.destroy(); resetBtn.destroy();
      const out = await claimDaily(resolution);
      if (out.status === 'claimed') showRewards(out.messages, out.streakDay, out.rewards);
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

  // The can is the claim button — locked mode is preview-only, so it must
  // never wire up a claim path (no run yet today).
  if (!locked) {
    const canZone = scene.add.zone(cx, canY, 110, 110).setInteractive({ useHandCursor: true });
    root.add(canZone);
    canZone.on('pointerup', async () => {
      if (busy || claimed) return;
      busy = true;
      setHint('…');
      const out = await claimDaily();
      switch (out.status) {
        case 'claimed':      showRewards(out.messages, out.streakDay, out.rewards); break;
        case 'streakBroken': busy = false; showRepairPrompt(out.repairableDay); break;
        case 'notEligible':  busy = false; setHint('Already claimed — come back tomorrow!'); break;
        case 'offline':      busy = false; setHint('Offline — rewards need a connection', '#e08a7a'); break;
        default:             busy = false; setHint('Something went wrong — try again later', '#e08a7a');
      }
    });
  }
}
