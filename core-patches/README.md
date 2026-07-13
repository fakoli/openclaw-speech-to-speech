# Core patches for vanilla OpenClaw

These patches carry the fakoli customizations that cannot live in the
Speech to Speech plugin because they modify OpenClaw core. Applied to a
vanilla `openclaw/openclaw` checkout at the pinned ref, they reproduce what
the `fakoli/openclaw` fork used to provide — without carrying the fork.

## Contents

- `UPSTREAM_PIN` — the upstream commit these patches are known to apply to
  (the fork's last upstream sync point).
- `01-realtime-relay-hooks.patch` — gateway-protocol channel schema additions,
  talk realtime relay tool-call support, voice-call webhook handler hook.
  **The Speech to Speech plugin depends on this patch.**
- `02-talk-consult-fixes.patch` — talk/consult behavior fixes: consult routing
  (chat-fast), forced-consult loop and transcript-pollution guards, consult
  tool narrowing, lightweight voice-consult bootstrap, model-selection lock,
  plus the config schema (zod) entries for all of the above.

## Install

    ./install-vanilla.sh

Clones/updates vanilla OpenClaw at `UPSTREAM_PIN` into
`~/.openclaw/workspace/openclaw-vanilla`, applies the patches, builds with
pnpm, and repoints the `/opt/homebrew/lib/node_modules/openclaw` symlink.
Restart the gateway afterwards.

## Config migration (one-time, moving off the fork build)

The fork bundled the plugin as `extensions/anvil-voice` (id `anvil-voice`).
On vanilla, load this repo as an external plugin instead:

1. Build this repo (`pnpm install && pnpm build`).
2. In `~/.openclaw/openclaw.json`: add this repo's path to the plugin load
   paths, and rename the `anvil-voice` plugin config key to
   `speech-to-speech` (the plugin id changed at extraction).

## Bumping the upstream pin

1. Pick the new upstream ref; update `UPSTREAM_PIN`.
2. In a scratch checkout of vanilla at the new ref:
   `git apply --3way --check core-patches/*.patch`
3. If a patch conflicts, apply what you can, fix by hand, and regenerate that
   patch with `git diff <new-pin> HEAD -- <that patch's pathspecs>`.
4. Rerun `./install-vanilla.sh`.

Regenerating from the fork (while it still exists):

    cd <fork checkout>
    MB=$(git merge-base upstream/main origin/main)
    git diff $MB origin/main -- packages/gateway-protocol \
      src/gateway/talk-realtime-relay.ts src/gateway/talk-realtime-relay.test.ts \
      extensions/voice-call src/talk/provider-types.ts \
      > core-patches/01-realtime-relay-hooks.patch
    git diff $MB origin/main -- src/auto-reply src/config \
      src/gateway/server-methods src/gateway/talk-agent-consult.ts \
      src/talk/agent-consult-tool.ts src/talk/agent-consult-tool.test.ts \
      > core-patches/02-talk-consult-fixes.patch
