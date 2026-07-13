# Animated Cosmetics — Design

**Date:** 2026-07-12
**Status:** Approved design, pending implementation plan
**Builds on:** `2026-07-02-cosmetics-system-design.md`

## Problem

All cosmetic attachments render as static images. Several items want motion:
the googly-eye family should physically react to player movement, the
propeller cap should spin, and future art may arrive as sprite-sheet
flipbooks. The current renderer (`PlayerCosmetics`) hard-codes one static
`Image` per hat/face slot, and the preview compositor (`composeAvatar`) is a
fire-and-forget container with no update loop — neither has a seam to hang
animation off.

## Decisions (from brainstorming)

- **Animation kinds supported:** sprite-sheet flipbook, parametric transform
  (spin/bob/pulse), and code-driven rigs (eyes). Skeletal/shader animation is
  out of scope (YAGNI). Particle-attachment hats are out of scope but the
  design leaves room.
- **Surfaces:** the in-game player and the CustomizationScene editor preview
  animate. The menu avatar button and leaderboard rows stay static.
- **Eye family:** all four eye items (`face_googly`, `face_wonkyeyes`,
  `face_lazyeye`, `face_walleyes` — the remaining face items are glasses and
  stay static) plus any future ones share one procedural eye rig. Each item's identity (cross-eyed, lazy, etc.) is expressed as
  per-eye *rest poses* in data; all of them react to player motion with
  per-item physics character (Googly loosest).
- **Eye art:** two shared part PNGs (white disc + pupil disc), provided by
  the designer. The existing flat `face_*.png` images remain in use for
  store tiles; the equipped render switches to the live rig.
- **No server/catalog/save changes:** same item ids, same slots, same
  loadout format. Animation is entirely client-side render data.

## Architecture

### 1. Rig abstraction — `src/entities/cosmeticRigs/`

One interface, four implementations, one factory.

```ts
interface AttachmentAnchor {           // computed once per frame by the owner
  x: number; y: number;                // player sprite center
  fx: number; fy: number;              // squash/stretch factors vs base scale
  angle: number;                       // sprite angle, degrees
}

interface MotionSnapshot {             // what animation reacts to
  vx: number; vy: number;              // velocity, px/s
  ax: number; ay: number;              // acceleration, px/s² (derived dv/dt)
  grounded: boolean;
}

interface AttachmentRig {
  update(dtMs: number, anchor: AttachmentAnchor, motion: MotionSnapshot): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}
```

| Rig | Serves | Behavior |
|---|---|---|
| `StaticRig` | all current hats/faces | Today's `PlayerCosmetics` image logic extracted verbatim: offset scaled by fx/fy, bottom-anchored hat scaling, angle follow. |
| `SheetRig` | flipbook items | Same transform as `StaticRig` but a `Sprite` playing a looping Phaser animation created once from the def's frame spec. |
| `MotionRig` | spin/bob/pulse items | Wraps the static transform and adds a parametric layer. Pure helper `motionOffsets(anim, tMs)` returns `{dAngle, dx, dy, dScale, dAlpha}` so the math is unit-testable. |
| `EyeRig` | eye family | Per eye: white-disc image + pupil image positioned by `eyePhysics`. Layout comes from def data — one class, N items. |

`createAttachmentRig(scene, resolvedSpec): AttachmentRig` dispatches on the
resolved render spec. Depth/visibility conventions match today's attachments
(depth 12).

**Fallbacks:** if the shared part textures are missing, an eyes item renders
its flat PNG through `StaticRig` (current behavior). If a sheet def's texture
loaded without frames, `SheetRig` degrades to frame 0 static. Nothing breaks
when art hasn't landed — consistent with the existing manifest-filtering
philosophy.

### 2. Eye physics — `src/systems/eyePhysics.ts` (pure)

No Phaser imports; same pattern as `rainbowColorAt`. Each pupil is a damped
point mass constrained to a circular track:

- **Spring toward rest pose** — encodes item personality (cross-eyed rests
  inward, lazy eye droops). Replaces plain "gravity pulls down".
- **Inertial forcing** opposite player acceleration — dash makes pupils lag,
  landings slam them down and jiggle.
- **Rim slide** — when position hits the track radius, velocity is projected
  onto the tangent, so big impulses send the pupil orbiting the rim (the
  googly "spin" emerges from the model, not a script).
- **Damping** — always settles back to rest.

```ts
interface PupilState  { x: number; y: number; vx: number; vy: number }
interface PupilParams {
  restX: number; restY: number;   // rest pose, relative to eye center
  radius: number;                 // track radius (px, art space)
  stiffness: number; damping: number; accelScale: number;
}
function stepPupil(s: PupilState, p: PupilParams,
                   ax: number, ay: number, dtMs: number): PupilState
```

Defaults for stiffness/damping/accelScale live beside the function; defs may
override per item (Googly = loose, others = tighter). Integration is clamped
to a max dt step so tab-switch frame spikes can't explode the sim.

