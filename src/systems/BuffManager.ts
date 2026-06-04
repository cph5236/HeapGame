// src/systems/BuffManager.ts
//
// Owns the player's active consumable buffs: applies them, ticks down timed
// ones, drops expired ones, re-aggregates, and drives the Player buff layer +
// a small HUD timer readout. wallSpeedMult is exposed for GameScene to combine
// with the salvage wall multiplier (it is not a Player stat).

import Phaser from 'phaser';
import type { Player } from '../entities/Player';
import type { ConsumableBehavior } from '../data/consumableDefs';
import { ITEM_DEFS } from '../data/itemDefs';
import { ActiveBuff, aggregateBuffEffects, tickBuffs, upsertBuff } from './buffMath';

interface BuffHudRow {
  label: Phaser.GameObjects.Text;
  barBg: Phaser.GameObjects.Rectangle;
  bar:   Phaser.GameObjects.Rectangle;
}

const HUD_X = 8;
const HUD_TOP = 90;
const HUD_ROW_H = 24;
const HUD_BAR_W = 90;

export class BuffManager {
  private active: ActiveBuff[] = [];
  private wallSpeedMult = 1;
  private readonly hudRows = new Map<string, BuffHudRow>();

  constructor(
    private readonly scene: Phaser.Scene,
    private readonly player: Player,
  ) {}

  /** Activate a modifier consumable. Caller has already spent the item. */
  activate(id: string, behavior: Extract<ConsumableBehavior, { kind: 'modifier' }>): void {
    const dur = behavior.durationMs ?? Infinity;
    this.active = upsertBuff(this.active, { id, effect: behavior.effect, remainingMs: dur, durationMs: dur });
    this.reaggregate();
  }

  /** Tick timers each frame (deltaMs from the scene update). */
  update(deltaMs: number): void {
    if (this.active.length > 0) {
      const { active, changed } = tickBuffs(this.active, deltaMs);
      this.active = active;
      if (changed) this.reaggregate();
    }
    this.renderHud();
  }

  /** Combined wall-speed multiplier from active buffs (1 = no change). */
  getWallSpeedMult(): number { return this.wallSpeedMult; }

  private reaggregate(): void {
    const agg = aggregateBuffEffects(this.active.map(b => b.effect));
    this.player.setBuffModifiers({
      speedMult: agg.speedMult,
      jumpBonus: agg.jumpBonus,
      extraAirJumps: agg.extraAirJumps,
      gravityMult: agg.gravityMult,
      cooldownMult: agg.cooldownMult,
    });
    this.wallSpeedMult = agg.wallSpeedMult;
  }

  /** Draw/refresh a HUD row per timed buff; remove rows for expired buffs. */
  private renderHud(): void {
    const timed = this.active.filter(b => b.remainingMs !== Infinity);
    const live = new Set(timed.map(b => b.id));

    // Remove rows for buffs no longer active.
    for (const [id, row] of this.hudRows) {
      if (!live.has(id)) {
        row.label.destroy(); row.barBg.destroy(); row.bar.destroy();
        this.hudRows.delete(id);
      }
    }

    timed.forEach((b, i) => {
      const y = HUD_TOP + i * HUD_ROW_H;
      const name = ITEM_DEFS.find(d => d.id === b.id)?.name ?? b.id;
      const ratio = Math.max(0, Math.min(1, b.remainingMs / b.durationMs));

      let row = this.hudRows.get(b.id);
      if (!row) {
        row = {
          label: this.scene.add.text(HUD_X, y, name, {
            fontSize: '12px', color: '#ffdd77', stroke: '#000000', strokeThickness: 2,
          }).setScrollFactor(0).setDepth(40),
          barBg: this.scene.add.rectangle(HUD_X, y + 16, HUD_BAR_W, 4, 0x000000, 0.5)
            .setOrigin(0, 0.5).setScrollFactor(0).setDepth(40),
          bar: this.scene.add.rectangle(HUD_X, y + 16, HUD_BAR_W, 4, 0xffdd55)
            .setOrigin(0, 0.5).setScrollFactor(0).setDepth(41),
        };
        this.hudRows.set(b.id, row);
      }
      row.label.setY(y);
      row.barBg.setY(y + 16);
      row.bar.setY(y + 16).setDisplaySize(HUD_BAR_W * ratio, 4);
    });
  }
}
