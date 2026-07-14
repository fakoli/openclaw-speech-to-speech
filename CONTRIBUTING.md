# Contributing

Thanks for helping improve OpenClaw Speech to Speech. Changes should preserve
the plugin's two core promises: stock OpenClaw compatibility and operator-owned
voice infrastructure.

## Development setup

Requirements:

- Node.js `22.19.0` or a newer version supported by the pinned OpenClaw SDK
- npm

Install the locked dependency tree and run the complete local gate:

```bash
npm ci
npm test
npm run test:docs
npm run build
npm run test:package
npm audit --omit=dev
```

## Project structure

| Path | Purpose |
| --- | --- |
| `index.ts` | Plugin entrypoint and provider registration |
| `realtime-voice-provider.ts` | Anvil Serving Realtime bridge |
| `openai-cascade-voice-provider.ts` | Direct STT → LLM → TTS cascade |
| `openclaw.plugin.json` | OpenClaw manifest and configuration schema |
| `docs/` | Operator configuration and troubleshooting guides |
| `core-patches/` | Historical overlays; not part of the package |

## Pull requests

- Keep provider credentials out of source, fixtures, logs, and issue reports.
- Use `127.0.0.1`, not a loopback hostname alias, in local URLs.
- Preserve `anvil` as a compatibility alias for Anvil Serving Realtime.
- Add focused tests for behavior changes and update operator documentation when
  configuration or compatibility changes.
- Keep runtime dependencies small and justify any new one in the pull request.
- Run the full local gate before requesting review.

Use Conventional Commit-style summaries when practical, for example
`fix: reject oversized TTS responses` or `docs: clarify provider selection`.

## Security reports

Do not open a public issue for suspected vulnerabilities. Follow
[`SECURITY.md`](SECURITY.md) and use GitHub Security Advisories.
