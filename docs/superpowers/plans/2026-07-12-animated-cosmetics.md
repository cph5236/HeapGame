# Animated Cosmetics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let cosmetic items animate — sprite-sheet flipbooks, parametric spin/bob/pulse, and a physics-driven googly-eye rig — on the in-game player and the character-editor preview.

**Architecture:** A small `AttachmentRig` interface (update/setVisible/destroy) with four implementations (Static, Sheet, Motion, Eye) behind a factory. `PlayerCosmetics` computes a per-frame anchor + motion snapshot on POST_UPDATE and forwards to rigs; a new `animatedAvatar` gives the editor preview the same rigs on a scene UPDATE ticker. Eye physics is a pure, unit-tested module. Full design: `docs/superpowers/specs/2026-07-12-animated-cosmetics-design.md`.

**Tech Stack:** Phaser 3.90, TypeScript 5.9 (strict), Vite 6 (`import.meta.glob` asset manifest), Vitest.

## Global Constraints

- Branch: all work on `feature/animated-cosmetics` (already created). Commit locally after each task; **never push** unless the user asks. Never push to `main`.
- **No changes** to `shared/cosmeticCatalog.ts`, the server, SaveData, or the loadout format. Same item ids, same slots.
- Store tiles keep rendering the existing flat `face_*.png` textures (CustomizationScene item grid reads `render.textureKey` — the new `eyes` kind keeps that field precisely so the grid code needs no change).
- Missing art must degrade gracefully, never crash: eyes fall back to the flat PNG, sheets fall back to a static first frame. This mirrors the existing manifest-filtering philosophy in `src/data/cosmeticArt.ts`.
- Pure logic (eye physics, motion math) lives in `src/systems/` with no Phaser imports, tested in `src/systems/__tests__/`. Phaser glue (rigs, scenes) is verified by `npm run build` + smoke test, matching repo convention.
- Run `npm test` (Vitest) and `npm run build` before claiming any task done. Both must pass.
- Test runner invocation: `npx vitest run <path>` for a single file.

---

### Task 1: Data model — `anim` field, `eyes` render kind, eye item conversion

**Files:**
- Modify: `src/data/cosmeticDefs.ts`
- Modify: `src/data/cosmeticArt.ts` (availability check for `eyes`)
- Test: `src/data/__tests__/cosmeticDefs.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (later tasks import these from `../data/cosmeticDefs`):
  - `type AttachmentAnim = { type:'spin'; rpm:number } | { type:'bob'; periodMs:number; amplitudePx:number } | { type:'pulse'; periodMs:number; scaleAmp:number; alphaAmp?:number } | { type:'sheet'; frameW:number; frameH:number; frameRate:number }`
  - `HatRender` / `FaceRender` gain optional `anim?: AttachmentAnim`
  - `interface EyeSpec { x:number; y:number; radius:number; whiteScale:number; pupilScale:number; restX:number; restY:number }`
  - `interface EyesPhysics { stiffness?:number; damping?:number; accelScale?:number }`
  - `interface EyesRender { kind:'eyes'; textureKey:string; offsetX:number; offsetY:number; eyes:EyeSpec[]; physics?:EyesPhysics }`
  - `CosmeticRender` union includes `EyesRender`

- [ ] **Step 1: Write the failing tests**

In `src/data/__tests__/cosmeticDefs.test.ts`, replace the `render spec kind matches the slot` test and the `PNG items use the cos-<id> texture key convention` test, and append the new eyes/anim integrity tests:

```ts
  it('render spec kind matches the slot (eyes allowed on face)', () => {
    for (const def of COSMETIC_DEFS) {
      if (def.render.kind === 'eyes') expect(def.slot).toBe('face');
      else expect(def.render.kind).toBe(def.slot);
    }
  });

  it('PNG items use the cos-<id> texture key convention', () => {
    for (const def of COSMETIC_DEFS) {
      if (def.render.kind === 'hat' || def.render.kind === 'face' || def.render.kind === 'eyes') {
        expect(def.render.textureKey).toBe(`cos-${def.id}`);
      }
    }
  });

  it('the four eye items use the eyes render kind', () => {
    for (const id of ['face_googly', 'face_wonkyeyes', 'face_lazyeye', 'face_walleyes']) {
      expect(getCosmeticDef(id)?.render.kind).toBe('eyes');
    }
  });

  it('eyes defs are physically valid (rest pose within track radius, 2 eyes)', () => {
    for (const def of COSMETIC_DEFS) {
      if (def.render.kind !== 'eyes') continue;
      expect(def.render.eyes.length).toBe(2);
      for (const eye of def.render.eyes) {
        expect(eye.radius).toBeGreaterThan(0);
        expect(Math.hypot(eye.restX, eye.restY)).toBeLessThanOrEqual(eye.radius);
        expect(eye.whiteScale).toBeGreaterThan(0);
        expect(eye.pupilScale).toBeGreaterThan(0);
      }
    }
  });

  it('sheet anims declare positive frame dimensions and rate', () => {
    for (const def of COSMETIC_DEFS) {
      const anim = (def.render.kind === 'hat' || def.render.kind === 'face') ? def.render.anim : undefined;
      if (anim?.type === 'sheet') {
        expect(anim.frameW).toBeGreaterThan(0);
        expect(anim.frameH).toBeGreaterThan(0);
        expect(anim.frameRate).toBeGreaterThan(0);
      }
    }
  });
```

- [ ] **Step 2: Run tests to verify the new ones fail**

Run: `npx vitest run src/data/__tests__/cosmeticDefs.test.ts`
Expected: FAIL — `the four eye items use the eyes render kind` fails (kind is `'face'`); the others pass vacuously.

- [ ] **Step 3: Implement the data model**

In `src/data/cosmeticDefs.ts`:

3a. Replace the render-spec interfaces block (lines 8–29) with:

```ts
export type AttachmentAnim =
  | { type: 'spin';  rpm: number }
  | { type: 'bob';   periodMs: number; amplitudePx: number }
  | { type: 'pulse'; periodMs: number; scaleAmp: number; alphaAmp?: number }
  | { type: 'sheet'; frameW: number; frameH: number; frameRate: number };

export interface TieRender   { kind: 'tie';   color: number; rainbow?: boolean }
export interface SkinRender  { kind: 'skin';  tint: number }
export interface HatRender   {
  kind: 'hat';
  textureKey: string;
  offsetX: number;
  offsetY: number;
  angle:  number;   // default worn angle, degrees (designer-tuned)
  scale:  number;   // default size multiplier on ART_SCALE (designer-tuned)
  anim?:  AttachmentAnim;
}
export interface FaceRender  { kind: 'face';  textureKey: string; offsetX: number; offsetY: number; anim?: AttachmentAnim }

/** One eye of an `eyes` item. Positions in logical px relative to the
 *  attachment origin (player center + offsetX/Y); rest pose relative to the
 *  eye center. `radius` is how far the pupil may travel from the center. */
export interface EyeSpec {
  x: number; y: number;
  radius: number;
  whiteScale: number;   // multiplier on ART_SCALE for the shared white disc
  pupilScale: number;   // multiplier on ART_SCALE for the shared pupil disc
  restX: number; restY: number;
}
/** Per-item overrides for eyePhysics defaults (see DEFAULT_EYE_PHYSICS). */
export interface EyesPhysics { stiffness?: number; damping?: number; accelScale?: number }
/** Physics-driven eye family. `textureKey` stays the flat store PNG — the
 *  store grid renders it and the rig falls back to it when parts art is
 *  missing. */
export interface EyesRender {
  kind: 'eyes';
  textureKey: string;
  offsetX: number; offsetY: number;
  eyes: EyeSpec[];
  physics?: EyesPhysics;
}
export interface TrailRender {
  kind: 'trail';
  textureKey: string;          // procedural particle texture (see TextureGenerators)
  tint:       number;
  frequency:  number;          // ms between emissions
  speedY:     [number, number];
  lifespan:   number;          // ms
  scale:      [number, number]; // start → end
  alpha:      number;
}
export type CosmeticRender = TieRender | SkinRender | HatRender | FaceRender | EyesRender | TrailRender;
```

3b. Extend the `hat` helper with an optional anim, and add an `eyes` helper next to the `face` helper:

```ts
const hat  = (id: string, name: string, price: number, offsetX: number, offsetY: number,
              angle = 0, scale = 1, anim?: AttachmentAnim): CosmeticDef =>
  ({ id, slot: 'hat', name, price, render: { kind: 'hat', textureKey: `cos-${id}`, offsetX, offsetY, angle, scale, anim } });
