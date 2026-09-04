// src/ui/avatar.ts
//
// Mini-player compositor: bag + skin tint + tie strings (idle pose) +
// hat/face attachments in one Container. Used by the character editor preview,
// the menu logo figure, and the leaderboard/podium rows.
//
// Every portrait is live. Attachments go through the same rig factory the
// in-game player uses, so spin/bob/pulse/sheet hats, googly eyes and the
// rainbow hue cycle behave identically wherever the character is shown — a
// frozen portrait next to an animated one just reads as a bug. The mannequin
// doesn't move, so a small random acceleration impulse fires every couple of
// seconds to give motion-reactive rigs (googly eyes) something to react to.

import Phaser from 'phaser';
import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import {
  resolveCosmetics, rainbowColorAt,
  type HatAdjustments, type ResolvedCosmetics,
} from '../systems/cosmeticsLogic';
import { createAttachmentRig } from '../entities/cosmeticRigs/createAttachmentRig';
import type { AttachmentRig, AttachmentAnchor } from '../entities/cosmeticRigs/types';
import { trailEmitterConfig } from '../entities/cosmeticRigs/trailEmitter';
import { drawTieBand } from './tieBand';
import { PLAYER_WIDTH, PLAYER_HEIGHT } from '../constants';

/** Collar attach point for the strings, matching PlayerAnimator's offset. */
const COLLAR_Y = PLAYER_HEIGHT * -1.2 * (PLAYER_HEIGHT / 197);
/** Shortened idle-pose strings — the portrait reads better with a gentler
 *  drape than the in-game animator's full-length dangle. Anchored at the
 *  band edges (±4) so the two tails don't cross at the neck. */
const IDLE_STRINGS = { x0: 4, cpX: 8, cpY: 7, endX: 12, endY: 14 };
const STRING_W = 1.35;

const PULSE_MIN_GAP_MS = 2000;
const PULSE_RAND_MS    = 1200;
const PULSE_LEN_MS     = 130;
const PULSE_AX         = 5000;   // px/s² — enough to slosh even tight eye items
const PULSE_AY         = 3500;

/** Where a portrait's trail streams to, px/s before the avatar scale. Up and
 *  to the left: the character reads as climbing away from its own wake. It has
 *  to be brisk — a particle tuned for a player moving at speed spends its whole
 *  short life hidden behind a mannequin that never moves. */
const TRAIL_DRIFT_X = -85;
const TRAIL_DRIFT_Y = -65;
/** Emission point, logical px from the bag center. Off the left shoulder, so
 *  particles are clear of the silhouette while they are still big and bright
 *  rather than emerging from behind it already half faded. */
const TRAIL_ORIGIN_X = -13;
const TRAIL_ORIGIN_Y = 2;
/** Portraits hold each particle longer, for a plume with some length to it. */
const TRAIL_LIFESPAN_SCALE = 1.5;

/** Repaint hooks the hue cycle drives; a portrait with no rainbow item builds
 *  the same parts and simply never calls them. */
export interface AvatarBaseParts {
  /** Re-tint bag + glaze (rainbow skin). No-op when the skin has no tint. */
  paintSkin(color: number): void;
  /** Redraw the collar band + strings in a new color (rainbow tie). */
  paintTie(color: number): void;
}

/** Bag + skin glaze + tie band/strings into `container`. */
export function composeAvatarBase(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  r: ResolvedCosmetics,
  s: number,
): AvatarBaseParts {
  const bag = scene.add.image(0, 0, 'trashbag-nostrings')
    .setDisplaySize(PLAYER_WIDTH * s, PLAYER_HEIGHT * s);
  if (r.skinTint !== null) bag.setTint(r.skinTint);
  container.add(bag);
  let glaze: Phaser.GameObjects.Image | null = null;
  if (r.skinTint !== null) {
    // Flat-color glaze — multiply tint alone is invisible on near-black art.
    glaze = scene.add.image(0, 0, 'trashbag-nostrings')
      .setDisplaySize(PLAYER_WIDTH * s, PLAYER_HEIGHT * s)
      .setTintFill(r.skinTint).setAlpha(0.26);
    container.add(glaze);
  }

  // Tie: paint the collar band over the baked-in red one, then hang the
  // strings in front of the bag (same as the in-game animator's gfx layer).
  const strings = scene.add.graphics();
  const paintTie = (color: number): void => {
    strings.clear();
    drawTieBand(strings, color, 0, COLLAR_Y * s, s);
    strings.lineStyle(STRING_W * s, color, 1);
    const st = IDLE_STRINGS;
    drawBezier(strings, -st.x0 * s, COLLAR_Y * s, -st.cpX * s, st.cpY * s, -st.endX * s, st.endY * s);
    drawBezier(strings,  st.x0 * s, COLLAR_Y * s,  st.cpX * s, st.cpY * s,  st.endX * s, st.endY * s);
  };
  paintTie(r.tieColor);
  container.add(strings);

  return {
    paintSkin(color: number): void {
      if (r.skinTint === null) return;
      bag.setTint(color);
      glaze?.setTintFill(color);
    },
    paintTie,
  };
}

export interface AvatarOpts {
  x: number; y: number; scale: number;
  /** Show the equipped trail streaming off the portrait. Off by default: it
   *  earns its space on a showcase mannequin, not in a leaderboard row. */
  trail?: boolean;
}

export interface AvatarHandle {
  container: Phaser.GameObjects.Container;
  destroy(): void;
}

