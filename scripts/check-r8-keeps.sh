#!/usr/bin/env bash
#
# Guard against R8 stripping constructors off classes that are only ever
# instantiated reflectively.
#
# Several AndroidX libraries ship consumer ProGuard rules written for ProGuard's
# semantics, where a memberless `-keep class X` also retained the default
# constructor. R8 full mode keeps only the class *name*, so the class still
# resolves through Class.forName() but newInstance() throws
# InstantiationException. Nothing about the build fails: the APK is well-formed
# and `assembleRelease` is green. It only surfaces when the code runs.
#
# That is how V0.2.29 shipped a launch crash -- room-runtime 2.2.5's memberless
# rule let R8 strip androidx.work.impl.WorkDatabase_Impl's constructor, and
# WorkManagerInitializer runs from androidx.startup's ContentProvider, before
# Application.onCreate. The fix lives in android/app/proguard-rules.pro; this
# script is what stops it regressing.
#
# Usage:
#   scripts/check-r8-keeps.sh [path/to/app-release.apk|.aab]
#
# With no argument it looks for the usual release outputs. Needs `dexdump` from
# the Android SDK build-tools (ANDROID_HOME / ANDROID_SDK_ROOT, or on PATH).

set -uo pipefail

# Classes that MUST retain a constructor, and the reflection site that needs it.
# Keep the reason text -- a future failure here is only actionable with it.
CHECKS=(
  "Landroidx/work/impl/WorkDatabase_Impl;|Room resolves <Database>_Impl by name and calls newInstance() (Room.getGeneratedImplementation)"
  "Landroidx/work/OverwritingInputMerger;|WorkManager instantiates the merger in InputMerger.fromClassName()"
  "Landroidx/work/ArrayCreatingInputMerger;|WorkManager instantiates the merger in InputMerger.fromClassName()"
  "Lcom/google/android/gms/ads/internal/offline/buffering/OfflinePingSender;|WorkManager instantiates Workers via their (Context, WorkerParameters) constructor"
  "Lcom/google/android/gms/ads/internal/offline/buffering/OfflineNotificationPoster;|WorkManager instantiates Workers via their (Context, WorkerParameters) constructor"
)

die() { echo "error: $*" >&2; exit 2; }

find_dexdump() {
  local sdk
  for sdk in "${ANDROID_HOME:-}" "${ANDROID_SDK_ROOT:-}" "$HOME/Android/Sdk" "$HOME/Library/Android/sdk"; do
    [ -n "$sdk" ] && [ -d "$sdk/build-tools" ] || continue
    local d
    d=$(find "$sdk/build-tools" -maxdepth 2 -name dexdump -type f 2>/dev/null | sort -V | tail -1)
    [ -n "$d" ] && { echo "$d"; return 0; }
  done
  command -v dexdump 2>/dev/null && return 0
  return 1
}

ARTIFACT="${1:-}"
if [ -z "$ARTIFACT" ]; then
  for c in \
    android/app/build/outputs/apk/release/app-release-unsigned.apk \
    android/app/build/outputs/apk/release/app-release.apk \
    android/app/build/outputs/bundle/release/app-release.aab
  do
    [ -f "$c" ] && { ARTIFACT="$c"; break; }
  done
fi
[ -n "$ARTIFACT" ] || die "no release artifact found; pass one explicitly or run :app:assembleRelease first"
[ -f "$ARTIFACT" ] || die "no such file: $ARTIFACT"

DEXDUMP=$(find_dexdump) || die "dexdump not found; set ANDROID_HOME or install build-tools"

# APKs keep dex at the root; AABs keep it under base/dex/.
case "$ARTIFACT" in
  *.aab) DEX_GLOB='base/dex/classes*.dex' ;;
  *)     DEX_GLOB='classes*.dex' ;;
esac

WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
unzip -oq "$ARTIFACT" "$DEX_GLOB" -d "$WORK" || die "could not extract $DEX_GLOB from $ARTIFACT"

# One dexdump pass over every dex; the disassembly is large, so do it once.
DUMP="$WORK/dump.txt"
find "$WORK" -name 'classes*.dex' -print0 \
  | xargs -0 -I{} "$DEXDUMP" {} 2>/dev/null > "$DUMP"
[ -s "$DUMP" ] || die "dexdump produced no output for $ARTIFACT"

echo "Checking reflectively-instantiated classes in $ARTIFACT"
failed=0
for entry in "${CHECKS[@]}"; do
  cls="${entry%%|*}"
  why="${entry#*|}"

  # Slice the dump to this class, stopping at the end of its method tables.
  section=$(awk -v want="'$cls'" '
    index($0, "Class descriptor  : ") { inc = (index($0, want) > 0) }
    inc { print }
    inc && /Virtual methods/ { exit }' "$DUMP")

  if [ -z "$section" ]; then
    # Absent is fine only if nothing references it; R8 removing it wholesale
    # means the feature is shaken out, not half-built. Report, do not fail.
    printf '  SKIP  %s\n        not in dex (shrunk away entirely)\n' "$cls"
    continue
  fi

  if printf '%s' "$section" | grep -q "name          : '<init>'"; then
    n=$(printf '%s' "$section" | grep -c "name          : '<init>'")
    printf '  ok    %s (%s constructor(s))\n' "$cls" "$n"
  else
    printf '  FAIL  %s\n        kept by name but has no <init> -- newInstance() will throw InstantiationException\n        needs: %s\n' "$cls" "$why"
    failed=1
  fi
done

if [ "$failed" -ne 0 ]; then
  cat >&2 <<'MSG'

R8 stripped a constructor off a class that is instantiated reflectively.
This build will crash at runtime even though the build succeeded.

Fix: add the missing member spec to android/app/proguard-rules.pro, e.g.
    -keep class * extends androidx.room.RoomDatabase { <init>(); }
MSG
  exit 1
fi

echo "All reflectively-instantiated classes retained their constructors."
