# Rename Dialog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace `window.prompt()` in MenuScene with a styled in-game rename dialog that matches the game's dark/orange aesthetic.

**Architecture:** A raw DOM overlay div is injected into `document.body` when the user taps `[edit]`. It contains a styled panel with a text input, live character counter, CONFIRM button, and cancel text. On close the element is removed from the DOM. No Phaser DOM config changes needed. `setPlayerName` already handles trim, empty guard, and 20-char truncation — the dialog calls it directly.

**Tech Stack:** TypeScript, Phaser 3, vanilla DOM, Vitest (no new tests needed — SaveData already covers name validation).

---

### Task 1: Replace `promptNameChange` with `openNameDialog`

**Files:**
- Modify: `src/scenes/MenuScene.ts` (the `promptNameChange` method and its call site in `createPlayerName`)

- [ ] **Step 1: Open `src/scenes/MenuScene.ts` and locate `promptNameChange` (line ~333) and its call site in `createPlayerName` (line ~313)**

The call site in `createPlayerName` looks like:
```typescript
const onTap = isGpgs
  ? () => PlayGamesClient.showPlayerProfile()
  : () => this.promptNameChange();
```

- [ ] **Step 2: Replace the entire `promptNameChange` method with `openNameDialog`**

Delete:
```typescript
private promptNameChange(): void {
  const current = getPlayerName();
  const input   = window.prompt('Enter your player name (max 20 chars):', current);
  if (input === null) return;  // cancelled
  setPlayerName(input);
  this.playerNameText.setText(`${getPlayerName()}  [edit]`);
}
```

Add in its place:
```typescript
private openNameDialog(): void {
  const current = getPlayerName();

  const overlay = document.createElement('div');
  overlay.style.cssText = [
    'position:fixed', 'inset:0', 'background:rgba(0,0,0,0.75)',
    'display:flex', 'align-items:center', 'justify-content:center',
    'z-index:9999', 'font-family:monospace',
  ].join(';');

  const panel = document.createElement('div');
  panel.style.cssText = [
    'background:#0d0d20', 'border:2px solid #ff9922', 'border-radius:12px',
    'padding:28px 22px 22px', 'text-align:center', 'width:300px',
    'box-shadow:0 0 32px rgba(255,153,34,0.18)', 'box-sizing:border-box',
  ].join(';');

  const heap = document.createElement('div');
  heap.style.cssText = 'color:#ff9922;font-size:13px;font-weight:bold;letter-spacing:3px;margin-bottom:6px';
  heap.textContent = 'HEAP';

  const subtitle = document.createElement('div');
  subtitle.style.cssText = 'color:#cc9966;font-size:14px;font-style:italic;margin-bottom:22px';
  subtitle.textContent = 'What do they call you?';

  const input = document.createElement('input');
  input.maxLength = 20;
  input.value = current;
  input.style.cssText = [
    'width:100%', 'box-sizing:border-box', 'background:transparent', 'border:none',
    'border-bottom:2px solid #ff9922', 'color:#ffffff', 'font-size:20px',
    'text-align:center', 'padding:6px 0 8px', 'font-family:monospace',
    'outline:none', 'margin-bottom:6px',
  ].join(';');

  const counterRow = document.createElement('div');
  counterRow.style.cssText = 'display:flex;justify-content:flex-end;margin-bottom:24px';
  const counter = document.createElement('span');
  counter.style.cssText = 'color:#556677;font-size:10px';
  counter.textContent = `${current.length} / 20`;
  counterRow.appendChild(counter);

  const confirmBtn = document.createElement('button');
  confirmBtn.textContent = 'CONFIRM';
  confirmBtn.style.cssText = [
    'width:100%', 'padding:13px', 'background:#ff9922', 'border:none',
    'border-radius:8px', 'color:#0a0818', 'font-size:15px', 'font-weight:bold',
    'font-family:monospace', 'letter-spacing:1px', 'cursor:pointer', 'margin-bottom:10px',
  ].join(';');

  const cancelEl = document.createElement('div');
  cancelEl.textContent = 'cancel';
  cancelEl.style.cssText = 'color:#556677;font-size:12px;cursor:pointer;letter-spacing:1px';

  panel.append(heap, subtitle, input, counterRow, confirmBtn, cancelEl);
  overlay.appendChild(panel);
  document.body.appendChild(overlay);

  const close = (): void => { document.body.removeChild(overlay); };

  const confirm = (): void => {
    setPlayerName(input.value);
    this.playerNameText.setText(`${getPlayerName()}  [edit]`);
    close();
  };

  input.addEventListener('input', () => {
    const len = input.value.length;
    counter.textContent = `${len} / 20`;
    counter.style.color = len >= 19 ? '#ff4444' : '#556677';
  });

  input.addEventListener('keydown', (e: KeyboardEvent) => {
    if (e.key === 'Enter')  confirm();
    if (e.key === 'Escape') close();
  });

  confirmBtn.addEventListener('click', confirm);
  cancelEl.addEventListener('click', close);
  overlay.addEventListener('click', (e: MouseEvent) => {
    if (e.target === overlay) close();
  });

  requestAnimationFrame(() => input.focus());
}
```

- [ ] **Step 3: Update the call site in `createPlayerName` to call `openNameDialog`**

Change:
```typescript
: () => this.promptNameChange();
```
To:
```typescript
: () => this.openNameDialog();
```

- [ ] **Step 4: Run the build to confirm no TypeScript errors**

```bash
npm run build 2>&1 | tail -20
```

Expected: build completes with no errors. If TypeScript complains about `e: KeyboardEvent` or `e: MouseEvent`, the types are already available via Phaser's bundled lib — no imports needed.

- [ ] **Step 5: Commit**

```bash
git add src/scenes/MenuScene.ts
git commit -m "feat: replace window.prompt with styled rename dialog"
```

---

### Task 2: Visual verification via scene-preview

**Files:**
- Read: `screenshots/preview.png` (written by scene-preview)

- [ ] **Step 1: Ensure the dev server is running**

```bash
npm run dev
```

Keep this running in a separate terminal. If it's already running, skip.

- [ ] **Step 2: Take a baseline screenshot of MenuScene**

```bash
npm run scene-preview -- MenuScene '{"forceSettingsOpen":false}' pixel7
```

Expected: `screenshots/preview.png` written. Confirm the player name label shows `[edit]` and the menu looks correct.

- [ ] **Step 3: Open the game in a browser and manually trigger the dialog**

Navigate to `http://localhost:3000` (or the dev server port). On the main menu, click the player name `[edit]` link.

Verify:
- The dark overlay appears covering the full screen
- The panel shows `HEAP`, `What do they call you?`, the pre-filled input, `N / 20` counter, `CONFIRM` button, and `cancel`
- Typing updates the counter; at 19+ chars the counter turns red
- Pressing Enter or clicking `CONFIRM` updates the name label and closes
- Clicking `cancel` or the dimmed area closes without changing the name
- Leaving the input empty and pressing `CONFIRM` closes without changing the name (old name preserved)

- [ ] **Step 4: Commit if any follow-up tweaks were made; otherwise done**

```bash
git add src/scenes/MenuScene.ts
git commit -m "fix: rename dialog visual polish"
```

Only commit if there were changes from the smoke test. Skip this step if Task 1's commit is the final state.
