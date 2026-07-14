# OpenClaw Speech to Speech

[![CI](https://github.com/fakoli/openclaw-speech-to-speech/actions/workflows/ci.yml/badge.svg)](https://github.com/fakoli/openclaw-speech-to-speech/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node.js 22.19+](https://img.shields.io/badge/node-%3E%3D22.19-339933.svg)](https://nodejs.org/)

**Bring your own voice stack to [OpenClaw](https://openclaw.ai).** Connect Talk
to Anvil Realtime, or run speech-to-speech directly against your own
OpenAI-compatible STT, LLM, and TTS endpoints.

| Provider | Best for | Runtime path |
| --- | --- | --- |
| `anvil` | Realtime streaming, Anvil routing, and OpenClaw tool continuation | Gateway -> Anvil `/v1/realtime` -> STT/LLM/TTS |
| `openai-cascade` | A standalone, provider-neutral local voice stack | Gateway -> STT -> Chat Completions -> TTS |

The plugin offers two Gateway-relay providers, so an Anvil deployment is optional:

- `anvil` bridges OpenClaw Talk to an Anvil `/v1/realtime` WebSocket endpoint.
- `openai-cascade` runs local silence-based turn detection -> STT -> LLM -> TTS using the
  operator's own OpenAI-compatible HTTP endpoints.

In both cases audio stays server-side and browsers only ever speak authenticated
Gateway RPCs. The Anvil provider also forwards tool calls through OpenClaw's
`openclaw_agent_consult` policy.

Runs against stock OpenClaw `>=2026.6.11` — no fork required.

## Requirements

- OpenClaw `2026.6.11` or newer.
- Node.js `22.19.0` or newer.
- Either an Anvil Realtime WebSocket endpoint or OpenAI-compatible STT, Chat
  Completions, and raw-PCM TTS endpoints.

## Install

```bash
openclaw plugins install @fakoli/openclaw-speech-to-speech
```

Or from a local checkout while developing:

```bash
npm install && npm pack --pack-destination /tmp
openclaw plugins install npm-pack:/tmp/fakoli-openclaw-speech-to-speech-0.1.0.tgz --force
openclaw plugins inspect speech-to-speech --runtime --json
```

## Configure Anvil Realtime

```jsonc
{
  "talk": {
    "realtime": {
      "provider": "anvil",
      "transport": "gateway-relay",
      "brain": "agent-consult",
      // Anvil skips openclaw_agent_consult for direct replies; force finalized
      // transcripts through OpenClaw instead. (Stock OpenClaw has no
      // per-provider default, so set this explicitly.)
      "consultRouting": "force-agent-consult",
      "providers": {
        "anvil": {
          "realtimeUrl": "ws://127.0.0.1:8765/v1/realtime"
        }
      }
    }
  }
}
```

Remote endpoints should use `wss://` plus an `apiKey` secret reference (or
`baseUrl`, to which `/v1/realtime` is appended). Loopback endpoints need no
key.

## Configure a standalone OpenAI-compatible cascade

Choose `openai-cascade` when you operate your own STT, LLM, and TTS services
and do not want to run Anvil. The three services may be separate hosts or the
same OpenAI-compatible server. This provider sends 16 kHz mono PCM WAV to
`/audio/transcriptions`, sends the final transcript to `/chat/completions`,
then requests raw PCM from `/audio/speech` and converts it from
`ttsSampleRateHz` to the Gateway relay's audio format.

```jsonc
{
  "talk": {
    "realtime": {
      "provider": "openai-cascade",
      "transport": "gateway-relay",
      "providers": {
        "openai-cascade": {
          "sttBaseUrl": "http://127.0.0.1:30010/v1",
          "sttModel": "your-stt-model",
          "llmBaseUrl": "http://127.0.0.1:8000/v1",
          "llmModel": "your-chat-model",
          "ttsBaseUrl": "http://127.0.0.1:30011/v1",
          "ttsModel": "your-tts-model",
          "ttsSampleRateHz": 24000,
          "voice": "your-voice-id"
        }
      }
    }
  }
}
```

Use the endpoint-specific `sttApiKey`, `llmApiKey`, and `ttsApiKey` fields
when required; each accepts an OpenClaw secret reference. A shared `apiKey`
or `token` remains available when all three endpoints use the same credential.
For security, cleartext `http://` endpoints must be loopback, private, `.local`,
or `.ts.net`; use `https://` for public hosts. The standalone cascade has no
model-side tool-call loop, so select the Anvil provider when you need
`openclaw_agent_consult` tool continuation.

The standalone path fails closed on oversized audio or response bodies,
unexpected redirects, invalid JSON, non-PCM TTS responses, and upstream
deadlines. Starting a new turn cancels the superseded request.

### Provider options

| Key | Default | Notes |
| --- | --- | --- |
| `realtimeUrl` | — | Anvil realtime WebSocket URL. |
| `baseUrl` | — | HTTP/WS base; `/v1/realtime` appended when needed. |
| `apiKey` / `token` | — | Bearer token or SecretRef for non-loopback endpoints. |
| `model` | `fast-local` | Anvil model id. |
| `voice` / `speakerVoice` | — | Speaker voice id. |
| `vadThreshold` | — | Voice-activity detection threshold. |
| `silenceDurationMs` | `200` | Silence window before finalizing a turn. |
| `prefixPaddingMs` | — | Audio prefix padding. |

### `openai-cascade` options

| Key | Required | Notes |
| --- | --- | --- |
| `sttBaseUrl`, `sttModel` | Yes | OpenAI-compatible STT base URL and model. |
| `llmBaseUrl`, `llmModel` | Yes | OpenAI-compatible Chat Completions base URL and model. |
| `ttsBaseUrl`, `ttsModel` | Yes | OpenAI-compatible TTS base URL and model. |
| `ttsSampleRateHz` | `24000` | PCM sample rate emitted by the TTS endpoint. |
| `sttApiKey`, `llmApiKey`, `ttsApiKey` | No | Per-endpoint bearer token or secret reference. |
| `apiKey` / `token` | No | Shared bearer-token fallback for all three endpoints. |
| `voice` / `speakerVoice` | No | TTS voice id; defaults to `alloy`. |
| `silenceDurationMs` | `200` | Local silence window before committing an audio turn. |
| `requestTimeoutMs` | `60000` | Per-stage STT, LLM, and TTS request deadline. |

## Develop

```bash
npm install
npm test        # vitest, includes a live in-process WebSocket integration test
npm run build   # emits dist/ consumed by openclaw.extensions
```

## Compatibility and legacy overlays

Stock OpenClaw `>=2026.6.11` includes the public realtime voice provider,
Gateway relay, tool callback, and provider-resolution contracts used by this
plugin. No OpenClaw source patch is required for either provider on those
versions.

The checked-in [`core-patches`](core-patches/README.md) directory is retained
for reproducing an older pinned fakoli deployment and its additional consult
behavior. It is not installed with the npm package.

## Inspiration and license

The project grew out of the Anvil Voice cascade in
[anvil-serving](https://github.com/fakoli/anvil-serving) and OpenClaw's
Gateway-relay provider model. The standalone provider keeps the useful shape
of that pipeline while removing the Anvil runtime requirement.

Released under the [MIT License](LICENSE). See
[third-party notices](THIRD_PARTY_NOTICES.md) for OpenClaw, `ws`, and
anvil-serving attribution, and [SECURITY.md](SECURITY.md) for private security
reporting.

## Notes for fork users

This plugin previously lived in the `fakoli/openclaw` fork as a bundled
extension together with extra core config (`talk.consultModel`,
`talk.consultToolsAllow`, `talk.consultBootstrapContextMode`) and a
`defaultConsultRouting` provider capability. Those core knobs are not part of
stock OpenClaw; on the fork they keep working, and upstream proposals track
them separately. The plugin itself does not depend on any of them —
`consultRouting` in operator config (above) covers the routing default.