### 3. Data changes — `src/data/cosmeticDefs.ts`

Hats and faces gain an optional `anim` field:

```ts
type AttachmentAnim =
  | { type: 'spin';  rpm: number }
  | { type: 'bob';   periodMs: number; amplitudePx: number }
  | { type: 'pulse'; periodMs: number; scaleAmp: number; alphaAmp?: number }
  | { type: 'sheet'; frameW: number; frameH: number; frameRate: number };
```

The eye items switch from `kind: 'face'` to a new render kind:

```ts
interface EyesRender {
  kind: 'eyes';
  textureKey: string;              // existing flat PNG — store tiles keep using it
  offsetX: number; offsetY: number;
  eyes: Array<{
    x: number; y: number;          // eye center relative to attachment origin
    radius: number;                // pupil track radius
    whiteScale: number; pupilScale: number;
    restX: number; restY: number;  // pupil rest pose relative to eye center
  }>;
  physics?: Partial<Pick<PupilParams, 'stiffness' | 'damping' | 'accelScale'>>;
}
```

`resolveCosmetics` passes the new shapes through; `ResolvedCosmetics.face`
widens to `FaceRender | EyesRender | null`. Glasses/shades faces stay
`kind: 'face'` and untouched.

**Not changed:** `shared/cosmeticCatalog.ts`, server validation, SaveData,
loadout sync. The catalog integrity test continues to pass unchanged.

### 4. Asset pipeline

- New folder `src/sprites/cosmetics/parts/` for shared part art
  (`eye_white.png`, `pupil.png`), globbed by `cosmeticArt.ts` into texture
  keys `cos-part-<stem>` — same drop-in workflow as hats/face.
- Sprite sheets need no new folder or filename convention: the file stays
  `<id>.png` in `hats/`/`face/`. `loadGameAssets` consults the item's def —
  if its `anim.type === 'sheet'` it calls `load.spritesheet(key, url,
  { frameWidth, frameHeight })` instead of `load.image`. Frame data lives in
  the def, next to the frameRate that needs designer tuning anyway.
- `isCosmeticArtAvailable` treats `kind: 'eyes'` like `face` (flat PNG must
  exist — it's the store tile); the parts art only gates the *live rig*, not
  store availability, thanks to the StaticRig fallback.

### 5. Render surfaces

**`PlayerCosmetics`** (in-game): builds its hat/face attachments through the
rig factory instead of inline `Image` creation. Its POST_UPDATE `sync()`
computes the anchor and motion snapshot once — velocity from `body.velocity`
(already read for trail gating), acceleration as dv/dt against the previous
frame's velocity, grounded from `body.blocked.down` — and forwards to each
rig. `hide()`/`destroy()` forward too. Skin glaze and trail emitter logic
stay exactly as they are. `PlayerAnimator` (tie band/strings, squash
keyframes) is untouched.

**Editor preview** — new `src/ui/animatedAvatar.ts`: same composition as
`composeAvatar` (bag, glaze, tie band/strings) but hat/face go through the
rig factory, and a scene UPDATE listener ticks the rigs. The mannequin does
not move, so it feeds synthetic motion: zero baseline (propeller still
spins, sheets still play) plus a small randomized acceleration impulse every
~2–3 s so eye physics visibly sloshes. Returns a handle exposing
`container` and `destroy()`; `CustomizationScene` swaps its big preview to
it and destroys/rebuilds on equip changes as it does today.

**Static surfaces** — `composeAvatar` (menu avatar button, leaderboard rows)
stays static, but renders eye items as whites + pupils frozen at rest pose
(reusing the same layout data, no physics) so previews match the in-game
look rather than the old flat art. If the part textures are missing it falls
back to the flat PNG, same as the rig path.

### 6. Testing

- `eyePhysics` unit suite: converges to rest from displacement; position
  never exceeds radius; impulse response direction is opposite acceleration;
  velocity decays (damping); rim slide preserves tangential motion; large-dt
  clamp holds.
- `motionOffsets` unit suite: spin period, bob/pulse amplitude and phase,
  zero-anim identity.
- Def integrity tests extended: eye rest poses within radius; sheet frame
  dims positive; every `eyes` item still has its flat store PNG id.
- `resolveCosmetics` tests for the new spec shapes and adjustment
  interaction.
- Visual verification: `scene-preview` of CustomizationScene; live smoke
  test in-game (googly slosh on run, slam on landing, rim spin on hard
  impulses; propeller idle spin).

### 7. Rollout

Feature branch `feature/animated-cosmetics`, PR to main. Ships usable with
zero new art (parametric anims on existing hats); the eye rig activates when
the two part PNGs land; sheet support sits ready for future art. First
content pass: `face_*` eye items get `eyes` defs, `hat_propeller` gets
`{ type: 'spin' }`.
