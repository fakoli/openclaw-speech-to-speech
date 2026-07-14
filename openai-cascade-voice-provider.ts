// Standalone OpenAI-compatible STT -> LLM -> TTS provider for OpenClaw Talk.
import { randomUUID } from "node:crypto";
import type {
  RealtimeVoiceAudioFormat,
  RealtimeVoiceBridge,
  RealtimeVoiceBridgeCreateRequest,
  RealtimeVoiceProviderConfig,
  RealtimeVoiceProviderPlugin,
} from "openclaw/plugin-sdk/realtime-voice";
import {
  REALTIME_VOICE_AUDIO_FORMAT_G711_ULAW_8KHZ,
  REALTIME_VOICE_AUDIO_FORMAT_PCM16_24KHZ,
  convertPcmToMulaw8k,
  mulawToPcm,
  resamplePcm,
} from "openclaw/plugin-sdk/realtime-voice";
import { normalizeResolvedSecretInputString } from "openclaw/plugin-sdk/secret-input";
import { isPrivateOrLoopbackHost } from "openclaw/plugin-sdk/ssrf-runtime";
import { asFiniteNumber, normalizeOptionalString } from "openclaw/plugin-sdk/string-coerce-runtime";

const OPENAI_CASCADE_PROVIDER_ID = "openai-cascade";
const OPENAI_CASCADE_LABEL = "Speech to Speech (OpenAI-compatible)";
const SAMPLE_RATE_HZ = 16_000;
const DEFAULT_SILENCE_DURATION_MS = 200;
const DEFAULT_TTS_SAMPLE_RATE_HZ = 24_000;
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;
const SILENCE_SAMPLE_ABS_THRESHOLD = 256;
const MAX_BUFFERED_AUDIO_BYTES = 10 * 1024 * 1024;
const MAX_JSON_RESPONSE_BYTES = 1024 * 1024;
const MAX_TTS_RESPONSE_BYTES = 25 * 1024 * 1024;
const MAX_ERROR_RESPONSE_BYTES = 16 * 1024;
const LOOPBACK_HOSTNAME_ALIAS = ["local", "host"].join("");

type OpenAICascadeProviderConfig = {
  sttBaseUrl?: string;
  sttApiKey?: string;
  sttModel?: string;
  llmBaseUrl?: string;
  llmApiKey?: string;
  llmModel?: string;
  ttsBaseUrl?: string;
  ttsApiKey?: string;
  ttsModel?: string;
  ttsSampleRateHz?: number;
  voice?: string;
  silenceDurationMs?: number;
  requestTimeoutMs?: number;
};

type OpenAICascadeBridgeConfig = RealtimeVoiceBridgeCreateRequest & Required<
  Pick<
    OpenAICascadeProviderConfig,
    "sttBaseUrl" | "sttModel" | "llmBaseUrl" | "llmModel" | "ttsBaseUrl" | "ttsModel"
  >
> &
  OpenAICascadeProviderConfig;

function resolveProviderConfigRecord(config: RealtimeVoiceProviderConfig): Record<string, unknown> {
  const providers =
    typeof config.providers === "object" && config.providers !== null && !Array.isArray(config.providers)
      ? (config.providers as Record<string, unknown>)
      : undefined;
  const nested = providers?.[OPENAI_CASCADE_PROVIDER_ID] ?? providers?.standalone;
  if (typeof nested === "object" && nested !== null && !Array.isArray(nested)) {
    return nested as Record<string, unknown>;
  }
  return config;
}

function asNonNegativeInteger(value: unknown): number | undefined {
  const number = asFiniteNumber(value);
  return number !== undefined && Number.isSafeInteger(number) && number >= 0 ? number : undefined;
}

function asPositiveInteger(value: unknown): number | undefined {
  const number = asFiniteNumber(value);
  return number !== undefined && Number.isSafeInteger(number) && number > 0 ? number : undefined;
}