const eyes = (id: string, name: string, price: number, offsetX: number, offsetY: number,
              eyeSpecs: EyeSpec[], physics?: EyesPhysics): CosmeticDef =>
  ({ id, slot: 'face', name, price, render: { kind: 'eyes', textureKey: `cos-${id}`, offsetX, offsetY, eyes: eyeSpecs, physics } });
```

3c. Replace the four eye item lines in `COSMETIC_DEFS` (keep names/prices identical; the nine glasses/shades `face(...)` lines are untouched):

```ts
  // ── Eye family (physics-driven pupil rigs; rest pose = item personality) ──
  eyes('face_googly', 'Googly Eyes', 500, 0, -8, [
    { x: -4.5, y: 0, radius: 2.2, whiteScale: 1, pupilScale: 1, restX: 0, restY: 1.4 },
    { x:  4.5, y: 0, radius: 2.2, whiteScale: 1, pupilScale: 1, restX: 0, restY: 1.4 },
  ], { stiffness: 30, damping: 3.5, accelScale: 0.02 }),   // loose + floppy
  eyes('face_wonkyeyes', 'Lazy Eye', 500, 0, -8, [
    { x: -4.5, y: 0, radius: 2.2, whiteScale: 1, pupilScale: 1, restX: 0, restY:  1.8 },
    { x:  4.5, y: 0, radius: 2.2, whiteScale: 1, pupilScale: 1, restX: 0, restY: -0.6 },
  ]),
  eyes('face_lazyeye', 'Crazy Eyes', 500, 0, -8, [
    { x: -4.5, y: 0, radius: 2.2, whiteScale: 1, pupilScale: 1, restX: -1.4, restY: -1.2 },
    { x:  4.5, y: 0, radius: 2.2, whiteScale: 1, pupilScale: 1, restX:  1.4, restY:  1.2 },
  ]),
  eyes('face_walleyes', 'Cross-Eyes', 500, 0, -8, [
    { x: -4.5, y: 0, radius: 2.2, whiteScale: 1, pupilScale: 1, restX:  1.4, restY: 0.6 },
    { x:  4.5, y: 0, radius: 2.2, whiteScale: 1, pupilScale: 1, restX: -1.4, restY: 0.6 },
  ]),
```

3d. Give the propeller cap the first parametric anim (tuning placeholder — the whole-cap spin may read oddly and can be retuned/removed at the Task 10 smoke test):

```ts
  hat('hat_propeller', 'Propeller Cap', 1000, -3.0, -26.5, 0, 1, { type: 'spin', rpm: 40 }),
```

3e. In `src/data/cosmeticArt.ts`, widen `isCosmeticArtAvailable` so eye items stay in the store (their flat PNG is the store tile):

```ts
export function isCosmeticArtAvailable(def: CosmeticDef): boolean {
  if (def.render.kind === 'hat' || def.render.kind === 'face' || def.render.kind === 'eyes') {
    return def.render.textureKey in COSMETIC_ART;
  }
  return true;
}
```

- [ ] **Step 4: Run the full test suite and build**

Run: `npx vitest run src/data/__tests__/cosmeticDefs.test.ts` → PASS.
Run: `npm test` → expect **failures in `src/systems`** mentioning the face kind (e.g. `cosmeticsLogic` narrowing) is acceptable ONLY if they are compile-type errors fixed by Task 2 — if `npm test` fails on anything else, fix it now. Run `npm run build`; if it errors inside `cosmeticsLogic.ts`/`PlayerCosmetics.ts` on the widened union, note it and proceed to Task 2 (the two tasks may be committed together in that case; prefer a green build per commit).

- [ ] **Step 5: Commit** (fold into Task 2's commit if the build only goes green after Task 2)

```bash
git add src/data/cosmeticDefs.ts src/data/cosmeticArt.ts src/data/__tests__/cosmeticDefs.test.ts
git commit -m "feat(cosmetics): anim field + eyes render kind in defs"
```

---

### Task 2: `resolveCosmetics` passes the new shapes through

**Files:**
- Modify: `src/systems/cosmeticsLogic.ts`
- Test: `src/systems/__tests__/cosmeticsLogic.test.ts`

**Interfaces:**
- Consumes: `EyesRender`, `FaceRender` from Task 1.
- Produces: `ResolvedCosmetics.face: FaceRender | EyesRender | null` — every consumer of `.face` (PlayerCosmetics, avatar, rigs) must discriminate on `.kind`.

- [ ] **Step 1: Write the failing tests**

Append to `src/systems/__tests__/cosmeticsLogic.test.ts` (match the file's existing describe/import style):

```ts
  it('resolves eye items to the eyes render kind with layout data', () => {
    const r = resolveCosmetics({ face: 'face_googly' });
    expect(r.face?.kind).toBe('eyes');
    if (r.face?.kind === 'eyes') {
      expect(r.face.eyes).toHaveLength(2);
      expect(r.face.textureKey).toBe('cos-face_googly');
    }
  });

  it('still resolves glasses to the flat face kind', () => {
    const r = resolveCosmetics({ face: 'face_3dglasses' });
    expect(r.face?.kind).toBe('face');
  });

  it('passes a hat anim through resolution', () => {
    const r = resolveCosmetics({ hat: 'hat_propeller' });
    expect(r.hat?.anim?.type).toBe('spin');
  });
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/cosmeticsLogic.test.ts`
Expected: FAIL — eyes item resolves to `null` face (kind `'eyes'` filtered out) and/or type errors.

- [ ] **Step 3: Implement**

In `src/systems/cosmeticsLogic.ts`:

```ts
import {
  getCosmeticDef, DEFAULT_TIE_COLOR,
  type HatRender, type FaceRender, type EyesRender, type TrailRender,
} from '../data/cosmeticDefs';
```

Widen the resolved type:

```ts
export interface ResolvedCosmetics {
  tieColor:   number;
  tieRainbow: boolean;
  skinTint:   number | null;   // null = no tint
  hat:        ResolvedHatRender | null;
  face:       FaceRender | EyesRender | null;
  trail:      TrailRender | null;
}
```

And the face branch:

```ts
  const faceDef = equipped.face ? getCosmeticDef(equipped.face) : undefined;
  if (faceDef?.render.kind === 'face' || faceDef?.render.kind === 'eyes') out.face = faceDef.render;
