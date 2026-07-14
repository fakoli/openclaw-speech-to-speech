// Speech to Speech tests cover plugin entrypoint registration.
import type { RealtimeVoiceProviderPlugin } from "openclaw/plugin-sdk/realtime-voice";
import { describe, expect, it } from "vitest";
import anvilVoicePlugin from "./index.js";

describe("anvil voice plugin entrypoint", () => {
  it("registers the Anvil realtime voice provider", () => {
    const realtimeProviders: RealtimeVoiceProviderPlugin[] = [];

    // Minimal stub of the plugin api; the entrypoint only calls
    // registerRealtimeVoiceProvider. (openclaw/plugin-sdk/plugin-test-api is
    // not exported from the published package.)
    const api = {
      registerRealtimeVoiceProvider(provider: RealtimeVoiceProviderPlugin) {
        realtimeProviders.push(provider);
      },
    } as unknown as Parameters<typeof anvilVoicePlugin.register>[0];

    anvilVoicePlugin.register(api);

    expect(realtimeProviders.map((provider) => provider.id)).toEqual(["anvil", "openai-cascade"]);
    expect(realtimeProviders[0]?.label).toBe("Speech to Speech");
  });
});
