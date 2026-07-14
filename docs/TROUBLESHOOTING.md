# Troubleshooting

Start with the live runtime. A cold manifest check does not prove that the
Gateway imported the installed plugin.

```bash
openclaw gateway status --deep --require-rpc
openclaw plugins inspect speech-to-speech --runtime --json
```

## Plugin is installed but not loaded

Restart the Gateway and inspect again:

```bash
openclaw gateway restart
openclaw plugins inspect speech-to-speech --runtime --json
```

The inspection should report `status: "loaded"`, an empty `diagnostics` array,
and both realtime voice provider IDs.

## Anvil Serving configuration no longer resolves

Use `anvil-serving` for new configurations. The legacy `anvil` provider ID and
provider-config key remain supported as aliases, so existing configurations do
not need an immediate migration.

Confirm that either `realtimeUrl` or `baseUrl` is present. Use `ws://127.0.0.1`
only for a local endpoint; use `wss://` for public or remote hosts.

## The cascade transcribes but produces no audio

Confirm that `/audio/speech` returns raw little-endian PCM16—not WAV, MP3, JSON,
or another encoded container. Set `ttsSampleRateHz` to the actual sample rate
returned by the TTS service. The response must explicitly identify raw audio
with `audio/pcm`, `audio/l16`, `audio/raw`, or `application/octet-stream`.

The plugin rejects empty, odd-length, encoded, oversized, missing-content-type,
or explicitly non-audio responses.

## An endpoint URL is rejected

Public cleartext endpoints are intentionally blocked. Use TLS or move the
service behind loopback, a private address, `.local`, or `.ts.net`.

Endpoint URLs cannot contain credentials, query strings, or fragments. Pass
credentials through the provider's API-key settings instead.

## Follow-up questions lose context

The OpenAI-Compatible Cascade retains the latest 12 completed turns, bounded to
64 KiB of text. Context resets when the Talk bridge closes. If an older release
does not retain context, update to a release containing the bounded conversation
history change documented in the changelog.

## Tool calls do not continue through OpenClaw

The direct cascade intentionally has no model-side tool loop. Choose Anvil
Serving Realtime with `brain: "agent-consult"` and
`consultRouting: "force-agent-consult"` when delegated OpenClaw work is
required.

## Older patched deployments

Stock OpenClaw `2026.6.11+` supports the public contracts used by this plugin.
The files in [`../core-patches/`](../core-patches/README.md) are retained only
to reproduce an older Fakoli deployment and are not part of the packaged
plugin.

## Reporting a bug

Use the repository bug-report form and include:

- plugin, OpenClaw, and Node.js versions
- selected provider ID
- operating system and deployment topology
- a redacted configuration shape
- runtime inspection diagnostics and reproduction steps

Never include API keys, bearer tokens, private transcripts, or audio. Report
security issues privately according to the [security policy](../SECURITY.md).
