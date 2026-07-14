import {
  REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
  type RealtimeVoiceBridgeCallbacks,
} from "openclaw/plugin-sdk/realtime-voice";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildOpenAICascadeVoiceProvider,
  resolveOpenAICompatibleUrl,
} from "./openai-cascade-voice-provider.js";

function waitForAssertion(assertion: () => void, timeoutMs = 1000): Promise<void> {
  return new Promise((resolve, reject) => {
    const deadline = Date.now() + timeoutMs;
    const tick = () => {
      try {
        assertion();
        resolve();
      } catch (error) {
        if (Date.now() >= deadline) {
          reject(error);
          return;
        }
        setTimeout(tick, 10);
      }
    };
    tick();
  });
}

describe("OpenAI-compatible speech-to-speech provider", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("normalizes endpoint bases without permitting unsafe cleartext public URLs", () => {
    expect(resolveOpenAICompatibleUrl("http://127.0.0.1:8000/v1", "audio/speech")).toBe(
      "http://127.0.0.1:8000/v1/audio/speech",
    );
    expect(() => resolveOpenAICompatibleUrl("http://example.test/v1", "audio/speech")).toThrow(
      "use https://",
    );
  });

  it("runs an audio turn against user-owned OpenAI-compatible STT, LLM, and TTS endpoints", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(JSON.stringify({ text: "What is the weather?" }), { status: 200 }))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({ choices: [{ message: { content: "It is sunny." } }] }),
          { status: 200 },
        ),
      )
      .mockResolvedValueOnce(new Response(Buffer.alloc(640, 3), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const onAudio = vi.fn<RealtimeVoiceBridgeCallbacks["onAudio"]>();
    const onClearAudio = vi.fn<RealtimeVoiceBridgeCallbacks["onClearAudio"]>();
    const onError = vi.fn<NonNullable<RealtimeVoiceBridgeCallbacks["onError"]>>();
    const onTranscript = vi.fn<NonNullable<RealtimeVoiceBridgeCallbacks["onTranscript"]>>();
    const onReady = vi.fn<NonNullable<RealtimeVoiceBridgeCallbacks["onReady"]>>();
    const provider = buildOpenAICascadeVoiceProvider();
    const bridge = provider.createBridge({
      providerConfig: {
        sttBaseUrl: "http://127.0.0.1:30010/v1",
        sttModel: "parakeet",
        llmBaseUrl: "http://127.0.0.1:8000/v1",
        llmModel: "local-chat",
        ttsBaseUrl: "http://127.0.0.1:30011/v1",
        ttsModel: "kokoro",
        ttsSampleRateHz: 16000,
        voice: "af_sky",
        silenceDurationMs: 20,
      },
      instructions: "Answer briefly.",
      audioFormat: REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
      onAudio,
      onClearAudio,
      onError,
      onReady,
      onTranscript,
    });

    await bridge.connect();
    bridge.sendAudio(Buffer.alloc(480, 1));
    bridge.sendAudio(Buffer.alloc(960));

    await waitForAssertion(() => expect(onAudio).toHaveBeenCalledTimes(1));
    expect(onReady).toHaveBeenCalledTimes(1);
    expect(onError).not.toHaveBeenCalled();
    expect(onTranscript).toHaveBeenCalledWith("user", "What is the weather?", true);
    expect(onTranscript).toHaveBeenCalledWith("assistant", "It is sunny.", true);
    expect(onAudio.mock.calls[0]?.[0]).toHaveLength(960);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "http://127.0.0.1:30010/v1/audio/transcriptions",
      "http://127.0.0.1:8000/v1/chat/completions",
      "http://127.0.0.1:30011/v1/audio/speech",
    ]);
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({
      headers: { "Content-Type": "application/json" },
    });
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toEqual({
      model: "local-chat",
      messages: [
        { role: "system", content: "Answer briefly." },
        { role: "user", content: "What is the weather?" },
      ],
      stream: false,
    });
    expect(JSON.parse(String(fetchMock.mock.calls[2]?.[1]?.body))).toEqual({
      model: "kokoro",
      input: "It is sunny.",
      voice: "af_sky",
      response_format: "pcm",
    });
  });

  it("times out a stalled upstream request", async () => {
    const fetchMock = vi.fn<typeof fetch>((_url, init) =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const onError = vi.fn<NonNullable<RealtimeVoiceBridgeCallbacks["onError"]>>();
    const bridge = buildOpenAICascadeVoiceProvider().createBridge({
      providerConfig: standaloneConfig({ requestTimeoutMs: 5 }),
      onAudio: vi.fn(),
      onClearAudio: vi.fn(),
      onError,
    });

    await bridge.connect();
    bridge.sendUserMessage?.("Hello");

    await waitForAssertion(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onError.mock.calls[0]?.[0].message).toContain("upstream request timed out");
  });

  it("aborts a superseded turn before starting another", async () => {
    let firstSignal: AbortSignal | undefined;
    const fetchMock = vi.fn<typeof fetch>((_url, init) => {
      if (fetchMock.mock.calls.length === 1) {
        firstSignal = init?.signal ?? undefined;
        return new Promise(() => {});
      }
      if (fetchMock.mock.calls.length === 2) {
        return Promise.resolve(
          new Response(JSON.stringify({ choices: [{ message: { content: "Second reply" } }] })),
        );
      }
      return Promise.resolve(new Response(Buffer.alloc(640, 2)));
    });
    vi.stubGlobal("fetch", fetchMock);
    const onAudio = vi.fn<RealtimeVoiceBridgeCallbacks["onAudio"]>();
    const bridge = buildOpenAICascadeVoiceProvider().createBridge({
      providerConfig: standaloneConfig(),
      onAudio,
      onClearAudio: vi.fn(),
      onError: vi.fn(),
    });

    await bridge.connect();
    bridge.sendUserMessage?.("First");
    await waitForAssertion(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    bridge.sendUserMessage?.("Second");

    await waitForAssertion(() => expect(onAudio).toHaveBeenCalledTimes(1));
    expect(firstSignal?.aborted).toBe(true);
  });

  it("rejects a successful non-PCM TTS response and terminates the response", async () => {
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ choices: [{ message: { content: "Hello" } }] })),
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ error: "wrong format" }), {
          headers: { "Content-Type": "application/json" },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    const onAudio = vi.fn<RealtimeVoiceBridgeCallbacks["onAudio"]>();
    const onError = vi.fn<NonNullable<RealtimeVoiceBridgeCallbacks["onError"]>>();
    const onEvent = vi.fn<NonNullable<RealtimeVoiceBridgeCallbacks["onEvent"]>>();
    const bridge = buildOpenAICascadeVoiceProvider().createBridge({
      providerConfig: standaloneConfig(),
      onAudio,
      onClearAudio: vi.fn(),
      onError,
      onEvent,
    });

    await bridge.connect();
    bridge.sendUserMessage?.("Hello");

    await waitForAssertion(() => expect(onError).toHaveBeenCalledTimes(1));
    expect(onAudio).not.toHaveBeenCalled();
    expect(onError.mock.calls[0]?.[0].message).toContain("not raw PCM");
    expect(onEvent).toHaveBeenCalledWith(
      expect.objectContaining({ type: "response.done", detail: "status=failed" }),
    );
  });
});

function standaloneConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    sttBaseUrl: "http://127.0.0.1:30010/v1",
    sttModel: "parakeet",
    llmBaseUrl: "http://127.0.0.1:8000/v1",
    llmModel: "local-chat",
    ttsBaseUrl: "http://127.0.0.1:30011/v1",
    ttsModel: "kokoro",
    ...overrides,
  };
}