/** Live portrait with an explicit handle. Callers that hold on to a preview
 *  (and rebuild it on every equip) want this; everyone else wants
 *  `composeAvatar`, which is the same thing minus the bookkeeping. */
export function createAvatar(
  scene:   Phaser.Scene,
  loadout: EquippedLoadout,
  opts:    AvatarOpts,
  adjustments: HatAdjustments = {},   // own avatar: pass SaveData's tweaks
): AvatarHandle {
  const r = resolveCosmetics(loadout, adjustments);
  const s = opts.scale;
  const container = scene.add.container(opts.x, opts.y);

  let rainbowMs = 0;
  // Added before the bag so the wake renders behind the body. Like the bag,
  // glaze and strings, the emitter needs no explicit destroy — it is a
  // container child and goes with it. The rigs below are the exception, and
  // get one because they own state beyond their GameObjects.
  if (opts.trail && r.trail && scene.textures.exists(r.trail.textureKey)) {
    container.add(scene.add.particles(TRAIL_ORIGIN_X * s, TRAIL_ORIGIN_Y * s, r.trail.textureKey,
      trailEmitterConfig(r.trail, () => rainbowMs, {
        scale: s, driftX: TRAIL_DRIFT_X, driftY: TRAIL_DRIFT_Y,
        lifespanScale: TRAIL_LIFESPAN_SCALE,
      })));
  }

  const base = composeAvatarBase(scene, container, r, s);

  const rigs: AttachmentRig[] = [];
  for (const spec of [r.hat, r.face]) {
    if (!spec) continue;
    const rig = createAttachmentRig(scene, spec);
    if (rig) { rigs.push(rig); container.add(rig.objects); }
  }

  // Rig objects are container children: origin is (0,0) local, and the
  // container transform (breathing/hop tweens) carries them. fx/fy = s
  // reproduces the old static compositor's `offset*s` / `ART_SCALE*s` math.
  const anchor: AttachmentAnchor = { x: 0, y: 0, fx: s, fy: s, angle: 0 };
  const cycles = r.tieRainbow || r.skinRainbow || (r.trail?.rainbow ?? false);

  let pulseAx = 0, pulseAy = 0, pulseLeftMs = 0;
  let nextPulseMs = PULSE_MIN_GAP_MS / 2;
  const onUpdate = (_time: number, delta: number): void => {
    // Rainbow items are the one cosmetic you can't judge from a still frame,
    // so every portrait cycles them the way the game does.
    if (cycles) {
      rainbowMs += delta;
      const hue = rainbowColorAt(rainbowMs);
      if (r.tieRainbow)  base.paintTie(hue);
      if (r.skinRainbow) base.paintSkin(hue);
    }
    nextPulseMs -= delta;
    if (nextPulseMs <= 0) {
      pulseAx = (Math.random() * 2 - 1) * PULSE_AX;
      pulseAy = (Math.random() * 2 - 1) * PULSE_AY;
      pulseLeftMs = PULSE_LEN_MS;
      nextPulseMs = PULSE_MIN_GAP_MS + Math.random() * PULSE_RAND_MS;
    }
    const active = pulseLeftMs > 0;
    if (active) pulseLeftMs -= delta;
    const motion = { vx: 0, vy: 0, ax: active ? pulseAx : 0, ay: active ? pulseAy : 0, grounded: true };
    for (const rig of rigs) rig.update(delta, anchor, motion);
  };
  scene.events.on(Phaser.Scenes.Events.UPDATE, onUpdate);

  // Unsubscribe on every path that can end the portrait, not just an explicit
  // destroy(): most callers hand their avatar to a parent container or just
  // leave the scene. Phaser's Systems.shutdown() emits SHUTDOWN *without*
  // clearing listeners, so a surviving UPDATE listener would tick rigs whose
  // GameObjects Phaser had already destroyed (the PlayerCosmetics P1 crash).
  let torndown = false;
  const teardown = (): void => {
    if (torndown) return;
    torndown = true;
    scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
    scene.events.off(Phaser.Scenes.Events.SHUTDOWN, teardown);
    container.off(Phaser.GameObjects.Events.DESTROY, teardown);
    for (const rig of rigs) rig.destroy();
  };
  scene.events.once(Phaser.Scenes.Events.SHUTDOWN, teardown);
  container.once(Phaser.GameObjects.Events.DESTROY, teardown);

  return {
    container,
    destroy(): void {
      teardown();
      container.destroy();
    },
  };
}

/** Live portrait as a plain Container — destroy it (or its parent, or the
 *  scene) and it cleans up after itself. */
export function composeAvatar(
  scene:   Phaser.Scene,
  loadout: EquippedLoadout,
  opts:    AvatarOpts,
  adjustments: HatAdjustments = {},
): Phaser.GameObjects.Container {
  return createAvatar(scene, loadout, opts, adjustments).container;
}

function drawBezier(g: Phaser.GameObjects.Graphics, x0: number, y0: number, cpx: number, cpy: number, x1: number, y1: number): void {
  const segments = 12;
  g.beginPath();
  g.moveTo(x0, y0);
  for (let i = 1; i <= segments; i++) {
    const t = i / segments;
    const mt = 1 - t;
    g.lineTo(
      mt * mt * x0 + 2 * mt * t * (x0 + cpx) + t * t * (x0 + x1),
      mt * mt * y0 + 2 * mt * t * (y0 + cpy) + t * t * (y0 + y1),
    );
  }
  g.strokePath();
}
