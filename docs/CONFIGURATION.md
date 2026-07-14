# Configuration reference

OpenClaw Speech to Speech registers two Gateway-relay realtime voice providers.
Configure them under `talk.realtime.providers` and select one with
`talk.realtime.provider`.

## Provider IDs

| Display name | Canonical ID | Compatibility aliases |
| --- | --- | --- |
| Anvil Serving Realtime | `anvil-serving` | `anvil` |
| OpenAI-Compatible Cascade | `openai-cascade` | — |

The `anvil` alias exists only to preserve existing configurations. New
configurations should use `anvil-serving`.

## Anvil Serving Realtime

```jsonc
{
  "talk": {
    "realtime": {
      "provider": "anvil-serving",
      "transport": "gateway-relay",
      "brain": "agent-consult",
      "consultRouting": "force-agent-consult",
      "providers": {
        "anvil-serving": {
          "realtimeUrl": "ws://127.0.0.1:8765/v1/realtime",
          "model": "fast-local"
        }
      }
    }
  }
}
```

`consultRouting: "force-agent-consult"` routes finalized transcripts through
OpenClaw when the Realtime model answers directly instead of calling
`openclaw_agent_consult`.

| Setting | Default | Description |
| --- | --- | --- |
| `realtimeUrl` | — | Complete Anvil Serving Realtime WebSocket URL. |
| `baseUrl` | — | HTTP or WebSocket base URL; `/v1/realtime` is appended. |
| `apiKey` / `token` | — | Bearer token or OpenClaw secret reference. |
| `model` | `fast-local` | Anvil Serving model ID. |
| `voice` / `speakerVoice` | — | Voice ID forwarded to the Realtime session. |
| `vadThreshold` | — | Server voice-activity threshold from `0` to `1`. |
| `silenceDurationMs` | `200` | Sustained silence before committing an audio turn. |
| `prefixPaddingMs` | — | Audio retained before detected speech. |

Loopback endpoints may use `ws://`. Remote deployments should use `wss://`
and a secret reference.

## OpenAI-Compatible Cascade

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

| Setting | Default | Description |
| --- | --- | --- |
| `sttBaseUrl`, `sttModel` | required | OpenAI-compatible STT base URL and model. |
| `llmBaseUrl`, `llmModel` | required | Chat Completions base URL and model. |
| `ttsBaseUrl`, `ttsModel` | required | TTS base URL and model. |
| `sttApiKey`, `llmApiKey`, `ttsApiKey` | — | Endpoint-specific bearer tokens or secret references. |
| `apiKey` / `token` | — | Shared credential fallback for all three endpoints. |
| `ttsSampleRateHz` | `24000` | Sample rate of the raw PCM16 TTS response; `8000`–`384000`. |
| `voice` / `speakerVoice` | `alloy` | Voice ID sent to TTS. |
| `silenceDurationMs` | `200` | Local silence window before committing a turn. |
| `requestTimeoutMs` | `60000` | Per-stage deadline; maximum `2147483647`. |

### Endpoint contracts

| Stage | Request | Required response |
| --- | --- | --- |
| STT | `POST /audio/transcriptions`, 16 kHz mono PCM WAV multipart | JSON containing a nonempty `text` string |
| LLM | `POST /chat/completions`, non-streaming messages | OpenAI-compatible assistant message content |
| TTS | `POST /audio/speech` with `response_format: "pcm"` | Nonempty, even-length raw little-endian PCM16 with `audio/pcm`, `audio/l16`, `audio/raw`, or `application/octet-stream` content type |

The cascade does not currently implement a model-side tool-call loop. Use Anvil
Serving Realtime when the voice model must call `openclaw_agent_consult`.

For concrete Parakeet, Qwen3-ASR, Kokoro, and MLX Audio combinations, see the
[benchmark-backed voice stack examples](VOICE_STACKS.md).

## Secrets

Prefer OpenClaw secret references over literal tokens. A shared `apiKey` or
`token` applies to every endpoint unless an endpoint-specific key overrides it.
Never put credentials in examples, issue reports, fixtures, or logs.

## Network policy

- Public hosts must use `https://` or `wss://`.
- Cleartext endpoints are accepted only for loopback, private, `.local`, or
  `.ts.net` hosts.
- Use `127.0.0.1`, not a loopback hostname alias, for local examples.
- Redirects are rejected so credentials cannot silently cross origins.
