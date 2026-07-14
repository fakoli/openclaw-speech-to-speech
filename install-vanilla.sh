#!/usr/bin/env bash
# Build the pinned legacy OpenClaw + optional fakoli core patches and point the global openclaw
# symlink at the result. The speech-to-speech plugin itself stays external and
# is loaded via the plugins load path in ~/.openclaw config (see
# core-patches/README.md for the config migration).
#
# Rollback: ln -sfn <old-checkout> /opt/homebrew/lib/node_modules/openclaw
set -euo pipefail

HERE=$(cd "$(dirname "$0")" && pwd)
PIN=$(cat "$HERE/core-patches/UPSTREAM_PIN")
TARGET=${OPENCLAW_VANILLA_DIR:-$HOME/.openclaw/workspace/openclaw-vanilla}
UPSTREAM=https://github.com/openclaw/openclaw.git
GLOBAL_LINK=/opt/homebrew/lib/node_modules/openclaw

echo "==> Vanilla OpenClaw at $PIN + $(ls "$HERE"/core-patches/*.patch | wc -l | tr -d ' ') core patches -> $TARGET"

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

for p in "$HERE"/core-patches/*.patch; do
  echo "==> applying $(basename "$p")"
  git apply --3way "$p"
done

pnpm install --frozen-lockfile
pnpm build

if [ -L "$GLOBAL_LINK" ]; then
  PREV=$(readlink "$GLOBAL_LINK")
  ln -sfn "$TARGET" "$GLOBAL_LINK"
  echo "==> repointed $GLOBAL_LINK"
  echo "    was: $PREV"
  echo "    now: $TARGET"
else
  echo "NOTE: $GLOBAL_LINK is not a symlink; repoint your install manually at $TARGET"
fi

echo "==> Done. Restart the OpenClaw gateway to pick up the new build."
