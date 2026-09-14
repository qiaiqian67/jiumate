/**
 * ASR provider registry — closed enum → instance mapping.
 *
 * Same shape as `companion-tts/registry.ts`. Adding a new ASR engine (AWS
 * Transcribe, OpenAI Whisper, local Whisper.cpp) is an enum extension on
 * server + web, plus an entry here.
 */
import type { CompanionAsrProvider as AsrProviderId } from "../companion-store";
import type { CompanionAsrProvider } from "./provider";
import { WebSpeechAsrProvider } from "./webspeech";

export function createAsrProvider(id: AsrProviderId): CompanionAsrProvider | null {
  switch (id) {
    case "webspeech":
      return new WebSpeechAsrProvider();
    case "off":
      return null;
  }
}
