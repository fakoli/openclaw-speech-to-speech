# Third-party notices and inspiration

OpenClaw Speech to Speech is original software distributed under the MIT
License. It interoperates with, depends on, or draws architectural inspiration
from the following projects:

## OpenClaw

The plugin contract, Gateway relay, audio-format helpers, and runtime types are
provided by [OpenClaw](https://github.com/openclaw/openclaw), used as a peer and
development dependency under the MIT License.

Copyright (c) 2026 OpenClaw Foundation.

## ws

The Anvil Serving Realtime provider uses [ws](https://github.com/websockets/ws) as its
WebSocket client under the MIT License.

Copyright (c) 2011 Einar Otto Stangvik; copyright (c) 2013 Arnout Kazemier and
contributors; copyright (c) 2016 Luigi Pinca and contributors.

## Anvil Serving

The Anvil Serving provider and the standalone cascade were informed by the voice
pipeline and OpenAI-compatible endpoint conventions in
[anvil-serving](https://github.com/fakoli/anvil-serving), distributed under the
MIT License.

Copyright (c) 2026 Sekou Doumbouya.

## Hugging Face Speech-to-Speech

The standalone provider's modular STT → LLM → TTS cascade was inspired in part
by [Hugging Face Speech-to-Speech](https://github.com/huggingface/speech-to-speech).
This package does not copy or depend on its implementation. The Hugging Face
project is distributed under the Apache License 2.0.

Copyright 2024 The HuggingFace Inc. team.

The complete license for this package is in [LICENSE](LICENSE). Dependency
packages retain their own license files and notices.
