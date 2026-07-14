# Voice stack examples

The OpenAI-Compatible Cascade does not bundle speech models. You can pair any
STT and TTS services that satisfy the endpoint contracts, including services
running on different machines.

This page separates combinations we have measured from projects that are only
promising candidates. Benchmark numbers are local observations, not universal
model rankings. The NVIDIA STT and TTS captures were recorded on an RTX 5090
on July 8 and July 6, 2026, respectively. The optional Apple Silicon baseline
was recorded on a 16 GB Mac mini on July 8, 2026.

## Recommended starting points

| Component | Start with | Endpoint fit | Local evidence |
| --- | --- | --- | --- |
| STT on Apple Silicon | [MLX Audio](https://github.com/Blaizzy/mlx-audio) with `mlx-community/parakeet-tdt-0.6b-v3` | Direct: `/v1/audio/transcriptions` | A three-run same-host rerun measured median STT stage latency at 106.28 ms. Its generated input produced an empty hypothesis, so this is latency evidence only. |
| STT on NVIDIA or CPU | [NVIDIA Parakeet TDT 0.6B v3](https://huggingface.co/nvidia/parakeet-tdt-0.6b-v3) behind an OpenAI-compatible transcription server | Direct when the server returns `{ "text": "..." }` | The benchmark that selected the Parakeet family measured an older `tdt_ctc-110m` endpoint at 82.62–89.30 ms warm latency and 0.0 normalized WER on one clean sentence. Those numbers do not describe the newer 0.6B v3 model. |
| Multilingual STT candidate | [Qwen3-ASR 0.6B](https://github.com/QwenLM/Qwen3-ASR) through vLLM or an adapter | Conditional: normalize provider-prefixed output into a clean `text` value | 196.36–278.98 ms warm latency and 0.0 normalized WER after prefix normalization on the same clean sentence; the first cold request took about 33 seconds. |
| TTS on Apple Silicon | [MLX Audio](https://github.com/Blaizzy/mlx-audio) with `mlx-community/Kokoro-82M-bf16` | Direct when requested with `response_format: "pcm"` | The three-run same-host rerun measured median TTS stage latency at 325.95 ms. |
| TTS on NVIDIA or CPU | [Kokoro-FastAPI](https://github.com/remsky/Kokoro-FastAPI) with `kokoro` | Direct: `/v1/audio/speech` returns 24 kHz PCM as `audio/pcm` | 444.20 ms time to first audio and 0.1545 real-time factor; fastest of the three locally tested TTS candidates. |

The detailed reports are the
[Anvil Serving STT benchmark](https://github.com/fakoli/anvil-serving/blob/main/docs/findings/2026-07-08-stt-model-benchmark.md),
[TTS candidate benchmark](https://github.com/fakoli/anvil-serving/blob/main/docs/findings/2026-07-voice-tts-ab.md),
and [voice latency candidate matrix](https://github.com/fakoli/anvil-serving/blob/main/docs/findings/2026-07-08-voice-latency-candidate-matrix.md).

### Evidence limits

- The STT comparison used one clean 16 kHz English sentence. It establishes
  basic correctness and latency, not accuracy across accents, noise, numbers,
  languages, or long-form speech.
- The separate Apple Silicon timing baseline used generated input that yielded
  an empty STT hypothesis. Its STT number is stage-latency evidence, not an
  accuracy result.
- The TTS comparison checked latency and PCM sanity. It did not include a human
  listening test or a mean-opinion score.
- Hardware, model warmth, serving engine, chunk size, and network placement can
  change the result substantially. Measure on your deployment before treating
  these numbers as an SLO.

## Apple Silicon example

[MLX Audio](https://github.com/Blaizzy/mlx-audio) can expose both Parakeet and
Kokoro through OpenAI-compatible endpoints. Running separate server processes
keeps the two models independently warm:

```bash
mlx_audio.server --host 127.0.0.1 --port 30010
mlx_audio.server --host 127.0.0.1 --port 30011
```

```jsonc
{
  "talk": {
    "realtime": {
      "provider": "openai-cascade",
      "transport": "gateway-relay",
      "providers": {
        "openai-cascade": {
          "sttBaseUrl": "http://127.0.0.1:30010/v1",
          "sttModel": "mlx-community/parakeet-tdt-0.6b-v3",
          "llmBaseUrl": "http://127.0.0.1:8000/v1",
          "llmModel": "your-chat-model",
          "ttsBaseUrl": "http://127.0.0.1:30011/v1",
          "ttsModel": "mlx-community/Kokoro-82M-bf16",
          "ttsSampleRateHz": 24000,
          "voice": "af_heart"
        }
      }
    }
  }
}
```

This is an optional same-host example for operators who want models on their
Mac. In the Fakoli reference deployment, the OpenClaw Gateway host remains
model-free and reaches audio services on a separate GPU host.

## Parakeet plus Kokoro example

For Linux, Windows/WSL, or a dedicated model host, expose Parakeet through an
OpenAI-compatible `/v1/audio/transcriptions` server and Kokoro through
Kokoro-FastAPI:

```jsonc
{
  "talk": {
    "realtime": {
      "provider": "openai-cascade",
      "transport": "gateway-relay",
      "providers": {
        "openai-cascade": {
          "sttBaseUrl": "http://127.0.0.1:30010/v1",
          "sttModel": "tdt-0.6b-v3",
          "llmBaseUrl": "http://127.0.0.1:8000/v1",
          "llmModel": "your-chat-model",
          "ttsBaseUrl": "http://127.0.0.1:30011/v1",
          "ttsModel": "kokoro",
          "ttsSampleRateHz": 24000,
          "voice": "af_heart"
        }
      }
    }
  }
}
```

Use the exact model IDs advertised by each server's `/v1/models` response; the
IDs above are current starting points and may differ in another wrapper. The
published Parakeet latency evidence used the older `tdt_ctc-110m` endpoint,
not the `tdt-0.6b-v3` example shown here.
Endpoints on another host should use TLS or a private network as described in
the [configuration reference](CONFIGURATION.md#network-policy).

## Other measured candidates

| Candidate | Result | Recommendation |
| --- | --- | --- |
| Qwen3-ASR 1.7B | 223.96–290.59 ms warm latency and 0.0 normalized WER on the single clean sample | Re-test on a harder corpus before choosing it over the smaller 0.6B model. |
| Whisper Large V3 Turbo through the tested vLLM recipes | 642.42–730.69 ms warm latency and repeated hallucinated text | Do not use those specific serving recipes without debugging or changing the adapter. This is not a rejection of Whisper in every runtime. |
| Orpheus-3B through the tested custom shim | 2958.77 ms time to first audio; 0.9912 real-time factor | Experimental. The measured two-container shim was disposable and not ready to recommend as a packaged endpoint. |
| Qwen3-TTS 1.7B CustomVoice through the tested sidecar | 4697.07 ms time to first audio; 1.7959 real-time factor | Experimental. The proof mutated a throwaway vLLM environment and should not be copied as a production recipe. |

## Verify an endpoint before configuring Talk

The cascade sends 16 kHz mono WAV to STT and requests raw PCM16 from TTS. Test
those exact contracts rather than relying on an “OpenAI-compatible” label:

```bash
curl -s http://127.0.0.1:30010/v1/models
curl -s http://127.0.0.1:30011/v1/models
```

For STT, confirm that `POST /v1/audio/transcriptions` returns JSON containing a
nonempty, clean `text` string. For TTS, confirm that `POST /v1/audio/speech`
with `response_format: "pcm"` returns nonempty, even-length, headerless signed
16-bit little-endian audio at the configured `ttsSampleRateHz`, with an
`audio/pcm`, `audio/l16`, `audio/raw`, or `application/octet-stream` response
type. A service that only returns WAV, MP3, or another encoded format needs an
adapter before it can be used by the current cascade.
