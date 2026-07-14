# Changelog

All notable changes to this project are documented here.

## 0.1.0 - 2026-07-14

First public release.

- Add the `anvil` provider for OpenAI Realtime-compatible Anvil Voice sessions.
- Add the standalone `openai-cascade` provider for user-owned OpenAI-compatible
  STT, Chat Completions, and raw-PCM TTS endpoints.
- Support Gateway relay audio conversion, silence-based turn commits, barge-in,
  endpoint-specific secret references, and configurable TTS sample rates.
- Forward Anvil Realtime tool calls and tool-result continuation to OpenClaw.
- Bound audio and response memory, reject unexpected redirects and media types,
  cancel superseded turns, and apply per-stage upstream deadlines.
- Support stock OpenClaw 2026.6.11 and newer through the public plugin SDK.
