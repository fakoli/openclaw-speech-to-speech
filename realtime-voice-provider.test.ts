// Speech to Speech tests cover realtime provider bridge behavior.
import {
  REALTIME_VOICE_AUDIO_FORMAT_G711_ULAW_8KHZ,
  REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
  type RealtimeVoiceAudioFormat,
  type RealtimeVoiceTool,
} from "openclaw/plugin-sdk/realtime-voice";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  buildAnvilServingRealtimeVoiceProvider,
  resolveAnvilRealtimeUrl,
} from "./realtime-voice-provider.js";

const { FakeWebSocket } = vi.hoisted(() => {
  type Listener = (...args: unknown[]) => void;

  class MockWebSocket {
    static readonly OPEN = 1;
    static readonly CLOSED = 3;
    static instances: MockWebSocket[] = [];

    readonly listeners = new Map<string, Listener[]>();
    readyState = 0;
    sent: string[] = [];
    closed = false;
    args: unknown[];

    constructor(...args: unknown[]) {
      this.args = args;
      MockWebSocket.instances.push(this);
    }

    on(event: string, listener: Listener): this {
      const listeners = this.listeners.get(event) ?? [];
      listeners.push(listener);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) {
        listener(...args);
      }
    }

    send(payload: string): void {
      this.sent.push(payload);
    }

    close(code?: number, reason?: string): void {
      this.closed = true;
      this.readyState = MockWebSocket.CLOSED;
      this.emit("close", code ?? 1000, Buffer.from(reason ?? ""));
    }
  }

  return { FakeWebSocket: MockWebSocket };
});

vi.mock("ws", () => ({
  default: FakeWebSocket,
}));

type FakeWebSocketInstance = InstanceType<typeof FakeWebSocket>;
type SentRealtimeEvent = {
  type: string;
  audio?: string;
  event_id?: string;
  item?: {
    call_id?: string;
    content?: Array<{ text?: string; type?: string }>;
    name?: string;
    output?: string;
    role?: string;
    suppress_response?: boolean;
    type?: string;
    will_continue?: boolean;
  };
  session?: {
    audio?: {
      input?: {
        format?: { rate?: number; type?: string };
        turn_detection?: {
          create_response?: boolean;
          interrupt_response?: boolean;
          silence_duration_ms?: number;
          threshold?: number;
        };
      };
      output?: {
        format?: { rate?: number; type?: string };
        voice?: string;
      };
    };
    instructions?: string;
    model?: string;
    output_modalities?: string[];
    tool_choice?: string;
    tools?: Array<{ name?: string; type?: string }>;
    type?: string;
  };
};

function parseSent(socket: FakeWebSocketInstance): SentRealtimeEvent[] {
  return socket.sent.map((payload) => JSON.parse(payload) as SentRealtimeEvent);
}

function createOpenBridge(
  overrides: Record<string, unknown> = {},
  requestOverrides: {
    audioFormat?: RealtimeVoiceAudioFormat | false;
    onToolCall?: (call: { itemId: string; callId: string; name: string; args: unknown }) => void;
    tools?: RealtimeVoiceTool[];
  } = {},
) {
  const provider = buildAnvilServingRealtimeVoiceProvider();
  const onAudio = vi.fn();
  const onClearAudio = vi.fn();
  const onError = vi.fn();
  const onEvent = vi.fn();
  const onReady = vi.fn();
  const onTranscript = vi.fn();
  const onToolCall = requestOverrides.onToolCall ? vi.fn(requestOverrides.onToolCall) : vi.fn();
  const bridge = provider.createBridge({
    providerConfig: {
      realtimeUrl: "ws://127.0.0.1:8765/v1/realtime",
      ...overrides,
    },
    instructions: "Speak briefly.",
    ...(requestOverrides.audioFormat === false
      ? {}
      : { audioFormat: requestOverrides.audioFormat ?? REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ }),
    onAudio,
    onClearAudio,
    onError,
    onEvent,
    onReady,
    onTranscript,
    onToolCall,
    tools: requestOverrides.tools,
  });
  const connecting = bridge.connect();
  const socket = FakeWebSocket.instances[0];
  if (!socket) {
    throw new Error("expected Anvil Serving WebSocket");
  }
  socket.readyState = FakeWebSocket.OPEN;
  socket.emit("open");
  return {
    bridge,
    connecting,
    onAudio,
    onClearAudio,
    onError,
    onEvent,
    onReady,
    onTranscript,
    onToolCall,
    socket,
  };
}