```

(`ResolvedHatRender extends HatRender` already inherits the optional `anim` — no hat change needed; the spread in the adjustment branch carries it.)

- [ ] **Step 4: Run tests + build**

Run: `npx vitest run src/systems/__tests__/cosmeticsLogic.test.ts` → PASS.
Run: `npm test` → all green. Run: `npm run build` → may still error in `PlayerCosmetics.ts`/`avatar.ts` if the widened `face` union breaks property access (`.textureKey` exists on both kinds so it should compile; if it does error, add `&& r.face.kind === 'face'`-style narrowing at the two read sites as a stopgap — Tasks 5/9 replace them). Build must be green before committing.

- [ ] **Step 5: Commit**

```bash
git add -A src/systems src/data
git commit -m "feat(cosmetics): resolveCosmetics passes eyes/anim specs through"
```

---

### Task 3: Pure eye physics — `stepPupil`

**Files:**
- Create: `src/systems/eyePhysics.ts`
- Test: `src/systems/__tests__/eyePhysics.test.ts`

**Interfaces:**
- Consumes: nothing (pure, no Phaser).
- Produces:
  - `interface PupilState { x:number; y:number; vx:number; vy:number }`
  - `interface PupilParams { restX:number; restY:number; radius:number; stiffness:number; damping:number; accelScale:number }`
  - `const DEFAULT_EYE_PHYSICS: { stiffness:number; damping:number; accelScale:number }`
  - `function stepPupil(s: PupilState, p: PupilParams, ax: number, ay: number, dtMs: number): PupilState` — returns a **new** state (no mutation).

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/eyePhysics.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { stepPupil, DEFAULT_EYE_PHYSICS, type PupilState, type PupilParams } from '../eyePhysics';

const params: PupilParams = { restX: 0, restY: 1.4, radius: 2.2, ...DEFAULT_EYE_PHYSICS };
const at = (x: number, y: number): PupilState => ({ x, y, vx: 0, vy: 0 });

function run(s: PupilState, p: PupilParams, ax: number, ay: number, ms: number): PupilState {
  for (let t = 0; t < ms; t += 16) s = stepPupil(s, p, ax, ay, 16);
  return s;
}

describe('stepPupil', () => {
  it('settles to the rest pose with no input', () => {
    const s = run(at(2.2, 0), params, 0, 0, 3000);
    expect(Math.hypot(s.x - params.restX, s.y - params.restY)).toBeLessThan(0.05);
    expect(Math.hypot(s.vx, s.vy)).toBeLessThan(0.05);
  });

  it('never leaves the track radius, even under huge acceleration', () => {
    let s = at(0, 0);
    for (let i = 0; i < 200; i++) {
      s = stepPupil(s, params, 50000 * (i % 2 ? 1 : -1), -30000, 16);
      expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(params.radius + 1e-9);
    }
  });

  it('moves opposite to player acceleration (inertia)', () => {
    const s = run(at(params.restX, params.restY), params, 2000, 0, 200);
    expect(s.x).toBeLessThan(params.restX);   // player accelerates right → pupil lags left
  });

  it('damps out — kinetic energy decays after an impulse', () => {
    let s: PupilState = { x: 0, y: 0, vx: 40, vy: -30 };
    const early = run(s, params, 0, 0, 100);
    const late  = run(s, params, 0, 0, 2500);
    expect(Math.hypot(late.vx, late.vy)).toBeLessThan(Math.hypot(early.vx, early.vy));
  });

  it('keeps tangential velocity when pinned to the rim (orbit/spin)', () => {
    // On the rim at (radius, 0), moving straight up (pure tangential), pushed outward.
    const s0: PupilState = { x: params.radius, y: 0, vx: 0, vy: -50 };
    const s1 = stepPupil(s0, params, -20000, 0, 16);  // accel pushes pupil outward (+x)
    expect(Math.hypot(s1.x, s1.y)).toBeLessThanOrEqual(params.radius + 1e-9);
    expect(s1.vy).toBeLessThan(0);                    // tangential motion survives
  });

  it('is stable across a huge dt spike (tab switch)', () => {
    const s = stepPupil(at(1, 1), params, 3000, 3000, 5000);
    expect(Number.isFinite(s.x) && Number.isFinite(s.y)).toBe(true);
    expect(Math.hypot(s.x, s.y)).toBeLessThanOrEqual(params.radius + 1e-9);
  });

  it('does not mutate the input state', () => {
    const s0 = at(1, 0);
    stepPupil(s0, params, 500, 0, 16);
    expect(s0).toEqual({ x: 1, y: 0, vx: 0, vy: 0 });
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/eyePhysics.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/systems/eyePhysics.ts`:

```ts
// src/systems/eyePhysics.ts
//
// Pure pupil simulation for the googly-eye cosmetic family. No Phaser imports
// (same pattern as rainbowColorAt) — the EyeRig calls stepPupil per frame.
//
// Model: damped point mass constrained to a circular track. Player
// acceleration displaces the spring's target opposite to the motion
// (inertia); hitting the rim keeps tangential velocity, so hard impulses
// send the pupil orbiting — the googly "spin" emerges from the model.

export interface PupilState  { x: number; y: number; vx: number; vy: number }
export interface PupilParams {
  restX: number; restY: number;   // rest pose relative to the eye center
  radius: number;                 // max pupil travel from the eye center (logical px)
  stiffness: number;              // spring accel per px of displacement (1/s²)
  damping: number;                // velocity decay rate (1/s)
  accelScale: number;             // px of target displacement per px/s² of player accel
}

/** Tight default character; Googly overrides these to be loose and floppy. */
export const DEFAULT_EYE_PHYSICS = { stiffness: 90, damping: 9, accelScale: 0.008 };

/** Sub-step ceiling keeps the explicit integration stable on slow frames. */
const MAX_STEP_MS   = 32;
/** Total simulated time cap — a 5s tab-switch shouldn't burn 300 sub-steps. */
const MAX_TOTAL_MS  = 100;

export function stepPupil(
  s: PupilState, p: PupilParams, ax: number, ay: number, dtMs: number,
): PupilState {
  let { x, y, vx, vy } = s;
  // Inertia: player acceleration shifts the spring target the opposite way.
  const tx = p.restX - p.accelScale * ax;
  const ty = p.restY - p.accelScale * ay;

  let remaining = Math.min(dtMs, MAX_TOTAL_MS);
  while (remaining > 0) {
    const dt = Math.min(remaining, MAX_STEP_MS) / 1000;
    remaining -= MAX_STEP_MS;

    // Semi-implicit Euler: update velocity first, then position.
    vx += (p.stiffness * (tx - x) - p.damping * vx) * dt;
    vy += (p.stiffness * (ty - y) - p.damping * vy) * dt;
    x += vx * dt;
    y += vy * dt;

    // Rim constraint: clamp to the track, kill the outward velocity
    // component, keep the tangential one (orbiting).
    const d = Math.hypot(x, y);
    if (d > p.radius) {
      const nx = x / d, ny = y / d;
      x = nx * p.radius;
      y = ny * p.radius;
      const vn = vx * nx + vy * ny;
      if (vn > 0) { vx -= vn * nx; vy -= vn * ny; }
    }
  }
  return { x, y, vx, vy };
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/eyePhysics.test.ts`
Expected: PASS (all 7). If `settles` or `moves opposite` fails on tolerance, adjust the assertion tolerances only if the observed behavior is qualitatively right (settling trend, correct sign) — do not weaken sign/radius assertions.

- [ ] **Step 5: Commit**

```bash
git add src/systems/eyePhysics.ts src/systems/__tests__/eyePhysics.test.ts
git commit -m "feat(cosmetics): pure pupil physics (stepPupil) with rim orbit"
```

---

### Task 4: Pure parametric motion — `motionOffsets`

**Files:**
- Create: `src/systems/cosmeticMotion.ts`
- Test: `src/systems/__tests__/cosmeticMotion.test.ts`

**Interfaces:**
- Consumes: `AttachmentAnim` type from Task 1.
- Produces:
  - `interface MotionOffsets { dAngle:number; dx:number; dy:number; scaleMul:number; alphaMul:number }`
  - `const IDENTITY_OFFSETS: MotionOffsets`
  - `function motionOffsets(anim: AttachmentAnim, tMs: number): MotionOffsets`

- [ ] **Step 1: Write the failing tests**

Create `src/systems/__tests__/cosmeticMotion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { motionOffsets, IDENTITY_OFFSETS } from '../cosmeticMotion';

describe('motionOffsets', () => {
  it('spin: 60 rpm turns 90° in 250 ms, wraps within [0, 360)', () => {
    expect(motionOffsets({ type: 'spin', rpm: 60 }, 250).dAngle).toBeCloseTo(90);
    const wrapped = motionOffsets({ type: 'spin', rpm: 60 }, 61000).dAngle;
    expect(wrapped).toBeGreaterThanOrEqual(0);
    expect(wrapped).toBeLessThan(360);
  });

  it('bob: peaks at quarter period, zero at half period', () => {
    const anim = { type: 'bob', periodMs: 1000, amplitudePx: 3 } as const;
    expect(motionOffsets(anim, 250).dy).toBeCloseTo(3);
    expect(motionOffsets(anim, 500).dy).toBeCloseTo(0);
  });

  it('pulse: scale swings by scaleAmp, alpha dips by alphaAmp', () => {
    const anim = { type: 'pulse', periodMs: 1000, scaleAmp: 0.1, alphaAmp: 0.4 } as const;
    expect(motionOffsets(anim, 250).scaleMul).toBeCloseTo(1.1);
    expect(motionOffsets(anim, 750).scaleMul).toBeCloseTo(0.9);
    expect(motionOffsets(anim, 250).alphaMul).toBeCloseTo(0.6);
    const noAlpha = { type: 'pulse', periodMs: 1000, scaleAmp: 0.1 } as const;
    expect(motionOffsets(noAlpha, 250).alphaMul).toBeCloseTo(1);
  });

  it('sheet: identity (frames animate via Phaser, not transforms)', () => {
    expect(motionOffsets({ type: 'sheet', frameW: 32, frameH: 32, frameRate: 8 }, 500))
      .toEqual(IDENTITY_OFFSETS);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/systems/__tests__/cosmeticMotion.test.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/systems/cosmeticMotion.ts`:

