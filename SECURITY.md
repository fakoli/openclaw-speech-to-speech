# Security policy

## Supported versions

Security fixes are applied to the latest published release.

## Reporting a vulnerability

Please report vulnerabilities privately through
[GitHub Security Advisories](https://github.com/fakoli/openclaw-speech-to-speech/security/advisories/new).
Do not open a public issue for a suspected vulnerability.

Include the affected provider, OpenClaw version, configuration shape with all
secrets removed, reproduction steps, and expected impact. Never include API
keys, bearer tokens, transcripts, or private audio.

## Deployment guidance

- Store endpoint credentials as OpenClaw secret references.
- Keep cleartext HTTP and WebSocket endpoints on loopback or private networks.
- Use TLS for public endpoints.
- Treat STT, LLM, and TTS services as trusted infrastructure: they receive
  user audio, transcripts, or assistant text by design.
- Keep OpenClaw and this plugin updated together.
