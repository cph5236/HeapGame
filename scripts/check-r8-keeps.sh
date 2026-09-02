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

# A class that must always be present with a constructor, used to prove the
# parser below still understands dexdump's output before we trust any result
# from it. Derived from the `namespace` in android/app/build.gradle, so it is
# unaffected by applicationIdSuffix. See canary check further down.
CANARY="Lcom/hanlinsoftware/heapgame/app/MainActivity;"

die() { echo "error: $*" >&2; exit 2; }

# Slice the dump down to one class, stopping at the end of its method tables.
# Every check goes through this, canary included -- a canary that used different
# parsing logic would prove nothing about the real checks.
section_for() {
  awk -v want="'$1'" '
    index($0, "Class descriptor  : ") { inc = (index($0, want) > 0) }
    inc { print }
    inc && /Virtual methods/ { exit }' "$DUMP"
}

has_ctor() { printf '%s' "$1" | grep -q "name          : '<init>'"; }

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

# Disassemble every dex once up front and concatenate into one file.
#
# Each dexdump invocation is checked individually. A partial dump would be worse
# than useless here: a class in a dex that failed to disassemble would simply not
# be found, report as SKIP, and let a genuinely stripped constructor through. So
# any failure is fatal rather than something to work around.
DUMP="$WORK/dump.txt"
: > "$DUMP"
dex_count=0
while IFS= read -r -d '' dex; do
  dex_count=$((dex_count + 1))
  if ! "$DEXDUMP" "$dex" >> "$DUMP" 2>/dev/null; then
    die "dexdump failed on $(basename "$dex") -- refusing to report on a partial disassembly"
  fi
done < <(find "$WORK" -name 'classes*.dex' -print0)

[ "$dex_count" -gt 0 ] || die "no classes*.dex found in $ARTIFACT"
[ -s "$DUMP" ] || die "dexdump produced no output for $ARTIFACT"

# Canary: a missing class is reported below as a soft SKIP, which is right for
# a class that genuinely got shrunk away -- but it also means that if dexdump's
# output format ever drifts (a different build-tools version, different spacing
# around "Class descriptor  : "), every lookup would miss, every check would
# report SKIP, and this script would pass while checking nothing at all.
#
# So before trusting any result, confirm the parser can still find a class that
# must be there and must have a constructor. If this fails, the parser is broken
# rather than the build, and reporting a pass would be actively misleading.
canary_section=$(section_for "$CANARY")
if [ -z "$canary_section" ]; then
  die "parser canary $CANARY not found -- dexdump's output format has probably changed, so these checks can no longer be trusted. Fix section_for() before relying on this script."
fi
if ! has_ctor "$canary_section"; then
  die "parser canary $CANARY found but its constructor was not -- the method-table format has probably changed. Fix has_ctor() before relying on this script."
fi

echo "Checking reflectively-instantiated classes in $ARTIFACT"
failed=0
for entry in "${CHECKS[@]}"; do
  cls="${entry%%|*}"
  why="${entry#*|}"

  section=$(section_for "$cls")

  if [ -z "$section" ]; then
    # Absent is fine only if nothing references it; R8 removing it wholesale
    # means the feature is shaken out, not half-built. Report, do not fail.
    printf '  SKIP  %s\n        not in dex (shrunk away entirely)\n' "$cls"
    continue
  fi

  if has_ctor "$section"; then
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