```ts
// src/systems/cosmeticMotion.ts
//
// Pure parametric animation math for MotionRig. No Phaser imports.

import type { AttachmentAnim } from '../data/cosmeticDefs';

export interface MotionOffsets {
  dAngle: number;     // degrees added to the attachment's angle
  dx: number; dy: number;   // logical px added to the offset (pre squash-factor)
  scaleMul: number;   // multiplier on the attachment's scale
  alphaMul: number;   // multiplier on alpha (1 = opaque)
}

export const IDENTITY_OFFSETS: MotionOffsets =
  { dAngle: 0, dx: 0, dy: 0, scaleMul: 1, alphaMul: 1 };

export function motionOffsets(anim: AttachmentAnim, tMs: number): MotionOffsets {
  switch (anim.type) {
    case 'spin':
      return { ...IDENTITY_OFFSETS, dAngle: ((tMs / 60000) * anim.rpm * 360) % 360 };
    case 'bob':
      return { ...IDENTITY_OFFSETS, dy: Math.sin((tMs / anim.periodMs) * Math.PI * 2) * anim.amplitudePx };
    case 'pulse': {
      const s = Math.sin((tMs / anim.periodMs) * Math.PI * 2);
      return {
        ...IDENTITY_OFFSETS,
        scaleMul: 1 + s * anim.scaleAmp,
        alphaMul: 1 - (anim.alphaAmp ?? 0) * (0.5 + 0.5 * s),
      };
    }
    case 'sheet':
      return IDENTITY_OFFSETS;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/systems/__tests__/cosmeticMotion.test.ts` → PASS.

- [ ] **Step 5: Commit**

```bash
git add src/systems/cosmeticMotion.ts src/systems/__tests__/cosmeticMotion.test.ts
git commit -m "feat(cosmetics): pure parametric motion offsets (spin/bob/pulse)"
```

---

### Task 5: Rig abstraction + StaticRig + factory; refactor PlayerCosmetics onto it

Behavior-preserving refactor: after this task the game renders exactly as before, but hat/face go through rigs and the sync loop produces the anchor/motion snapshot.

**Files:**
- Create: `src/entities/cosmeticRigs/types.ts`
- Create: `src/entities/cosmeticRigs/StaticRig.ts`
- Create: `src/entities/cosmeticRigs/createAttachmentRig.ts`
- Modify: `src/entities/PlayerCosmetics.ts`

**Interfaces:**
- Consumes: `ResolvedHatRender`, `FaceRender`, `EyesRender` (Tasks 1–2).
- Produces (later tasks import from `./types`, `./StaticRig`, `./createAttachmentRig`):
  - `interface AttachmentAnchor { x:number; y:number; fx:number; fy:number; angle:number }`
  - `interface MotionSnapshot { vx:number; vy:number; ax:number; ay:number; grounded:boolean }`
  - `interface AttachmentRig { readonly objects: Phaser.GameObjects.GameObject[]; update(dtMs:number, anchor:AttachmentAnchor, motion:MotionSnapshot):void; setVisible(v:boolean):void; destroy():void }`
  - `interface StaticRigSpec { textureKey:string; offsetX:number; offsetY:number; baseAngle:number; scale:number; defScale?:number; artScale:number; depth:number }`
  - `class StaticRig implements AttachmentRig` with `protected readonly img: Phaser.GameObjects.Sprite` and `protected readonly spec: StaticRigSpec`
  - `const ART_SCALE = 40 / 174`, `const ATTACHMENT_DEPTH = 12` (exported from `createAttachmentRig.ts`)
  - `function createAttachmentRig(scene: Phaser.Scene, spec: ResolvedHatRender | FaceRender | EyesRender): AttachmentRig | null`

- [ ] **Step 1: Create `src/entities/cosmeticRigs/types.ts`**

```ts
// src/entities/cosmeticRigs/types.ts
//
// The attachment-rig contract: PlayerCosmetics (in-game) and animatedAvatar
// (editor preview) compute one anchor + motion snapshot per frame and forward
// it to every rig. Rigs own their GameObjects; `objects` exists so container
// hosts (the preview) can reparent them.

import Phaser from 'phaser';

export interface AttachmentAnchor {
  x: number; y: number;   // attachment origin (player sprite center; 0,0 in a container)
  fx: number; fy: number; // squash/stretch factors vs base scale (preview: the avatar scale)
  angle: number;          // sprite angle, degrees
}

export interface MotionSnapshot {
  vx: number; vy: number; // player velocity, px/s
  ax: number; ay: number; // player acceleration, px/s²
  grounded: boolean;
}

export interface AttachmentRig {
  readonly objects: Phaser.GameObjects.GameObject[];
  update(dtMs: number, anchor: AttachmentAnchor, motion: MotionSnapshot): void;
  setVisible(visible: boolean): void;
  destroy(): void;
}
```

- [ ] **Step 2: Create `src/entities/cosmeticRigs/StaticRig.ts`**

The transform math is today's `PlayerCosmetics.sync()` hat/face logic, extracted. Uses a Sprite (not Image) so SheetRig can extend it.

```ts
// src/entities/cosmeticRigs/StaticRig.ts

import Phaser from 'phaser';
import type { AttachmentAnchor, AttachmentRig, MotionSnapshot } from './types';

export interface StaticRigSpec {
  textureKey: string;
  offsetX: number; offsetY: number;  // logical px from the attachment origin
  baseAngle: number;                 // designer worn angle (hats); 0 for faces
  scale: number;                     // resolved size multiplier (hats); 1 for faces
  defScale?: number;                 // hat def's unadjusted scale — enables bottom-edge anchoring
  artScale: number;                  // logical px per art px (ART_SCALE)
  depth: number;
}

export class StaticRig implements AttachmentRig {
  protected readonly img: Phaser.GameObjects.Sprite;
  protected readonly spec: StaticRigSpec;
  private readonly offsetY: number;   // spec offset + hat bottom-edge anchor shift
  readonly objects: Phaser.GameObjects.GameObject[];

  constructor(scene: Phaser.Scene, spec: StaticRigSpec) {
    this.spec = spec;
    this.img = scene.add.sprite(0, 0, spec.textureKey)
      .setScale(spec.artScale * spec.scale).setDepth(spec.depth);
    // Keep the hat's bottom edge (contact point) anchored as dScale grows or
    // shrinks it from the def's baseline, instead of scaling from center.
    const bottomAnchor = spec.defScale !== undefined
      ? (this.img.height / 2) * spec.artScale * (spec.defScale - spec.scale)
      : 0;
    this.offsetY = spec.offsetY + bottomAnchor;
    this.objects = [this.img];
  }

  update(_dtMs: number, a: AttachmentAnchor, _m: MotionSnapshot): void {
    const s = this.spec;
    this.img.setPosition(a.x + s.offsetX * a.fx, a.y + this.offsetY * a.fy);
    this.img.setScale(s.artScale * s.scale * a.fx, s.artScale * s.scale * a.fy);
    this.img.setAngle(a.angle + s.baseAngle);
  }

  setVisible(visible: boolean): void { this.img.setVisible(visible); }
  destroy(): void { this.img.destroy(); }
}
```

- [ ] **Step 3: Create `src/entities/cosmeticRigs/createAttachmentRig.ts`**

```ts
// src/entities/cosmeticRigs/createAttachmentRig.ts
//
// Resolved render spec → rig. Returns null when required art is missing
// entirely (item renders nothing — same as today's textures.exists guards).

import Phaser from 'phaser';
import type { FaceRender, EyesRender } from '../../data/cosmeticDefs';
import type { ResolvedHatRender } from '../../systems/cosmeticsLogic';
import type { AttachmentRig } from './types';
import { StaticRig } from './StaticRig';

/** Bag PNG is 174px wide displayed at 40 logical px — attachment art authored
 *  at the same ratio renders at matching scale. */
export const ART_SCALE = 40 / 174;
export const ATTACHMENT_DEPTH = 12;

export function createAttachmentRig(
  scene: Phaser.Scene,
  spec: ResolvedHatRender | FaceRender | EyesRender,
): AttachmentRig | null {
  if (!scene.textures.exists(spec.textureKey)) return null;
  switch (spec.kind) {
    case 'hat':
      return new StaticRig(scene, {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: spec.angle, scale: spec.scale, defScale: spec.defScale,
        artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      });
    case 'face':
    case 'eyes':   // EyeRig lands in Task 7; until then eyes render their flat PNG
      return new StaticRig(scene, {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: 0, scale: 1, artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      });
  }
}
```