function normalizeProviderConfig(config: RealtimeVoiceProviderConfig): OpenAICascadeProviderConfig {
  const raw = resolveProviderConfigRecord(config);
  const apiKey = raw.apiKey ?? raw.token;
  return {
    sttBaseUrl: normalizeOptionalString(raw.sttBaseUrl),
    sttApiKey: normalizeResolvedSecretInputString({
      value: raw.sttApiKey ?? apiKey,
      path: "plugins.entries.speech-to-speech.config.sttApiKey",
    }),
    sttModel: normalizeOptionalString(raw.sttModel),
    llmBaseUrl: normalizeOptionalString(raw.llmBaseUrl),
    llmApiKey: normalizeResolvedSecretInputString({
      value: raw.llmApiKey ?? apiKey,
      path: "plugins.entries.speech-to-speech.config.llmApiKey",
    }),
    llmModel: normalizeOptionalString(raw.llmModel),
    ttsBaseUrl: normalizeOptionalString(raw.ttsBaseUrl),
    ttsApiKey: normalizeResolvedSecretInputString({
      value: raw.ttsApiKey ?? apiKey,
      path: "plugins.entries.speech-to-speech.config.ttsApiKey",
    }),
    ttsModel: normalizeOptionalString(raw.ttsModel),
    ttsSampleRateHz: asPositiveInteger(raw.ttsSampleRateHz),
    voice: normalizeOptionalString(raw.speakerVoice ?? raw.voice),
    silenceDurationMs: asNonNegativeInteger(raw.silenceDurationMs),
    requestTimeoutMs: asPositiveInteger(raw.requestTimeoutMs),
  };
}

