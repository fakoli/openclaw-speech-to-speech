// Speech to Speech tests cover plugin entrypoint registration.
import type { RealtimeVoiceProviderPlugin } from "openclaw/plugin-sdk/realtime-voice";
import { describe, expect, it } from "vitest";
import speechToSpeechPlugin from "./index.js";

describe("speech-to-speech plugin entrypoint", () => {
  it("registers the Anvil Serving and standalone realtime voice providers", () => {
    const realtimeProviders: RealtimeVoiceProviderPlugin[] = [];

    // Minimal stub of the plugin api; the entrypoint only calls
    // registerRealtimeVoiceProvider. (openclaw/plugin-sdk/plugin-test-api is
    // not exported from the published package.)
    const api = {
      registerRealtimeVoiceProvider(provider: RealtimeVoiceProviderPlugin) {
        realtimeProviders.push(provider);
      },
    } as unknown as Parameters<typeof speechToSpeechPlugin.register>[0];

    speechToSpeechPlugin.register(api);

    expect(realtimeProviders.map((provider) => provider.id)).toEqual(["anvil-serving", "openai-cascade"]);
    expect(realtimeProviders[0]?.label).toBe("Anvil Serving Realtime");
    expect(realtimeProviders[0]?.aliases).toContain("anvil");
    expect(realtimeProviders[1]?.label).toBe("OpenAI-Compatible Cascade");
  });
});