- [ ] **Step 4: Refactor `src/entities/PlayerCosmetics.ts`**

Replace the hat/face fields, constructor branches, and sync body. The skin glaze and trail emitter code stays byte-identical. Full new file:

```ts
// src/entities/PlayerCosmetics.ts
//
// Visual cosmetic attachments for the in-game player: hat/face rigs that
// follow the bag through squash/stretch, skin tint, and a movement trail
// emitter. Mirrors PlayerAnimator's POST_UPDATE sync so attachments never lag
// the physics-synced sprite by a frame. Tie color is PlayerAnimator's job.

import Phaser from 'phaser';
import type { ResolvedCosmetics } from '../systems/cosmeticsLogic';
import type { AttachmentRig } from './cosmeticRigs/types';
import { createAttachmentRig } from './cosmeticRigs/createAttachmentRig';

/** Trail emits only while actually moving. */
const TRAIL_MIN_SPEED = 60;
/** Skin glaze strength — how strongly the flat skin color washes the bag. */
const SKIN_GLAZE_ALPHA = 0.26;

export class PlayerCosmetics {
  private readonly sprite: Phaser.Types.Physics.Arcade.SpriteWithDynamicBody;
  private readonly scene:  Phaser.Scene;
  private readonly baseScaleX: number;
  private readonly baseScaleY: number;

  private hatRig:  AttachmentRig | null = null;
  private faceRig: AttachmentRig | null = null;
  private skinGlaze: Phaser.GameObjects.Image | null = null;
  private emitter: Phaser.GameObjects.Particles.ParticleEmitter | null = null;
  private hidden = false;
  private prevVx = 0;
  private prevVy = 0;

  constructor(
    sprite:   Phaser.Types.Physics.Arcade.SpriteWithDynamicBody,
    scene:    Phaser.Scene,
    resolved: ResolvedCosmetics,
  ) {
    this.sprite     = sprite;
    this.scene      = scene;
    this.baseScaleX = sprite.scaleX;
    this.baseScaleY = sprite.scaleY;

    if (resolved.skinTint !== null) {
      // Multiply-tint alone is invisible on the near-black bag art, so lay a
      // translucent flat-color copy of the sprite over it (tintFill glaze).
      sprite.setTint(resolved.skinTint);
      this.skinGlaze = scene.add.image(sprite.x, sprite.y, sprite.texture.key)
        .setTintFill(resolved.skinTint).setAlpha(SKIN_GLAZE_ALPHA)
        .setDepth(sprite.depth + 0.1);
    }

    if (resolved.hat)  this.hatRig  = createAttachmentRig(scene, resolved.hat);
    if (resolved.face) this.faceRig = createAttachmentRig(scene, resolved.face);

    if (resolved.trail) {
      const t = resolved.trail;
      this.emitter = scene.add.particles(0, 0, t.textureKey, {
        tint:      t.tint,
        frequency: t.frequency,
        speedY:    { min: t.speedY[0], max: t.speedY[1] },
        speedX:    { min: -20, max: 20 },
        lifespan:  t.lifespan,
        scale:     { start: t.scale[0], end: t.scale[1] },
        alpha:     { start: t.alpha, end: 0 },
        emitting:  false,
      }).setDepth(9);
      this.emitter.startFollow(sprite);
    }

    scene.events.on(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
  }

  /** Hide everything (death / successful placement) — mirrors the animator's dormant path. */
  hide(): void {
    this.hidden = true;
    this.hatRig?.setVisible(false);
    this.faceRig?.setVisible(false);
    this.skinGlaze?.setVisible(false);
    if (this.emitter) { this.emitter.stop(); this.emitter.setVisible(false); }
  }

  destroy(): void {
    this.scene.events.off(Phaser.Scenes.Events.POST_UPDATE, this.sync, this);
    this.hatRig?.destroy();
    this.faceRig?.destroy();
    this.skinGlaze?.destroy();
    this.emitter?.destroy();
  }

  private sync(_time: number, delta: number): void {
    if (this.hidden) return;
    // Squash factors relative to the base display scale, so attachments
    // stretch with the bag through the animator's keyframes.
    const fx = this.sprite.scaleX / this.baseScaleX;
    const fy = this.sprite.scaleY / this.baseScaleY;
    const body = this.sprite.body;
    const dt = Math.max(delta, 1);
    const motion = {
      vx: body.velocity.x,
      vy: body.velocity.y,
      ax: (body.velocity.x - this.prevVx) * 1000 / dt,
      ay: (body.velocity.y - this.prevVy) * 1000 / dt,
      grounded: body.blocked.down || body.touching.down,
    };
    this.prevVx = body.velocity.x;
    this.prevVy = body.velocity.y;
    const anchor = {
      x: this.sprite.x, y: this.sprite.y, fx, fy, angle: this.sprite.angle,
    };

    this.hatRig?.update(delta, anchor, motion);
    this.faceRig?.update(delta, anchor, motion);

    if (this.skinGlaze) {
      this.skinGlaze.setPosition(this.sprite.x, this.sprite.y);
      this.skinGlaze.setScale(this.sprite.scaleX, this.sprite.scaleY);
      this.skinGlaze.setAngle(this.sprite.angle);
      this.skinGlaze.setFlip(this.sprite.flipX, this.sprite.flipY);
      this.skinGlaze.setVisible(this.sprite.visible);
    }
    if (this.emitter) {
      const speed = Math.hypot(body.velocity.x, body.velocity.y);
      if (speed > TRAIL_MIN_SPEED && !this.emitter.emitting) this.emitter.start();
      else if (speed <= TRAIL_MIN_SPEED && this.emitter.emitting) this.emitter.stop();
    }
  }
}
```

Note the old file's `ART_SCALE` constant moved to `createAttachmentRig.ts`; nothing else imported it (verify with `grep -rn "PlayerCosmetics" src --include=*.ts` — only GameScene/InfiniteGameScene construct it, signature unchanged).

- [ ] **Step 5: Build + full suite**

Run: `npm run build` → green. Run: `npm test` → green (no unit tests cover the rigs; this step catches type breaks).

- [ ] **Step 6: Behavior check (quick smoke)**

If localhost:3000 responds, load the game with an equipped hat + face and confirm attachments track the player exactly as before (offsets, squash-follow, hide on death). If no dev server is available, defer to Task 10's smoke test and note it.

- [ ] **Step 7: Commit**

```bash
git add src/entities/cosmeticRigs src/entities/PlayerCosmetics.ts
git commit -m "refactor(cosmetics): attachment rig abstraction; PlayerCosmetics feeds anchor+motion"
```

---

### Task 6: MotionRig + SheetRig + sprite-sheet loading

**Files:**
- Create: `src/entities/cosmeticRigs/MotionRig.ts`
- Create: `src/entities/cosmeticRigs/SheetRig.ts`
- Modify: `src/entities/cosmeticRigs/createAttachmentRig.ts` (anim dispatch)
- Modify: `src/scenes/loadGameAssets.ts` (spritesheet loading + anim registration)

**Interfaces:**
- Consumes: `StaticRig`/`StaticRigSpec` (Task 5), `motionOffsets` (Task 4), `AttachmentAnim` (Task 1).
- Produces:
  - `class MotionRig extends StaticRig` — constructor `(scene, spec: StaticRigSpec, anim: Exclude<AttachmentAnim, {type:'sheet'}>)`
  - `class SheetRig extends StaticRig` — constructor `(scene, spec: StaticRigSpec, animKey: string)`
  - Sheet animation key convention: `` `anim-${textureKey}` `` (e.g. `anim-cos-hat_flame`), registered in `loadGameAssets`' COMPLETE handler.

- [ ] **Step 1: Create `src/entities/cosmeticRigs/MotionRig.ts`**

