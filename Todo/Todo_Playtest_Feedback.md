# Playtester Feedback — Exploration (2026-06-01)

## 1. iOS build

**What:** Ship an iOS build of the game.

**Current state:** Capacitor is configured
([capacitor.config.ts](../capacitor.config.ts)) and the web build is solid, but there
is **no `ios/` directory** — only `android/`. Build scripts only cover Android
(`build:android` → `cap sync`).

**Sketch / dependencies:**
- `cap add ios`, then an Xcode project — **requires macOS + Xcode** (no Mac in the
  current toolchain) and an **Apple Developer account** ($99/yr).
- Plugin parity: `@capacitor-community/admob` supports iOS (the AdProvider pattern
  already abstracts this — see Todo_Inprogress "Ad Integration"). **Google Play
  Games Services has no iOS equivalent** — sign-in / achievements / leaderboards /
  cloud-saves would need Apple Game Center or a custom path, or be disabled on iOS.
- CI: a macOS runner for archiving + TestFlight upload.
- Safe-area / notch handling: [safeArea.ts](../src/utils/safeArea.ts) already exists
  — verify it covers iOS insets.

**Effort:** L (gated on external resources: a Mac, Apple Developer account)

**Open questions:**
- Is a Mac / Apple Developer account available? (Hard blocker.)
- iOS identity story: Game Center, anonymous-only, or skip GPGS-style features?
- Target App Store, or TestFlight beta first (mirrors the Android closed-beta plan)?

---

### Cross-cutting note
Items **3 → 1** share infrastructure: the tap-suppression / dead-zone registry built
for the GRAB-button bug is exactly what the joystick needs to avoid firing jumps.
Build it once in item 3, reuse it in item 1.
