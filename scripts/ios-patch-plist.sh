#!/usr/bin/env bash
# Patch the regenerated Capacitor iOS Info.plist. Runs on the macOS CI runner
# after `cap add ios` + `cap sync ios`. macOS-only (PlistBuddy).
set -euo pipefail

PLIST="ios/App/App/Info.plist"
PB="/usr/libexec/PlistBuddy"

VERSION="$(node -p "require('./package.json').version")"
# Monotonic AND rerun-safe: run_number repeats on a rerun; run_attempt increments.
BUILD="$(( ${GITHUB_RUN_NUMBER:-0} * 100 + ${GITHUB_RUN_ATTEMPT:-1} ))"

set_or_add() { # key, type, value
  "$PB" -c "Set :$1 $3" "$PLIST" 2>/dev/null || "$PB" -c "Add :$1 $2 $3" "$PLIST"
}

# Marketing + build numbers (Capacitor defaults these to $(MARKETING_VERSION)/
# $(CURRENT_PROJECT_VERSION) build-setting refs; literal overrides are fine).
"$PB" -c "Set :CFBundleShortVersionString $VERSION" "$PLIST"
"$PB" -c "Set :CFBundleVersion $BUILD" "$PLIST"

# Home-screen name.
set_or_add "CFBundleDisplayName" "string" "Heap"

# Portrait-only (mirror Android screenOrientation="portrait").
"$PB" -c "Delete :UISupportedInterfaceOrientations" "$PLIST" 2>/dev/null || true
"$PB" -c "Add :UISupportedInterfaceOrientations array" "$PLIST"
"$PB" -c "Add :UISupportedInterfaceOrientations:0 string UIInterfaceOrientationPortrait" "$PLIST"

# Export compliance: no non-exempt encryption — auto-clears the TestFlight prompt.
set_or_add "ITSAppUsesNonExemptEncryption" "bool" "false"

# AdMob test APP id (iOS). The @capacitor-community/admob pod is installed by
# `cap add ios` regardless of VITE_AD_PROVIDER, and the Google Mobile Ads SDK
# HARD-CRASHES at launch without this key — even though Heap is ad-free here.
set_or_add "GADApplicationIdentifier" "string" "ca-app-pub-3940256099942544~1458002511"

echo "Patched $PLIST: v$VERSION ($BUILD), portrait, encryption=false, ad-free GADApplicationIdentifier"
