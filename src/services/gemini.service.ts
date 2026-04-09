import { GoogleGenAI } from "@google/genai";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { env } from "../config/env";
import { FEATURES, type Feature } from "../data/features";

const promptCache = new Map<Feature, string>();

export const ai = new GoogleGenAI({ apiKey: env.GEMINI_API_KEY });
export const MODEL_ID = "gemini-2.5-flash";

function promptPath(mode: Feature) {
  return join(process.cwd(), env.PROMPTS_DIR, `${mode.toLowerCase()}.txt`);
}

export function getPrompt(mode: Feature): string {
  const cached = promptCache.get(mode);
  if (cached) return cached;

  const promptText = readFileSync(promptPath(mode), "utf8");
  promptCache.set(mode, promptText);
  return promptText;
}

export function buildGeminiConfig(mode: Feature) {
  return {
    systemInstruction: getPrompt(mode),
    temperature: 0.3,
    maxOutputTokens: 8192,
    tools: [{ googleSearch: {} }],
  };
}

export interface GeminiRefineResponse {
  result: string;
  description: string;
  confidence: number;
}

export function parseGeminiResponse(raw: string): GeminiRefineResponse {
  try {
    const cleaned = raw
      .replace(/^```json\s*/i, "")
      .replace(/^```\s*/i, "")
      .replace(/\s*```$/i, "")
      .trim();

    const parsed = JSON.parse(cleaned) as Partial<GeminiRefineResponse>;
    return {
      result: parsed.result ?? raw,
      description: parsed.description ?? "Code was processed successfully.",
      confidence: Math.min(100, Math.max(0, parsed.confidence ?? 70)),
    };
  } catch {
    return {
      result: raw,
      description: "Code was processed successfully.",
      confidence: 30,
    };
  }
}

export function actionToFeature(action?: string): Feature {
  const upper = action?.toUpperCase();
  if (upper === FEATURES.RENAME) return FEATURES.RENAME;
  if (upper === FEATURES.PROMPT) return FEATURES.PROMPT;
  return FEATURES.REFINE;
}

