#!/usr/bin/env bash
# Decide whether the iOS build should run: only when package.json "version"
# differs from the previous commit. Emits `should_build=true|false` to
# $GITHUB_OUTPUT (or stdout when unset). Diagnostics go to stderr.
set -euo pipefail

# Emit the result to $GITHUB_OUTPUT when set (CI), otherwise to stdout (local/test).
# Appending to /dev/stdout breaks when stdout is a pipe, so echo to fd 1 directly.
emit() {
  if [ -n "${GITHUB_OUTPUT:-}" ]; then
    echo "$1" >> "$GITHUB_OUTPUT"
  else
    echo "$1"
  fi
}

current="$(node -p "require('./package.json').version")"

if prev_json="$(git show HEAD~1:package.json 2>/dev/null)"; then
  previous="$(printf '%s' "$prev_json" \
    | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log(JSON.parse(s).version))")"
else
  previous=""
fi

if [ "$current" = "$previous" ]; then
  echo "iOS build: version unchanged ($current) — skipping." >&2
  emit "should_build=false"
else
  echo "iOS build: version ${previous:-<none>} -> $current — building." >&2
  emit "should_build=true"
fi
