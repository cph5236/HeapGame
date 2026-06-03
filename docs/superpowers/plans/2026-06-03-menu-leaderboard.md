# Menu Leaderboard Entry — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a trophy button beside the main-menu heap picker that opens the existing `LeaderboardScene` for the active heap, returning to the menu on close.

**Architecture:** The leaderboard already exists as a paused-overlay modal launched from `HeapSelectScene`. We add a second launch site (the menu) and generalise the modal's hardcoded return scene. The menu's heap-picker row is split ≈85% picker / ≈15% trophy, reusing the row's geometry and entrance animation.

**Tech Stack:** Phaser 3.90, TypeScript. Phaser scenes are verified via `npm run build` + `npm run scene-preview` + device check — this repo does not unit-test scene wiring (pure logic lives in `systems/` and is tested there). The only logic change here (return-scene defaulting) is trivial; no new unit test is warranted (per the spec).

Spec: `docs/superpowers/specs/2026-06-03-menu-leaderboard-design.md`

---

## File Structure

| File | Responsibility | Change |
|------|----------------|--------|
| `src/scenes/LeaderboardScene.ts` | The leaderboard modal | Add `returnScene` to its data; resume that scene on close (default `'HeapSelectScene'`). |
| `src/scenes/MenuScene.ts` | Main menu | Shrink picker bar to 264px; add a 48×48 trophy button + tap zone, entrance fade, ready-gate, launch handler, `L` hotkey, legend entry. |

`src/scenes/HeapSelectScene.ts` is intentionally **not** modified — the `returnScene` default (`'HeapSelectScene'`) preserves its existing behaviour.

---

## Task 1: Parameterise the leaderboard's return scene

**Files:**
- Modify: `src/scenes/LeaderboardScene.ts`

- [ ] **Step 1: Add `returnScene` to the scene data interface**

In `src/scenes/LeaderboardScene.ts`, find:

```typescript
export interface LeaderboardSceneData {
  heapId:   string;
  heapName: string;
  playerId: string;
}
```

Replace with:

```typescript
export interface LeaderboardSceneData {
  heapId:   string;
  heapName: string;
  playerId: string;
  /** Scene to resume when the modal closes. Defaults to 'HeapSelectScene'
   *  so existing call sites are unaffected. */
  returnScene?: string;
}
```

- [ ] **Step 2: Add the field and store it in `init()`**

Find the field declarations:

```typescript
  private heapId!:   string;
  private heapName!: string;
  private playerId!: string;
```

Replace with:

```typescript
  private heapId!:   string;
  private heapName!: string;
  private playerId!: string;
  private returnScene!: string;
```

Then find the `init()` body:

```typescript
  init(data: LeaderboardSceneData): void {
    this.heapId   = data.heapId;
    this.heapName = data.heapName;
    this.playerId = data.playerId;
    this.page     = 0;
    this.total    = 0;
    this.playerRank = null;
    this.scrollY  = 0;
  }
```

Replace with:

```typescript
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
```

- [ ] **Step 3: Resume the configured scene on close**

Find:

```typescript
  private closeModal(): void {
    this.scene.resume('HeapSelectScene');
    this.scene.stop();
  }
```

Replace with:

```typescript
  private closeModal(): void {
    this.scene.resume(this.returnScene);
    this.scene.stop();
  }
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds with no TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/LeaderboardScene.ts
git commit -m "feat(leaderboard): parameterise modal return scene

Add optional returnScene to LeaderboardSceneData (default 'HeapSelectScene')
so the modal can be launched from the main menu and return there."
```

---

## Task 2: Add the trophy button to the menu

**Files:**
- Modify: `src/scenes/MenuScene.ts`

- [ ] **Step 1: Add fields for the trophy graphics**

Find:

```typescript
  private heapPickerBg!:    Phaser.GameObjects.Graphics;
  private heapPickerText!:  Phaser.GameObjects.Text;
  private heapPickerStars!: Phaser.GameObjects.Text;
```

Replace with:

