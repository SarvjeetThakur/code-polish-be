import type { Feature } from "../data/features";
import {
  MODEL_ID,
  ai,
  buildGeminiConfig,
  parseGeminiResponse,
  type GeminiRefineResponse,
} from "./gemini.service";

export async function runRefineFlow(payload: {
  code: string;
  mode: Feature;
  context?: string;
}): Promise<GeminiRefineResponse> {
  const chat = ai.chats.create({
    model: MODEL_ID,
    config: buildGeminiConfig(payload.mode),
  });

  const initialPrompt = payload.context
    ? `Context: ${payload.context}\n\nCode:\n${payload.code}`
    : `Code:\n${payload.code}`;

  let accumulatedText = "";
  let currentPrompt = initialPrompt;
  let done = false;

  while (!done) {
    const response = await chat.sendMessage({ message: currentPrompt });
    accumulatedText += response.text ?? "";
    const finishReason = response.candidates?.[0]?.finishReason;

    if (finishReason === "MAX_TOKENS") {
      currentPrompt =
        "Continue exactly where you left off. Do not repeat any prior text, only provide the continuation.";
      continue;
    }

    done = true;
  }

  return parseGeminiResponse(accumulatedText);
}

