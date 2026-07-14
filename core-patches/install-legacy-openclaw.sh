#!/usr/bin/env bash
# Reproduce the pinned historical OpenClaw deployment with optional Fakoli core patches.
# The supported speech-to-speech plugin does not require this script on stock OpenClaw.
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
PIN=$(cat "$HERE/UPSTREAM_PIN")
TARGET=${OPENCLAW_VANILLA_DIR:-$HOME/.openclaw/workspace/openclaw-legacy}
UPSTREAM=https://github.com/openclaw/openclaw.git
GLOBAL_LINK=/opt/homebrew/lib/node_modules/openclaw

echo "==> Legacy OpenClaw at $PIN + $(find "$HERE" -maxdepth 1 -name '*.patch' | wc -l | tr -d ' ') core patches -> $TARGET"

if [ ! -d "$TARGET/.git" ]; then
  git clone --filter=blob:none "$UPSTREAM" "$TARGET"
fi
cd "$TARGET"

if ! git diff --quiet || ! git diff --cached --quiet; then
  echo "ERROR: $TARGET has local changes; refusing to reset. Clean it up first." >&2
  exit 1
fi

git fetch origin "$PIN"
git checkout --detach "$PIN"

for patch in "$HERE"/*.patch; do
  echo "==> applying $(basename "$patch")"
  git apply --3way "$patch"
done

pnpm install --frozen-lockfile
pnpm build

if [ -L "$GLOBAL_LINK" ]; then
  previous=$(readlink "$GLOBAL_LINK")
  ln -sfn "$TARGET" "$GLOBAL_LINK"
  echo "==> repointed $GLOBAL_LINK"
  echo "    was: $previous"
  echo "    now: $TARGET"
else
  echo "NOTE: $GLOBAL_LINK is not a symlink; repoint your install manually at $TARGET"
fi

echo "==> Done. Restart the OpenClaw Gateway to pick up the legacy build."