```typescript
  private heapPickerBg!:    Phaser.GameObjects.Graphics;
  private heapPickerText!:  Phaser.GameObjects.Text;
  private heapPickerStars!: Phaser.GameObjects.Text;
  private leaderboardBg!:   Phaser.GameObjects.Graphics;
  private leaderboardIcon!: Phaser.GameObjects.Text;
```

- [ ] **Step 2: Replace `createHeapPicker()` with the split row + trophy + launch handler**

Replace the entire existing `createHeapPicker()` method (from `private createHeapPicker(): void {` through its closing `}`) with:

```typescript
  private createHeapPicker(): void {
    const shift = this.layoutShift;
    const rowY  = 504 - shift;
    const left  = this.scale.width / 2 - 160;

    // Heap-picker bar — left ~85% of the 320px row (264px), 8px gap, 48px trophy.
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

    // Leaderboard trophy button — right 48px square of the row.
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
    this.leaderboardIcon = this.add.text(trophyCx, rowY, '🏆', {
      fontSize: '22px',
    }).setOrigin(0.5).setAlpha(0).setDepth(9);

    // Centre of the picker bar (text centres within the 264px bar, not the row).
    const barCx = left + 132;            // = width/2 - 28

    // Refresh from current registry — runs once now (placeholder if catalog is
    // still loading) and again when `heapCatalogReady` fires from BootScene.
    const refresh = (): void => {
      const ready  = this.game.registry.get('heapCatalogReady') === true;
      const params = (this.game.registry.get('heapParams') as HeapParams | undefined) ?? DEFAULT_HEAP_PARAMS;

      const nameLabel  = ready ? `▾ ${params.name}  ` : 'Heaps loading…';
      const starsLabel = ready ? formatDifficulty(params.difficulty) : '';

      this.heapPickerText.setText(nameLabel);
      this.heapPickerStars.setText(starsLabel);
      this.heapPickerText.setColor(ready ? '#ffffff' : '#778899');

      // Re-center both texts together each refresh — widths change with text.
      const totalW = this.heapPickerText.width + this.heapPickerStars.width;
      const startX = barCx - totalW / 2;
      this.heapPickerText.setX(startX);
      this.heapPickerStars.setX(startX + this.heapPickerText.width);

      drawTrophyBg(ready);
    };

    refresh();
    this.game.events.once('heapCatalogReady', refresh);

    // Picker tap zone — left 264px of the row → heap selector.
    this.add.zone(barCx, rowY, 264, 48)
      .setDepth(9).setInteractive({ useHandCursor: true })
      .on('pointerup', () => {
        if (this.game.registry.get('heapCatalogReady') !== true) return;
        this.scene.start('HeapSelectScene');
      });

    // Trophy tap zone → leaderboard for the active heap.
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
      playerId: getPlayerGuid(),
      returnScene: 'MenuScene',
    });
    this.scene.pause();
  }
```

(Note: `getPlayerGuid`, `HeapParams`, `DEFAULT_HEAP_PARAMS`, and `formatDifficulty` are already imported at the top of `MenuScene.ts` — no new imports needed.)

- [ ] **Step 3: Fade the trophy in with the picker row**

Find, in `runEntranceSequence()`:

```typescript
    this.tweens.add({ targets: [this.heapPickerBg, this.heapPickerText, this.heapPickerStars], alpha: 1, duration: 300, delay: 1600 });
```

Replace with:

```typescript
    this.tweens.add({ targets: [this.heapPickerBg, this.heapPickerText, this.heapPickerStars, this.leaderboardBg, this.leaderboardIcon], alpha: 1, duration: 300, delay: 1600 });
```

- [ ] **Step 4: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds with no TS errors.

- [ ] **Step 5: Screenshot the menu to verify layout**

Run: `npm run scene-preview -- MenuScene '{}' pixel7`
Expected: `screenshots/preview.png` shows the heap-picker bar shortened with a square 🏆 button to its right. (The preview runs without `heapCatalogReady`, so the picker reads "Heaps loading…" and the trophy border is dimmed — this verifies layout; the enabled state is checked on device in Task 4.)

- [ ] **Step 6: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "feat(menu): add leaderboard trophy button beside heap picker

