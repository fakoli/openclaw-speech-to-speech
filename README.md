# OpenClaw Anvil Voice

Anvil Voice realtime speech-to-speech provider plugin for [OpenClaw](https://openclaw.ai).
Bridges OpenClaw Talk's Gateway relay to an Anvil `/v1/realtime` WebSocket
endpoint: audio stays server-side, tool calls route through OpenClaw's
`openclaw_agent_consult` policy, and browsers only ever speak authenticated
Gateway RPCs.

Runs against stock OpenClaw `>=2026.6.11` — no fork required.

## Install

```bash
openclaw plugins install @fakoli/openclaw-anvil-voice
```

Or from a local checkout while developing:

```bash
npm install && npm pack --pack-destination /tmp
openclaw plugins install npm-pack:/tmp/fakoli-openclaw-anvil-voice-0.1.0.tgz --force
openclaw plugins inspect anvil-voice --runtime --json
```

## Configure

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

## Develop

```bash
npm install
npm test        # vitest, includes a live in-process WebSocket integration test
npm run build   # emits dist/ consumed by openclaw.extensions
```

## Notes for fork users

This plugin previously lived in the `fakoli/openclaw` fork as a bundled
extension together with extra core config (`talk.consultModel`,
`talk.consultToolsAllow`, `talk.consultBootstrapContextMode`) and a
`defaultConsultRouting` provider capability. Those core knobs are not part of
stock OpenClaw; on the fork they keep working, and upstream proposals track
them separately. The plugin itself does not depend on any of them —
`consultRouting` in operator config (above) covers the routing default.