```ts
// src/entities/cosmeticRigs/MotionRig.ts

import Phaser from 'phaser';
import type { AttachmentAnim } from '../../data/cosmeticDefs';
import { motionOffsets } from '../../systems/cosmeticMotion';
import { StaticRig, type StaticRigSpec } from './StaticRig';
import type { AttachmentAnchor, MotionSnapshot } from './types';

/** Static transform plus a data-described parametric layer (spin/bob/pulse). */
export class MotionRig extends StaticRig {
  private readonly anim: Exclude<AttachmentAnim, { type: 'sheet' }>;
  private tMs = 0;

  constructor(scene: Phaser.Scene, spec: StaticRigSpec,
              anim: Exclude<AttachmentAnim, { type: 'sheet' }>) {
    super(scene, spec);
    this.anim = anim;
  }

  update(dtMs: number, a: AttachmentAnchor, m: MotionSnapshot): void {
    super.update(dtMs, a, m);
    this.tMs += dtMs;
    const o = motionOffsets(this.anim, this.tMs);
    this.img.setPosition(this.img.x + o.dx * a.fx, this.img.y + o.dy * a.fy);
    this.img.setAngle(this.img.angle + o.dAngle);
    this.img.setScale(this.img.scaleX * o.scaleMul, this.img.scaleY * o.scaleMul);
    this.img.setAlpha(o.alphaMul);
  }
}
```

- [ ] **Step 2: Create `src/entities/cosmeticRigs/SheetRig.ts`**

```ts
// src/entities/cosmeticRigs/SheetRig.ts

import Phaser from 'phaser';
import { StaticRig, type StaticRigSpec } from './StaticRig';

/** Flipbook attachment: StaticRig transform + a looping spritesheet anim.
 *  If the anim was never registered (art missing frames), stays on frame 0. */
export class SheetRig extends StaticRig {
  constructor(scene: Phaser.Scene, spec: StaticRigSpec, animKey: string) {
    super(scene, spec);
    if (scene.anims.exists(animKey)) this.img.play(animKey);
  }
}
```

- [ ] **Step 3: Add anim dispatch to `createAttachmentRig.ts`**

Replace the function body. Note the `textures.exists` guard moves **inside** the hat/face cases — Task 7's `eyes` case must not require the flat PNG when the parts art exists:

```ts
import { MotionRig } from './MotionRig';
import { SheetRig } from './SheetRig';
```

```ts
  switch (spec.kind) {
    case 'hat': {
      if (!scene.textures.exists(spec.textureKey)) return null;
      const rigSpec = {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: spec.angle, scale: spec.scale, defScale: spec.defScale,
        artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      };
      if (spec.anim?.type === 'sheet') return new SheetRig(scene, rigSpec, `anim-${spec.textureKey}`);
      if (spec.anim)                   return new MotionRig(scene, rigSpec, spec.anim);
      return new StaticRig(scene, rigSpec);
    }
    case 'face': {
      if (!scene.textures.exists(spec.textureKey)) return null;
      const rigSpec = {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: 0, scale: 1, artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      };
      if (spec.anim?.type === 'sheet') return new SheetRig(scene, rigSpec, `anim-${spec.textureKey}`);
      if (spec.anim)                   return new MotionRig(scene, rigSpec, spec.anim);
      return new StaticRig(scene, rigSpec);
    }
    case 'eyes':   // EyeRig lands in Task 7; until then eyes render their flat PNG
      if (!scene.textures.exists(spec.textureKey)) return null;
      return new StaticRig(scene, {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: 0, scale: 1, artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      });
  }
```

- [ ] **Step 4: Sheet-aware loading in `src/scenes/loadGameAssets.ts`**

Add to imports:

```ts
import { getCosmeticDef, type AttachmentAnim } from '../data/cosmeticDefs';
```

Add a helper above `loadGameAssets` and replace the cosmetic-PNG loop (currently lines 68–71):

```ts
/** Sheet anim spec for a `cos-<id>` texture key, if that def declares one. */
function sheetAnimFor(textureKey: string): Extract<AttachmentAnim, { type: 'sheet' }> | undefined {
  const def = getCosmeticDef(textureKey.slice('cos-'.length));
  const render = def?.render;
  if (!render || (render.kind !== 'hat' && render.kind !== 'face')) return undefined;
  return render.anim?.type === 'sheet' ? render.anim : undefined;
}
```

```ts
  // ── Cosmetic PNGs (auto-manifest; empty until art lands) ─────────────────
  // Defs that declare a sheet anim load as spritesheets; everything else
  // (static art, shared cos-part-* pieces) loads as a plain image.
  for (const [key, url] of Object.entries(COSMETIC_ART)) {
    const sheet = sheetAnimFor(key);
    if (sheet) scene.load.spritesheet(key, url, { frameWidth: sheet.frameW, frameHeight: sheet.frameH });
    else scene.load.image(key, url);
  }
```

And inside the existing `COMPLETE` handler, after the vulture anims:

```ts
    // Register flipbook anims for sheet-based cosmetics.
    for (const key of Object.keys(COSMETIC_ART)) {
      const sheet = sheetAnimFor(key);
      if (!sheet || !scene.textures.exists(key) || scene.anims.exists(`anim-${key}`)) continue;
      scene.anims.create({
        key: `anim-${key}`,
        frames: scene.anims.generateFrameNumbers(key, {}),
        frameRate: sheet.frameRate,
        repeat: -1,
      });
    }
```

- [ ] **Step 5: Build + full suite**

Run: `npm run build` && `npm test` → green. (No sheet art exists yet — the loader branch is inert until a def declares `type:'sheet'`; the propeller `spin` def from Task 1 exercises MotionRig.)

- [ ] **Step 6: Commit**

```bash
git add src/entities/cosmeticRigs src/scenes/loadGameAssets.ts
git commit -m "feat(cosmetics): MotionRig + SheetRig + spritesheet-aware cosmetic loading"
```

---

### Task 7: EyeRig + shared part art plumbing

**Files:**
- Create: `src/entities/cosmeticRigs/EyeRig.ts`
- Modify: `src/data/cosmeticArt.ts` (parts glob + part key constants)
- Modify: `src/entities/cosmeticRigs/createAttachmentRig.ts` (eyes branch)
- Modify: `src/sprites/cosmetics/SOURCES.md` (document the part-art contract)

**Interfaces:**
- Consumes: `stepPupil`/`DEFAULT_EYE_PHYSICS`/`PupilState` (Task 3), `EyesRender` (Task 1), `StaticRig` fallback (Task 5).
- Produces:
  - `const PART_EYE_WHITE = 'cos-part_eyewhite'`, `const PART_PUPIL = 'cos-part_pupil'` (exported from `src/data/cosmeticArt.ts`)
  - `class EyeRig implements AttachmentRig` — constructor `(scene, spec: EyesRender, artScale: number, depth: number, whiteKey: string, pupilKey: string)`
  - Art contract: drop `part_eyewhite.png` and `part_pupil.png` into `src/sprites/cosmetics/parts/`, authored in the same 174-px-bag art space as hats/faces (rendered at ART_SCALE × per-eye whiteScale/pupilScale).

- [ ] **Step 1: Parts glob in `src/data/cosmeticArt.ts`**

Add the parts folder to the `files` spread and export the two keys:

```ts
const files: Record<string, string> = {
  ...(import.meta.glob('../sprites/cosmetics/hats/*.png',  { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('../sprites/cosmetics/face/*.png',  { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
  ...(import.meta.glob('../sprites/cosmetics/parts/*.png', { eager: true, query: '?url', import: 'default' }) as Record<string, string>),
};
```

```ts
/** Shared part textures for the physics-driven eye rig. Both must exist for
 *  the live rig; otherwise eye items fall back to their flat PNG. */
export const PART_EYE_WHITE = 'cos-part_eyewhite';
export const PART_PUPIL     = 'cos-part_pupil';
```

(Files named `part_eyewhite.png` / `part_pupil.png` map to those keys through the existing `cos-<stem>` rule — no loader change needed; `sheetAnimFor` returns undefined for them so they load as plain images.)

- [ ] **Step 2: Create `src/entities/cosmeticRigs/EyeRig.ts`**