async function finishReady(
  socket: FakeWebSocketInstance,
  connecting: Promise<void>,
): Promise<void> {
  socket.emit("message", Buffer.from(JSON.stringify({ type: "session.updated" })));
  await connecting;
}

describe("buildAnvilServingRealtimeVoiceProvider", () => {
  beforeEach(() => {
    FakeWebSocket.instances = [];
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllEnvs();
  });

  it("declares gateway-relay realtime Talk capabilities for catalog selection", () => {
    const provider = buildAnvilServingRealtimeVoiceProvider();

    expect(provider.id).toBe("anvil-serving");
    expect(provider.label).toBe("Anvil Serving Realtime");
    expect(provider.aliases).toEqual(["anvil"]);
    expect(provider.defaultModel).toBe("fast-local");
    expect(provider.capabilities).toEqual({
      transports: ["gateway-relay"],
      inputAudioFormats: [
        REALTIME_VOICE_AUDIO_FORMAT_G711_ULAW_8KHZ,
        REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
      ],
      outputAudioFormats: [
        REALTIME_VOICE_AUDIO_FORMAT_G711_ULAW_8KHZ,
        REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
      ],
      supportsBrowserSession: false,
      supportsBargeIn: true,
      supportsToolCalls: true,
    });
  });

  it("normalizes base URLs into the Anvil Serving Realtime WebSocket endpoint", () => {
    expect(resolveAnvilRealtimeUrl({ baseUrl: "http://127.0.0.1:8765" })).toBe(
      "ws://127.0.0.1:8765/v1/realtime",
    );
    expect(resolveAnvilRealtimeUrl({ baseUrl: "https://anvil.example.test/voice/v1" })).toBe(
      "wss://anvil.example.test/voice/v1/realtime",
    );
  });

  it("rejects loopback hostname aliases and cleartext public WebSocket URLs", () => {
    const loopbackHostnameAlias = ["local", "host"].join("");
    expect(() =>
      resolveAnvilRealtimeUrl({
        realtimeUrl: `ws://${loopbackHostnameAlias}:8765/v1/realtime`,
      }),
    ).toThrow("127.0.0.1");
    expect(() => resolveAnvilRealtimeUrl({ realtimeUrl: "ws://example.test/v1/realtime" })).toThrow(
      "use wss://",
    );
  });

  it("rejects realtime URLs with credentials, query strings, or fragments", () => {
    for (const realtimeUrl of [
      "ws://user:pass@127.0.0.1:8765/v1/realtime",
      "ws://127.0.0.1:8765/v1/realtime?token=secret",
      "ws://127.0.0.1:8765/v1/realtime#token",
    ]) {
      expect(() => resolveAnvilRealtimeUrl({ realtimeUrl })).toThrow(
        "must not include credentials",
      );
    }
  });

  it("requires an explicit Anvil Serving Realtime URL before provider selection", () => {
    const provider = buildAnvilServingRealtimeVoiceProvider();

    expect(provider.isConfigured({ providerConfig: {} })).toBe(false);
    expect(
      provider.isConfigured({
        providerConfig: { baseUrl: "http://127.0.0.1:8765" },
      }),
    ).toBe(true);
  });

  it("keeps the legacy anvil provider configuration key working", () => {
    const provider = buildAnvilServingRealtimeVoiceProvider();

    expect(
      provider.isConfigured({
        providerConfig: {
          providers: {
            anvil: {
              baseUrl: "http://127.0.0.1:8765",
            },
          },
        },
      }),
    ).toBe(true);
  });

  it("connects with bearer auth and sends an Anvil Serving session update", async () => {
    const { connecting, onReady, socket } = createOpenBridge({
      apiKey: "anvil-token",
      model: "fast-local",
      voice: "alloy",
      vadThreshold: 0.4,
      silenceDurationMs: 180,
    });

    await finishReady(socket, connecting);

    const options = socket.args[1] as { headers?: Record<string, string>; maxPayload?: number };
    expect(options.headers?.Authorization).toBe("Bearer anvil-token");
    expect(options.maxPayload).toBe(16 * 1024 * 1024);
    expect(onReady).toHaveBeenCalledTimes(1);
    const sessionUpdate = parseSent(socket)[0];
    expect(sessionUpdate).toEqual({
      type: "session.update",
      session: {
        type: "realtime",
        model: "fast-local",
        instructions: "Speak briefly.",
        output_modalities: ["audio"],
        audio: {
          input: {
            format: { type: "audio/pcm", rate: 16000 },
            turn_detection: {
              type: "server_vad",
              threshold: 0.4,
              prefix_padding_ms: 0,
              silence_duration_ms: 180,
              create_response: true,
              interrupt_response: true,
            },
          },
          output: {
            format: { type: "audio/pcm", rate: 16000 },
            voice: "alloy",
          },
        },
      },
    });
  });

  it("sends realtime tools in the Anvil Serving session update", async () => {
    const { connecting, socket } = createOpenBridge(
      {},
      {
        tools: [
          {
            type: "function",
            name: "openclaw_agent_consult",
            description: "Ask OpenClaw.",
            parameters: {
              type: "object",
              properties: { question: { type: "string" } },
              required: ["question"],
            },
          },
        ],
      },
    );

    await finishReady(socket, connecting);

    const session = parseSent(socket)[0]?.session;
    expect(session?.tools).toEqual([
      {
        type: "function",
        name: "openclaw_agent_consult",
        description: "Ask OpenClaw.",
        parameters: {
          type: "object",
          properties: { question: { type: "string" } },
          required: ["question"],
        },
      },
    ]);
    expect(session?.tool_choice).toBe("auto");
  });

  it("rejects connect when Anvil Serving never acknowledges the session update", async () => {
    vi.useFakeTimers();
    const { connecting, onError } = createOpenBridge();
    const rejected = expect(connecting).rejects.toThrow("session.updated timed out");

    await vi.advanceTimersByTimeAsync(10_000);

    await rejected;
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: "Speech to Speech realtime session.updated timed out",
      }),
    );
  });

  it("resamples relay audio to Anvil Serving PCM16 and commits after sustained silence", async () => {
    const { bridge, connecting, socket } = createOpenBridge({ silenceDurationMs: 20 });
    await finishReady(socket, connecting);

    bridge.sendAudio(Buffer.alloc(480, 1));
    bridge.sendAudio(Buffer.alloc(960));

    const events = parseSent(socket);
    expect(events.map((event) => event.type)).toEqual([
      "session.update",
      "input_audio_buffer.append",
      "input_audio_buffer.append",
      "input_audio_buffer.commit",
    ]);
    const speechAudio = Buffer.from(events[1]?.audio ?? "", "base64");
    const silenceAudio = Buffer.from(events[2]?.audio ?? "", "base64");
    expect(speechAudio).toHaveLength(320);
    expect(silenceAudio).toHaveLength(640);
  });

  it("treats low-amplitude nonzero PCM as silence for turn commit", async () => {
    const { bridge, connecting, socket } = createOpenBridge({ silenceDurationMs: 20 });
    await finishReady(socket, connecting);
    const lowNoise = Buffer.alloc(960);
    for (let offset = 0; offset < lowNoise.length; offset += 2) {
      lowNoise.writeInt16LE(4, offset);
    }

    bridge.sendAudio(Buffer.alloc(480, 1));
    bridge.sendAudio(lowNoise);

    expect(parseSent(socket).map((event) => event.type)).toEqual([
      "session.update",
      "input_audio_buffer.append",
      "input_audio_buffer.append",
      "input_audio_buffer.commit",
    ]);
  });

  it("defaults to telephony mulaw audio when no relay audio format is supplied", async () => {
    const { bridge, connecting, onAudio, socket } = createOpenBridge({}, { audioFormat: false });
    await finishReady(socket, connecting);

    bridge.sendAudio(Buffer.alloc(160, 0x00));
    const events = parseSent(socket);
    expect(Buffer.from(events[1]?.audio ?? "", "base64")).toHaveLength(640);

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_audio.delta",
          delta: Buffer.alloc(640, 3).toString("base64"),
        }),
      ),
    );

    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(onAudio.mock.calls[0]?.[0]).toHaveLength(160);
  });

  it("queues audio before readiness and flushes it after session.updated", async () => {
    const { bridge, connecting, socket } = createOpenBridge({ silenceDurationMs: 20 });

    bridge.sendAudio(Buffer.alloc(480, 1));
    expect(parseSent(socket)).toHaveLength(1);

    await finishReady(socket, connecting);

    expect(parseSent(socket).map((event) => event.type)).toEqual([
      "session.update",
      "input_audio_buffer.append",
    ]);
  });

  it("shares an in-flight connection and rejects it when closed before readiness", async () => {
    const { bridge, connecting } = createOpenBridge();
    const duplicate = bridge.connect();
    const rejected = expect(connecting).rejects.toThrow("closed before readiness");

    expect(duplicate).toBe(connecting);
    expect(FakeWebSocket.instances).toHaveLength(1);
    bridge.close();

    await rejected;
  });

  it("copies queued audio so caller mutation cannot change the pending turn", async () => {
    const { bridge, connecting, socket } = createOpenBridge();
    const audio = Buffer.alloc(480, 1);

    bridge.sendAudio(audio);
    audio.fill(0);
    await finishReady(socket, connecting);

    const queuedAudio = Buffer.from(parseSent(socket)[1]?.audio ?? "", "base64");
    expect(queuedAudio.some((byte) => byte !== 0)).toBe(true);
  });

  it("fails closed when pre-ready audio exceeds the queue boundary", async () => {
    const { bridge, connecting, onError, socket } = createOpenBridge();

    for (let chunk = 0; chunk <= 320; chunk += 1) {
      bridge.sendAudio(Buffer.alloc(480, 1));
    }

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("queued before readiness exceeded") }),
    );
    await finishReady(socket, connecting);
    expect(parseSent(socket).map((event) => event.type)).toEqual(["session.update"]);
  });

  it("rejects oversized and incomplete realtime audio chunks", async () => {
    const { bridge, connecting, onError, socket } = createOpenBridge();
    await finishReady(socket, connecting);

    bridge.sendAudio(Buffer.alloc((1024 * 1024) + 1, 1));
    bridge.sendAudio(Buffer.alloc(3, 1));

    expect(onError).toHaveBeenCalledTimes(2);
    expect(parseSent(socket).slice(-2).map((event) => event.type)).toEqual([
      "input_audio_buffer.clear",
      "input_audio_buffer.clear",
    ]);
  });

  it("fails closed when pre-ready text exceeds the queue boundary", async () => {
    const { bridge, connecting, onError, socket } = createOpenBridge();

    for (let message = 0; message <= 64; message += 1) {
      bridge.sendUserMessage?.(`message-${message}`);
    }

    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("messages queued before readiness exceeded") }),
    );
    await finishReady(socket, connecting);
    expect(parseSent(socket).map((event) => event.type)).toEqual(["session.update"]);
  });

  it("ignores audio and text submitted after close", async () => {
    const { bridge, connecting, socket } = createOpenBridge();
    await finishReady(socket, connecting);
    const sentBeforeClose = socket.sent.length;

    bridge.close();
    bridge.sendAudio(Buffer.alloc(480, 1));
    bridge.sendUserMessage?.("Do not send this.");

    expect(socket.sent).toHaveLength(sentBeforeClose);
  });

  it("maps Anvil Serving audio and transcript server events into bridge callbacks", async () => {
    const { connecting, onAudio, onEvent, onTranscript, socket } = createOpenBridge();
    await finishReady(socket, connecting);
    const anvilPcm16k = Buffer.alloc(320, 2);

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.created",
          response: { id: "resp_1", status: "in_progress" },
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "turn-1",
          transcript: "what is the status",
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_audio_transcript.delta",
          response_id: "resp_1",
          delta: "The fast tier is ready.",
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_audio.delta",
          response_id: "resp_1",
          item_id: "item_1",
          delta: anvilPcm16k.toString("base64"),
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "response.done", response: { id: "resp_1" } })),
    );

    expect(onTranscript).toHaveBeenCalledWith("user", "what is the status", true);
    expect(onTranscript).toHaveBeenCalledWith("assistant", "The fast tier is ready.", false);
    expect(onAudio).toHaveBeenCalledTimes(1);
    expect(onAudio.mock.calls[0]?.[0]).toHaveLength(480);
    expect(onEvent).toHaveBeenCalledWith({
      direction: "server",
      type: "response.output_audio.delta",
      itemId: "item_1",
      responseId: "resp_1",
    });
    expect(onEvent).toHaveBeenCalledWith({
      direction: "server",
      type: "response.done",
      itemId: undefined,
      responseId: "resp_1",
    });
  });

  it("emits tool calls from Anvil Serving function-call item events", async () => {
    const { connecting, onToolCall, socket } = createOpenBridge();
    await finishReady(socket, connecting);

    const payload = {
      type: "conversation.item.done",
      item: {
        id: "call_1",
        type: "function_call",
        call_id: "call_1",
        name: "openclaw_agent_consult",
        arguments: '{"question":"weather"}',
      },
    };
    socket.emit("message", Buffer.from(JSON.stringify(payload)));
    socket.emit("message", Buffer.from(JSON.stringify(payload)));

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith({
      itemId: "call_1",
      callId: "call_1",
      name: "openclaw_agent_consult",
      args: { question: "weather" },
    });
  });

  it("emits tool calls from standard Anvil Serving Realtime function-call events", async () => {
    const { connecting, onToolCall, socket } = createOpenBridge();
    await finishReady(socket, connecting);

    const argumentsDone = {
      type: "response.function_call_arguments.done",
      response_id: "resp_1",
      item_id: "call_1",
      call_id: "call_1",
      name: "openclaw_agent_consult",
      arguments: '{"question":"weather"}',
    };
    const outputItemDone = {
      type: "response.output_item.done",
      response_id: "resp_1",
      item: {
        id: "call_1",
        type: "function_call",
        call_id: "call_1",
        name: "openclaw_agent_consult",
        arguments: '{"question":"weather"}',
      },
    };
    socket.emit("message", Buffer.from(JSON.stringify(argumentsDone)));
    socket.emit("message", Buffer.from(JSON.stringify(outputItemDone)));

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(onToolCall).toHaveBeenCalledWith({
      itemId: "call_1",
      callId: "call_1",
      name: "openclaw_agent_consult",
      args: { question: "weather" },
    });
  });

  it("rejects malformed function-call arguments instead of invoking tools with empty args", async () => {
    const { connecting, onError, onToolCall, socket } = createOpenBridge();
    await finishReady(socket, connecting);

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.function_call_arguments.done",
          item_id: "call_bad",
          call_id: "call_bad",
          name: "openclaw_agent_consult",
          arguments: '{"question":',
        }),
      ),
    );

    expect(onToolCall).not.toHaveBeenCalled();
    expect(onError).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining("invalid JSON"),
      }),
    );
  });

  it("round trips an Anvil Serving function call through OpenClaw with the same call id", async () => {
    const bridgeRef: { current?: { submitToolResult: (callId: string, result: unknown) => void } } =
      {};
    const { bridge, connecting, onToolCall, socket } = createOpenBridge(
      {},
      {
        onToolCall: (call) => {
          bridgeRef.current?.submitToolResult(call.callId, { answer: "Sunny." });
        },
      },
    );
    bridgeRef.current = bridge;
    await finishReady(socket, connecting);

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "response.output_item.done",
          item: {
            id: "call_weather",
            type: "function_call",
            call_id: "call_weather",
            name: "openclaw_agent_consult",
            arguments: '{"question":"weather"}',
          },
        }),
      ),
    );

    expect(onToolCall).toHaveBeenCalledTimes(1);
    expect(parseSent(socket).at(-1)).toEqual({
      type: "conversation.item.create",
      item: {
        type: "function_call_output",
        call_id: "call_weather",
        output: '{"answer":"Sunny."}',
      },
    });
  });

  it("submits Anvil Serving function-call outputs with continuation options", async () => {
    const { bridge, connecting, socket } = createOpenBridge();
    await finishReady(socket, connecting);

    bridge.submitToolResult("call_1", { status: "working" }, { willContinue: true });
    bridge.submitToolResult("call_1", { text: "done" }, { suppressResponse: true });

    expect(parseSent(socket).slice(-2)).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "call_1",
          output: '{"status":"working"}',
          will_continue: true,
        },
      },
      {
        type: "conversation.item.create",
        item: {
          type: "function_call_output",
          call_id: "call_1",
          output: '{"text":"done"}',
          suppress_response: true,
        },
      },
    ]);
  });

  it("deduplicates final user transcripts emitted through both Anvil Serving item events", async () => {
    const { connecting, onTranscript, socket } = createOpenBridge();
    await finishReady(socket, connecting);

    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.input_audio_transcription.completed",
          item_id: "turn-1",
          transcript: "what is the status",
        }),
      ),
    );
    socket.emit(
      "message",
      Buffer.from(
        JSON.stringify({
          type: "conversation.item.created",
          item: {
            id: "turn-1",
            role: "user",
            content: [{ type: "input_text", text: "what is the status" }],
          },
        }),
      ),
    );

    expect(onTranscript).toHaveBeenCalledTimes(1);
    expect(onTranscript).toHaveBeenCalledWith("user", "what is the status", true);
  });

  it("sends text turns through conversation.item.create and response.create", async () => {
    const { bridge, connecting, socket } = createOpenBridge();
    await finishReady(socket, connecting);

    bridge.sendUserMessage?.("  Say hello.  ");

    expect(parseSent(socket).slice(-2)).toEqual([
      {
        type: "conversation.item.create",
        item: {
          type: "message",
          role: "user",
          content: [{ type: "input_text", text: "Say hello." }],
        },
      },
      {
        type: "response.create",
        event_id: expect.stringMatching(/^openclaw-anvil-response-create-/),
      },
    ]);
  });

  it("cancels Anvil Serving output and clears relay audio on barge-in", async () => {
    const { bridge, connecting, onClearAudio, onEvent, socket } = createOpenBridge();
    await finishReady(socket, connecting);
    socket.emit(
      "message",
      Buffer.from(JSON.stringify({ type: "response.created", response: { id: "resp_1" } })),
    );

    bridge.handleBargeIn?.({ audioPlaybackActive: true });

    expect(parseSent(socket).slice(-2)).toEqual([
      {
        type: "response.cancel",
        event_id: expect.stringMatching(/^openclaw-anvil-response-cancel-/),
      },
      { type: "input_audio_buffer.clear" },
    ]);
    expect(onClearAudio).toHaveBeenCalledTimes(1);
    expect(onEvent).toHaveBeenCalledWith({
      direction: "client",
      type: "response.cancel",
      detail: "reason=barge-in",
      responseId: "resp_1",
    });
  });
});