Split the picker row ~85/15; the trophy launches LeaderboardScene for the
active heap as a paused overlay, returning to the menu on close. Gated on
heapCatalogReady, fades in with the picker."
```

---

## Task 3: Add the `L` keyboard shortcut and legend entry

**Files:**
- Modify: `src/scenes/MenuScene.ts`

- [ ] **Step 1: Bind `L` to open the leaderboard**

Find, in `registerInput()`:

```typescript
      this.input.keyboard!.once('keydown-S', () => this.scene.start('StoreScene'));
      this.input.keyboard!.once('keydown-H', () => this.scene.start('HeapSelectScene'));
```

Replace with:

```typescript
      this.input.keyboard!.once('keydown-S', () => this.scene.start('StoreScene'));
      this.input.keyboard!.once('keydown-H', () => this.scene.start('HeapSelectScene'));
      this.input.keyboard!.once('keydown-L', () => this.openLeaderboard());
```

- [ ] **Step 2: Add `L: Leaderboard` to the desktop hotkey legend**

Find, in `createHotkeyLegend()`:

```typescript
    const keys = [
      { key: 'Space', label: 'Start Run' },
      { key: 'U',     label: 'Upgrades'  },
      { key: 'S',     label: 'Store'     },
      { key: 'H',     label: 'Heap'      },
    ];
```

Replace with:

```typescript
    const keys = [
      { key: 'Space', label: 'Start Run' },
      { key: 'U',     label: 'Upgrades'  },
      { key: 'S',     label: 'Store'     },
      { key: 'H',     label: 'Heap'      },
      { key: 'L',     label: 'Leaderboard' },
    ];
```

- [ ] **Step 3: Build to verify it compiles**

Run: `npm run build`
Expected: build succeeds with no TS errors.

- [ ] **Step 4: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "feat(menu): L hotkey + legend entry for leaderboard"
```

---

## Task 4: Full verification

**Files:** none (verification only)

- [ ] **Step 1: Run the full test suite (nothing should regress)**

Run: `npm test`
Expected: all tests pass (same count as before this branch — these changes add no unit tests and touch no tested logic).

- [ ] **Step 2: Run the production build**

Run: `npm run build`
Expected: build succeeds, no TS errors.

- [ ] **Step 3: Device / browser smoke test (manual checklist)**

Launch the app (`npm run dev`) on a touch device or with touch emulation and confirm:
- Trophy button appears beside the heap picker, enabled once heaps load.
- Tapping it opens the leaderboard for the **active heap** (name in the modal header matches the heap picker).
- Closing the modal (✕ or backdrop tap) returns to the **main menu** (not the heap selector).
- From the heap selector, opening a heap's leaderboard still returns to the **heap selector** (regression check on the `returnScene` default).
- Desktop: pressing `L` opens the leaderboard; legend shows `L: Leaderboard`.

- [ ] **Step 4: Final commit if any fixes were needed during smoke test**

(Only if Step 3 surfaced issues — otherwise nothing to commit.)

---

## Self-Review

**Spec coverage:**
- Layout (85/15 split, 48×48 trophy, ready-gate, entrance fade) → Task 2. ✓
- Behavior (launch active-heap board over paused menu, `L` hotkey) → Task 2 + Task 3. ✓
- Shared fix (`returnScene` param + default) → Task 1. ✓
- Edge cases (catalog-not-ready gate; offline/empty handled by existing scene) → Task 2 (gate); existing behaviour otherwise. ✓
- Testing (build + scene-preview + device) → Task 4. ✓
- HeapSelectScene unchanged via default → covered (not modified); regression checked in Task 4 Step 3. ✓

**Placeholder scan:** none — every code step shows complete code.

**Type/name consistency:** `openLeaderboard()`, `leaderboardBg`, `leaderboardIcon`, `returnScene`, `drawTrophyBg`, registry keys (`heapCatalogReady`, `activeHeapId`, `heapParams`) used identically across tasks; `LeaderboardSceneData.returnScene` consumed by `MenuScene.openLeaderboard`.