```ts
// src/entities/cosmeticRigs/EyeRig.ts
//
// Physics-driven eye family: per eye, a fixed white disc + a pupil whose
// position is simulated by eyePhysics from player acceleration. Rest poses
// from the def give each item (googly / lazy / crazy / cross) its character.

import Phaser from 'phaser';
import type { EyesRender } from '../../data/cosmeticDefs';
import { stepPupil, DEFAULT_EYE_PHYSICS, type PupilState, type PupilParams } from '../../systems/eyePhysics';
import type { AttachmentAnchor, AttachmentRig, MotionSnapshot } from './types';

export class EyeRig implements AttachmentRig {
  private readonly spec: EyesRender;
  private readonly artScale: number;
  private readonly whites: Phaser.GameObjects.Image[] = [];
  private readonly pupils: Phaser.GameObjects.Image[] = [];
  private readonly states: PupilState[] = [];
  private readonly params: PupilParams[];
  readonly objects: Phaser.GameObjects.GameObject[] = [];

  constructor(scene: Phaser.Scene, spec: EyesRender,
              artScale: number, depth: number,
              whiteKey: string, pupilKey: string) {
    this.spec = spec;
    this.artScale = artScale;
    const phys = { ...DEFAULT_EYE_PHYSICS, ...spec.physics };
    this.params = spec.eyes.map(eye => ({
      restX: eye.restX, restY: eye.restY, radius: eye.radius, ...phys,
    }));
    for (const eye of spec.eyes) {
      const white = scene.add.image(0, 0, whiteKey)
        .setScale(artScale * eye.whiteScale).setDepth(depth);
      const pupil = scene.add.image(0, 0, pupilKey)
        .setScale(artScale * eye.pupilScale).setDepth(depth + 0.1);
      this.whites.push(white);
      this.pupils.push(pupil);
      this.states.push({ x: eye.restX, y: eye.restY, vx: 0, vy: 0 });
      this.objects.push(white, pupil);
    }
  }

  update(dtMs: number, a: AttachmentAnchor, m: MotionSnapshot): void {
    this.spec.eyes.forEach((eye, i) => {
      this.states[i] = stepPupil(this.states[i], this.params[i], m.ax, m.ay, dtMs);
      const cx = a.x + (this.spec.offsetX + eye.x) * a.fx;
      const cy = a.y + (this.spec.offsetY + eye.y) * a.fy;
      this.whites[i].setPosition(cx, cy)
        .setScale(this.artScale * eye.whiteScale * a.fx, this.artScale * eye.whiteScale * a.fy)
        .setAngle(a.angle);
      this.pupils[i].setPosition(cx + this.states[i].x * a.fx, cy + this.states[i].y * a.fy)
        .setScale(this.artScale * eye.pupilScale * a.fx, this.artScale * eye.pupilScale * a.fy)
        .setAngle(a.angle);
    });
  }

  setVisible(visible: boolean): void {
    for (const o of [...this.whites, ...this.pupils]) o.setVisible(visible);
  }

  destroy(): void {
    for (const o of [...this.whites, ...this.pupils]) o.destroy();
  }
}
```

- [ ] **Step 3: Wire the eyes branch in `createAttachmentRig.ts`**

```ts
import { PART_EYE_WHITE, PART_PUPIL } from '../../data/cosmeticArt';
import { EyeRig } from './EyeRig';
```

Replace the `case 'eyes':` branch (Task 6 already moved the `textures.exists` guard inside each case, so the live-rig path here correctly works without the flat PNG):

```ts
    case 'eyes': {
      if (scene.textures.exists(PART_EYE_WHITE) && scene.textures.exists(PART_PUPIL)) {
        return new EyeRig(scene, spec, ART_SCALE, ATTACHMENT_DEPTH, PART_EYE_WHITE, PART_PUPIL);
      }
      // Parts art not landed yet — flat store PNG, exactly the old behavior.
      if (!scene.textures.exists(spec.textureKey)) return null;
      return new StaticRig(scene, {
        textureKey: spec.textureKey, offsetX: spec.offsetX, offsetY: spec.offsetY,
        baseAngle: 0, scale: 1, artScale: ART_SCALE, depth: ATTACHMENT_DEPTH,
      });
    }
```

- [ ] **Step 4: Document the part-art contract in `src/sprites/cosmetics/SOURCES.md`**

Append:

```md
## parts/ — shared rig pieces
- `part_eyewhite.png`, `part_pupil.png`: white disc + pupil disc for the
  physics-driven eye items (face_googly & co). Author in the same art space
  as hats/faces (174 px bag width ↔ 40 logical px): the white disc should be
  ~2× an eye's track radius + pupil radius; per-item sizing is tuned via
  whiteScale/pupilScale in cosmeticDefs. Until both files exist, eye items
  render their flat face_*.png.
```

- [ ] **Step 5: Build + full suite**

Run: `npm run build` && `npm test` → green. (Parts PNGs don't exist yet, so the fallback branch is live — that's expected and correct.)

- [ ] **Step 6: Commit**

```bash
git add src/entities/cosmeticRigs src/data/cosmeticArt.ts src/sprites/cosmetics/SOURCES.md
git commit -m "feat(cosmetics): physics-driven EyeRig with flat-PNG fallback"
```

---

### Task 8: Animated editor preview

**Files:**
- Modify: `src/ui/avatar.ts` (extract the shared base compositor)
- Create: `src/ui/animatedAvatar.ts`
- Modify: `src/scenes/CustomizationScene.ts:37,170-188` (swap preview to the animated handle)

**Interfaces:**
- Consumes: `createAttachmentRig` + rig types (Tasks 5–7), `resolveCosmetics` (Task 2).
- Produces:
  - `function composeAvatarBase(scene, container, r: ResolvedCosmetics, s: number): void` (exported from `src/ui/avatar.ts` — bag + glaze + tie band/strings, no hat/face)
  - `interface AnimatedAvatarHandle { container: Phaser.GameObjects.Container; destroy(): void }`
  - `function createAnimatedAvatar(scene, loadout: EquippedLoadout, opts: { x:number; y:number; scale:number }, adjustments?: HatAdjustments): AnimatedAvatarHandle`

- [ ] **Step 1: Extract `composeAvatarBase` in `src/ui/avatar.ts`**

Move the bag/glaze/tie block (current lines 33–53 of `composeAvatar`) into an exported function; `composeAvatar` calls it then keeps its static hat/face logic:

```ts
/** Bag + skin glaze + tie band/strings into `container`. Shared by the
 *  static compositor and the animated editor preview. */
export function composeAvatarBase(
  scene: Phaser.Scene,
  container: Phaser.GameObjects.Container,
  r: ResolvedCosmetics,
  s: number,
): void {
  const bag = scene.add.image(0, 0, 'trashbag-nostrings')
    .setDisplaySize(PLAYER_WIDTH * s, PLAYER_HEIGHT * s);
  if (r.skinTint !== null) bag.setTint(r.skinTint);
  container.add(bag);
  if (r.skinTint !== null) {
    // Flat-color glaze — multiply tint alone is invisible on near-black art.
    const glaze = scene.add.image(0, 0, 'trashbag-nostrings')
      .setDisplaySize(PLAYER_WIDTH * s, PLAYER_HEIGHT * s)
      .setTintFill(r.skinTint).setAlpha(0.26);
    container.add(glaze);
  }

  // Tie: paint the collar band over the baked-in red one, then hang the
  // strings in front of the bag (same as the in-game animator's gfx layer).
  const strings = scene.add.graphics();
  drawTieBand(strings, r.tieColor, 0, COLLAR_Y * s, s);
  strings.lineStyle(STRING_W * s, r.tieColor, 1);
  const st = IDLE_STRINGS;
  drawBezier(strings, -st.x0 * s, COLLAR_Y * s, -st.cpX * s, st.cpY * s, -st.endX * s, st.endY * s);
  drawBezier(strings,  st.x0 * s, COLLAR_Y * s,  st.cpX * s, st.cpY * s,  st.endX * s, st.endY * s);
  container.add(strings);
}
```

`composeAvatar` becomes: `const r = resolveCosmetics(...); const container = scene.add.container(...); composeAvatarBase(scene, container, r, s);` followed by its existing hat/face image code (add `import type { ResolvedCosmetics }` to the imports). Requires exporting nothing else; `drawBezier`, `IDLE_STRINGS`, `COLLAR_Y`, `STRING_W` stay module-private.

- [ ] **Step 2: Create `src/ui/animatedAvatar.ts`**