export function resolveOpenAICompatibleUrl(baseUrl: string, path: string): string {
  let parsed: URL;
  try {
    parsed = new URL(baseUrl);
  } catch (error) {
    throw new Error(
      `Speech to Speech endpoint URL is invalid: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("Speech to Speech endpoints must use http:// or https:// URLs");
  }
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error("Speech to Speech endpoint URLs must not include credentials, query strings, or fragments");
  }
  const hostname = parsed.hostname.toLowerCase().replace(/\.+$/u, "");
  if (hostname === LOOPBACK_HOSTNAME_ALIAS) {
    throw new Error("Speech to Speech endpoint URLs must use 127.0.0.1 instead of a loopback hostname alias");
  }
  if (parsed.protocol === "http:" && !isTrustedPlaintextHost(hostname)) {
    throw new Error("Speech to Speech http:// endpoints must be loopback, private, .local, or .ts.net; use https:// for public hosts");
  }
  parsed.pathname = `${parsed.pathname.replace(/\/+$/u, "")}/${path.replace(/^\/+/, "")}`;
  return parsed.toString();
}

function isTrustedPlaintextHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.+$/u, "");
  return isPrivateOrLoopbackHost(hostname) || normalized.endsWith(".local") || normalized.endsWith(".ts.net");
}

function isPcm16Quiet(audio: Buffer): boolean {
  const samples = Math.floor(audio.length / 2);
  if (samples === 0) {
    return false;
  }
  for (let i = 0; i < samples; i += 1) {
    if (Math.abs(audio.readInt16LE(i * 2)) > SILENCE_SAMPLE_ABS_THRESHOLD) {
      return false;
    }
  }
  return true;
}

function pcm16DurationMs(audio: Buffer): number {
  return Math.round((Math.floor(audio.length / 2) / SAMPLE_RATE_HZ) * 1000);
}

function pcm16Wav(pcm: Buffer): Buffer {
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + pcm.length, 4);
  header.write("WAVEfmt ", 8);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(SAMPLE_RATE_HZ, 24);
  header.writeUInt32LE(SAMPLE_RATE_HZ * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([header, pcm]);
}

function readTextContent(value: unknown): string | undefined {
  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value
    .map((part) => (typeof part === "object" && part !== null ? (part as { text?: unknown }).text : undefined))
    .filter((part): part is string => typeof part === "string")
    .join("")
    .trim() || undefined;
}

async function readResponseBytes(response: Response, maxBytes: number, stage: string): Promise<Uint8Array> {
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
    throw new Error(`Speech to Speech ${stage} response exceeded ${maxBytes} bytes`);
  }
  if (!response.body) {
    return new Uint8Array();
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        throw new Error(`Speech to Speech ${stage} response exceeded ${maxBytes} bytes`);
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return out;
}

async function readJsonResponse(response: Response, stage: string): Promise<unknown> {
  const bytes = await readResponseBytes(response, MAX_JSON_RESPONSE_BYTES, stage);
  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch (error) {
    throw new Error(`Speech to Speech ${stage} response was not valid JSON`, { cause: error });
  }
}

async function errorForResponse(stage: string, response: Response): Promise<Error> {
  const bytes = await readResponseBytes(response, MAX_ERROR_RESPONSE_BYTES, `${stage} error`);
  const detail = new TextDecoder().decode(bytes).replace(/\s+/gu, " ").slice(0, 300);
  return new Error(`Speech to Speech ${stage} request failed (${response.status})${detail ? `: ${detail}` : ""}`);
}

function requestSignal(parent: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const controller = new AbortController();
  const forwardAbort = () => controller.abort(parent?.reason);
  if (parent?.aborted) {
    forwardAbort();
  } else {
    parent?.addEventListener("abort", forwardAbort, { once: true });
  }
  const timer = setTimeout(() => {
    controller.abort(new DOMException("Speech to Speech upstream request timed out", "TimeoutError"));
  }, timeoutMs);
  timer.unref?.();
  return {
    signal: controller.signal,
    cleanup: () => {
      clearTimeout(timer);
      parent?.removeEventListener("abort", forwardAbort);
    },
  };
}

class OpenAICascadeVoiceBridge implements RealtimeVoiceBridge {
  private readonly audioFormat: RealtimeVoiceAudioFormat;
  private connected = false;
  private intentionallyClosed = false;
  private bufferedAudio: Buffer[] = [];
  private bufferedAudioBytes = 0;
  private speechSeen = false;
  private consecutiveSilenceMs = 0;
  private generation = 0;
  private activeAbort: AbortController | undefined;

  constructor(private readonly config: OpenAICascadeBridgeConfig) {
    this.audioFormat = config.audioFormat ?? REALTIME_VOICE_AUDIO_FORMAT_G711_ULAW_8KHZ;
  }

  async connect(): Promise<void> {
    this.intentionallyClosed = false;
    this.connected = true;
    this.config.onReady?.();
  }

  sendAudio(audio: Buffer): void {
    if (!this.connected) {
      return;
    }
    const pcm = this.toInputPcm(audio);
    if (pcm.length === 0) {
      return;
    }
    const quiet = isPcm16Quiet(pcm);
    if (!this.speechSeen && quiet) {
      return;
    }
    if (!this.bufferAudio(pcm)) {
      return;
    }
    if (!quiet) {
      this.speechSeen = true;
      this.consecutiveSilenceMs = 0;
      return;
    }
    this.consecutiveSilenceMs += pcm16DurationMs(pcm);
    if (this.consecutiveSilenceMs >= (this.config.silenceDurationMs ?? DEFAULT_SILENCE_DURATION_MS)) {
      this.commitAudioTurn();
    }
  }

  setMediaTimestamp(_ts: number): void {}

  sendUserMessage(text: string): void {
    const normalized = text.trim();
    if (normalized) {
      void this.respondToText(normalized);
    }
  }

  triggerGreeting(instructions?: string): void {
    this.sendUserMessage(instructions?.trim() || "Greet the person briefly.");
  }

  handleBargeIn(): void {
    this.generation += 1;
    this.activeAbort?.abort();
    this.activeAbort = undefined;
    this.clearInputBuffer();
    this.config.onClearAudio();
    this.config.onEvent?.({ direction: "client", type: "response.cancel", detail: "reason=barge-in" });
  }

  submitToolResult(_callId: string, _result: unknown): void {}

  acknowledgeMark(): void {}

  close(): void {
    this.intentionallyClosed = true;
    this.connected = false;
    this.generation += 1;
    this.activeAbort?.abort();
    this.activeAbort = undefined;
    this.clearInputBuffer();
    this.config.onClose?.("completed");
  }

  isConnected(): boolean {
    return this.connected;
  }

  private toInputPcm(audio: Buffer): Buffer {
    const pcm = this.audioFormat.encoding === "pcm16" ? audio : mulawToPcm(audio);
    return resamplePcm(pcm, this.audioFormat.sampleRateHz, SAMPLE_RATE_HZ);
  }

  private fromOutputPcm(audio: Buffer): Buffer {
    const sourceSampleRateHz = this.config.ttsSampleRateHz ?? DEFAULT_TTS_SAMPLE_RATE_HZ;
    if (this.audioFormat.encoding === "g711_ulaw") {
      return convertPcmToMulaw8k(audio, sourceSampleRateHz);
    }
    return resamplePcm(
      audio,
      sourceSampleRateHz,
      this.audioFormat.sampleRateHz,
    );
  }

  private bufferAudio(audio: Buffer): boolean {
    if (audio.length > MAX_BUFFERED_AUDIO_BYTES - this.bufferedAudioBytes) {
      this.clearInputBuffer();
      this.config.onError?.(
        new Error(`Speech to Speech input audio exceeded ${MAX_BUFFERED_AUDIO_BYTES} bytes`),
      );
      return false;
    }
    this.bufferedAudio.push(audio);
    this.bufferedAudioBytes += audio.length;
    return true;
  }

  private clearInputBuffer(): void {
    this.bufferedAudio = [];
    this.bufferedAudioBytes = 0;
    this.speechSeen = false;
    this.consecutiveSilenceMs = 0;
  }

  private commitAudioTurn(): void {
    const audio = Buffer.concat(this.bufferedAudio);
    this.clearInputBuffer();
    if (audio.length === 0) {
      return;
    }
    this.config.onEvent?.({ direction: "client", type: "input_audio_buffer.commit" });
    void this.transcribeAndRespond(audio);
  }

  private async transcribeAndRespond(audio: Buffer): Promise<void> {
    this.activeAbort?.abort();
    const turn = ++this.generation;
    const controller = new AbortController();
    this.activeAbort = controller;
    try {
      const transcript = await this.transcribe(audio, controller.signal);
      if (!this.isCurrent(turn)) {
        return;
      }
      this.config.onTranscript?.("user", transcript, true);
      this.config.onEvent?.({ direction: "server", type: "conversation.item.input_audio_transcription.completed" });
      if (this.config.autoRespondToAudio !== false) {
        await this.respondToText(transcript, turn, controller.signal);
      }
    } catch (error) {
      this.reportError(error, turn);
    } finally {
      if (this.isCurrent(turn)) {
        this.activeAbort = undefined;
      }
    }
  }

  private async respondToText(text: string, existingTurn?: number, signal?: AbortSignal): Promise<void> {
    if (existingTurn === undefined) {
      this.activeAbort?.abort();
    }
    const turn = existingTurn ?? ++this.generation;
    const controller = signal ? undefined : new AbortController();
    const requestSignal = signal ?? controller?.signal;
    if (controller) {
      this.activeAbort = controller;
    }
    let responseId: string | undefined;
    try {
      const response = await this.complete(text, requestSignal);
      if (!this.isCurrent(turn)) {
        return;
      }
      this.config.onTranscript?.("assistant", response, true);
      responseId = `cascade-${randomUUID()}`;
      this.config.onEvent?.({ direction: "server", type: "response.created", responseId });
      const audio = await this.synthesize(response, requestSignal);
      if (this.isCurrent(turn) && audio.length > 0) {
        this.config.onAudio(this.fromOutputPcm(audio));
      }
      if (this.isCurrent(turn)) {
        this.config.onEvent?.({ direction: "server", type: "response.done", responseId });
      }
    } catch (error) {
      if (responseId && this.isCurrent(turn)) {
        this.config.onEvent?.({
          direction: "server",
          type: "response.done",
          responseId,
          detail: "status=failed",
        });
      }
      this.reportError(error, turn);
    } finally {
      if (this.isCurrent(turn)) {
        this.activeAbort = undefined;
      }
    }
  }

  private async transcribe(audio: Buffer, signal: AbortSignal): Promise<string> {
    const form = new FormData();
    form.set("model", this.config.sttModel);
    form.set("response_format", "json");
    form.set("file", new Blob([Uint8Array.from(pcm16Wav(audio))], { type: "audio/wav" }), "input.wav");
    const request = requestSignal(signal, this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(resolveOpenAICompatibleUrl(this.config.sttBaseUrl, "audio/transcriptions"), {
        method: "POST",
        headers: authHeaders(this.config.sttApiKey),
        body: form,
        signal: request.signal,
        redirect: "error",
      });
      if (!response.ok) {
        throw await errorForResponse("STT", response);
      }
      const body = (await readJsonResponse(response, "STT")) as { text?: unknown };
      const text = typeof body.text === "string" ? body.text.trim() : "";
      if (!text) {
        throw new Error("Speech to Speech STT response did not include text");
      }
      return text;
    } finally {
      request.cleanup();
    }
  }

  private async complete(text: string, signal?: AbortSignal): Promise<string> {
    const messages: Array<{ role: "system" | "user"; content: string }> = [];
    if (this.config.instructions?.trim()) {
      messages.push({ role: "system", content: this.config.instructions.trim() });
    }
    messages.push({ role: "user", content: text });
    const request = requestSignal(signal, this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(resolveOpenAICompatibleUrl(this.config.llmBaseUrl, "chat/completions"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(this.config.llmApiKey) },
        body: JSON.stringify({ model: this.config.llmModel, messages, stream: false }),
        signal: request.signal,
        redirect: "error",
      });
      if (!response.ok) {
        throw await errorForResponse("LLM", response);
      }
      const body = (await readJsonResponse(response, "LLM")) as { choices?: Array<{ message?: { content?: unknown } }> };
      const content = readTextContent(body.choices?.[0]?.message?.content);
      if (!content) {
        throw new Error("Speech to Speech LLM response did not include assistant text");
      }
      return content;
    } finally {
      request.cleanup();
    }
  }

  private async synthesize(text: string, signal?: AbortSignal): Promise<Buffer> {
    const request = requestSignal(signal, this.config.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS);
    try {
      const response = await fetch(resolveOpenAICompatibleUrl(this.config.ttsBaseUrl, "audio/speech"), {
        method: "POST",
        headers: { "Content-Type": "application/json", ...authHeaders(this.config.ttsApiKey) },
        body: JSON.stringify({
          model: this.config.ttsModel,
          input: text,
          voice: this.config.voice ?? "alloy",
          response_format: "pcm",
        }),
        signal: request.signal,
        redirect: "error",
      });
      if (!response.ok) {
        throw await errorForResponse("TTS", response);
      }
      const contentType = response.headers.get("content-type")?.split(";", 1)[0]?.trim().toLowerCase();
      if (contentType && !["application/octet-stream", "audio/l16", "audio/pcm", "audio/raw"].includes(contentType)) {
        throw new Error(`Speech to Speech TTS response was not raw PCM (content-type ${contentType})`);
      }
      const bytes = await readResponseBytes(response, MAX_TTS_RESPONSE_BYTES, "TTS");
      const audio = Buffer.from(bytes);
      if (audio.length === 0 || audio.length % 2 !== 0 || audio.subarray(0, 4).toString("ascii") === "RIFF") {
        throw new Error("Speech to Speech TTS response was not valid raw PCM16 audio");
      }
      return audio;
    } finally {
      request.cleanup();
    }
  }

  private isCurrent(turn: number): boolean {
    return this.connected && !this.intentionallyClosed && turn === this.generation;
  }

  private reportError(error: unknown, turn: number): void {
    if (!this.isCurrent(turn) || (error instanceof Error && error.name === "AbortError")) {
      return;
    }
    this.config.onError?.(error instanceof Error ? error : new Error(String(error)));
  }
}

function authHeaders(apiKey: string | undefined): Record<string, string> {
  return apiKey ? { Authorization: `Bearer ${apiKey}` } : {};
}

export function buildOpenAICascadeVoiceProvider(): RealtimeVoiceProviderPlugin {
  return {
    id: OPENAI_CASCADE_PROVIDER_ID,
    label: OPENAI_CASCADE_LABEL,
    defaultModel: "configured",
    capabilities: {
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
      supportsToolCalls: false,
    },
    resolveConfig: ({ rawConfig }) => normalizeProviderConfig(rawConfig),
    isConfigured: ({ providerConfig }) => {
      const config = normalizeProviderConfig(providerConfig);
      return Boolean(
        config.sttBaseUrl && config.sttModel && config.llmBaseUrl && config.llmModel && config.ttsBaseUrl && config.ttsModel,
      );
    },
    createBridge: (req) => {
      const config = normalizeProviderConfig(req.providerConfig);
      const required = [
        "sttBaseUrl",
        "sttModel",
        "llmBaseUrl",
        "llmModel",
        "ttsBaseUrl",
        "ttsModel",
      ] as const;
      for (const key of required) {
        if (!config[key]) {
          throw new Error(`Speech to Speech OpenAI-compatible provider missing ${key}`);
        }
      }
      resolveOpenAICompatibleUrl(config.sttBaseUrl!, "audio/transcriptions");
      resolveOpenAICompatibleUrl(config.llmBaseUrl!, "chat/completions");
      resolveOpenAICompatibleUrl(config.ttsBaseUrl!, "audio/speech");
      return new OpenAICascadeVoiceBridge({ ...req, ...config } as OpenAICascadeBridgeConfig);
    },
  };
}
