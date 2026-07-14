// Speech to Speech plugin entrypoint registers the realtime voice provider.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildOpenAICascadeVoiceProvider } from "./openai-cascade-voice-provider.js";
import { buildAnvilRealtimeVoiceProvider } from "./realtime-voice-provider.js";

export default definePluginEntry({
  id: "speech-to-speech",
  name: "Speech to Speech",
  description: "Realtime speech-to-speech using Anvil Serving or OpenAI-compatible endpoints",
  register(api) {
    api.registerRealtimeVoiceProvider(buildAnvilRealtimeVoiceProvider());
    api.registerRealtimeVoiceProvider(buildOpenAICascadeVoiceProvider());
  },
});