```ts
// src/ui/animatedAvatar.ts
//
// Live mini-player for the character editor: same composition as
// composeAvatar, but hat/face go through the attachment-rig factory and tick
// on the scene UPDATE event. The mannequin doesn't move, so a small random
// acceleration impulse fires every couple of seconds to show off
// motion-reactive rigs (googly eyes); spin/bob/sheet rigs animate regardless.

import Phaser from 'phaser';
import type { EquippedLoadout } from '../../shared/cosmeticCatalog';
import { resolveCosmetics, type HatAdjustments } from '../systems/cosmeticsLogic';
import { createAttachmentRig } from '../entities/cosmeticRigs/createAttachmentRig';
import type { AttachmentRig, AttachmentAnchor } from '../entities/cosmeticRigs/types';
import { composeAvatarBase } from './avatar';

const PULSE_MIN_GAP_MS = 2000;
const PULSE_RAND_MS    = 1200;
const PULSE_LEN_MS     = 130;
const PULSE_AX         = 5000;   // px/s² — enough to slosh even tight eye items
const PULSE_AY         = 3500;

export interface AnimatedAvatarHandle {
  container: Phaser.GameObjects.Container;
  destroy(): void;
}

export function createAnimatedAvatar(
  scene:   Phaser.Scene,
  loadout: EquippedLoadout,
  opts:    { x: number; y: number; scale: number },
  adjustments: HatAdjustments = {},
): AnimatedAvatarHandle {
  const r = resolveCosmetics(loadout, adjustments);
  const s = opts.scale;
  const container = scene.add.container(opts.x, opts.y);
  composeAvatarBase(scene, container, r, s);

  const rigs: AttachmentRig[] = [];
  for (const spec of [r.hat, r.face]) {
    if (!spec) continue;
    const rig = createAttachmentRig(scene, spec);
    if (rig) { rigs.push(rig); container.add(rig.objects); }
  }

  // Rig objects are container children: origin is (0,0) local, and the
  // container transform (breathing/hop tweens) carries them. fx/fy = s
  // reproduces composeAvatar's `offset*s` / `ART_SCALE*s` math exactly.
  const anchor: AttachmentAnchor = { x: 0, y: 0, fx: s, fy: s, angle: 0 };

  let pulseAx = 0, pulseAy = 0, pulseLeftMs = 0;
  let nextPulseMs = PULSE_MIN_GAP_MS / 2;
  const onUpdate = (_time: number, delta: number): void => {
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

  return {
    container,
    destroy(): void {
      scene.events.off(Phaser.Scenes.Events.UPDATE, onUpdate);
      for (const rig of rigs) rig.destroy();
      container.destroy();
    },
  };
}
```

- [ ] **Step 3: Swap the preview in `src/scenes/CustomizationScene.ts`**

Change the field (line 37), `rebuildPreview()` (lines 170–180), and `hopPreview()` (lines 182–188):

```ts
import { createAnimatedAvatar, type AnimatedAvatarHandle } from '../ui/animatedAvatar';
```

```ts
  private preview: AnimatedAvatarHandle | null = null;
```

```ts
  private rebuildPreview(): void {
    this.preview?.destroy();
    this.preview = createAnimatedAvatar(this, getEquippedCosmetics(),
      { x: logicalWidth(this) / 2, y: PREVIEW_Y, scale: PREVIEW_SCALE }, getHatAdjustments());
    this.preview.container.setDepth(5);
    // Idle breathing
    this.tweens.add({
      targets: this.preview.container, scaleX: 1.025, scaleY: 0.975,
      duration: 1100, yoyo: true, repeat: -1, ease: 'Sine.InOut',
    });
  }

  private hopPreview(): void {
    if (!this.preview) return;
    this.tweens.add({
      targets: this.preview.container, y: PREVIEW_Y - 34,
      duration: 220, yoyo: true, ease: 'Quad.Out',
    });
  }
```

Then grep the scene for any other `this.preview` reference (`grep -n "this.preview" src/scenes/CustomizationScene.ts`) and adapt each to `this.preview.container` (tweens/position reads) — the `composeAvatar` import can be removed if now unused.

- [ ] **Step 4: Build + full suite**

Run: `npm run build` && `npm test` → green.

- [ ] **Step 5: Visual check**

Scene-preview the editor (invoke the `heap-scene-preview` skill): `npm run scene-preview -- Customization '{}' pixel7`. Confirm the preview mannequin composes correctly (bag, tie, hat, face present at the right spots). Animation itself can't show in a static screenshot — Task 10 smoke-tests it live.

- [ ] **Step 6: Commit**

```bash
git add src/ui/avatar.ts src/ui/animatedAvatar.ts src/scenes/CustomizationScene.ts
git commit -m "feat(cosmetics): animated character-editor preview via attachment rigs"
```

---

### Task 9: Static compositor renders eyes at rest pose

Menu avatar + leaderboard rows stay static but should match the in-game rig look once parts art lands.

**Files:**
- Modify: `src/ui/avatar.ts` (face branch of `composeAvatar`)

**Interfaces:**
- Consumes: `PART_EYE_WHITE`/`PART_PUPIL` (Task 7), widened `ResolvedCosmetics.face` (Task 2).
- Produces: no new exports — `composeAvatar` signature unchanged.

- [ ] **Step 1: Implement the eyes branch**

In `composeAvatar`, add the import and replace the face block (currently `if (r.face && scene.textures.exists(r.face.textureKey)) { ... }`):

```ts
import { PART_EYE_WHITE, PART_PUPIL } from '../data/cosmeticArt';
```

```ts
  if (r.face?.kind === 'eyes') {
    const e = r.face;
    if (scene.textures.exists(PART_EYE_WHITE) && scene.textures.exists(PART_PUPIL)) {
      // Whites + pupils frozen at rest pose — matches the in-game rig look.
      for (const eye of e.eyes) {
        const cx = (e.offsetX + eye.x) * s, cy = (e.offsetY + eye.y) * s;
        container.add(scene.add.image(cx, cy, PART_EYE_WHITE)
          .setScale(ART_SCALE * s * eye.whiteScale));
        container.add(scene.add.image(cx + eye.restX * s, cy + eye.restY * s, PART_PUPIL)
          .setScale(ART_SCALE * s * eye.pupilScale));
      }
    } else if (scene.textures.exists(e.textureKey)) {
      // Parts art not landed — flat store PNG, same as the rig fallback.
      container.add(scene.add.image(e.offsetX * s, e.offsetY * s, e.textureKey)
        .setScale(ART_SCALE * s));
    }
  } else if (r.face && scene.textures.exists(r.face.textureKey)) {
    container.add(scene.add.image(r.face.offsetX * s, r.face.offsetY * s, r.face.textureKey)
      .setScale(ART_SCALE * s));
  }
```

- [ ] **Step 2: Build + full suite**

Run: `npm run build` && `npm test` → green.

- [ ] **Step 3: Commit**

```bash
git add src/ui/avatar.ts
git commit -m "feat(cosmetics): static avatar renders eye items at rest pose"
```

---

### Task 10: End-to-end verification

**Files:** none created — verification only. Fix-forward anything found, committing fixes individually.

- [ ] **Step 1: Full gates**

Run: `npm test` → all green. Run: `npm run build` → green.

- [ ] **Step 2: Live smoke test**

Invoke the `smoke-testing-heap` skill. Use the user's dev server on localhost:3000 if it responds; otherwise start one. Verify:

1. **Regression:** equip a static hat + shades + skin + trail → all attachments track the player through jumps/squash exactly as pre-refactor; death hides them.
2. **MotionRig:** equip `hat_propeller` → the cap visibly rotates in-game and in the editor preview. Judge the whole-cap spin look: if it reads wrong, tune `rpm` down or remove the anim from the def (designer call — flag to the user).
3. **Eye fallback:** equip Googly Eyes with no parts art present → flat PNG renders, no console errors.
4. **Eye rig (only if the user has provided `part_eyewhite.png`/`part_pupil.png`):** pupils rest per item personality; running slams them backward; landing slams them down; a hard direction flip sends them around the rim; editor preview sloshes on the periodic impulse. Tune def `radius`/rest poses and `EyesPhysics` per item with the user.
5. **Editor preview:** open Customization → preview animates; switching items rebuilds cleanly (no orphaned parts, no listener leak errors); breathing + hop tweens still work; leaderboard and menu avatar still render statically.

- [ ] **Step 3: Update memory + report**

Report smoke results honestly (what was verified vs. deferred for missing art). Do not push or open a PR until the user confirms the smoke test — per repo discipline, the user decides when it's push-ready.
