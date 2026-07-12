// Speech to Speech plugin entrypoint registers the realtime voice provider.
import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { buildAnvilRealtimeVoiceProvider } from "./realtime-voice-provider.js";

export default definePluginEntry({
  id: "speech-to-speech",
  name: "Speech to Speech",
  description: "Realtime speech-to-speech voice provider",
  register(api) {
    api.registerRealtimeVoiceProvider(buildAnvilRealtimeVoiceProvider());
  },
});
