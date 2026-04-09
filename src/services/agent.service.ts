import { env } from "../config/env";
import { actionToFeature, MODEL_ID, ai, buildGeminiConfig } from "./gemini.service";
import type { AgentDefinition } from "../schemas/agent.schema";
import { accessSync, constants, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { randomUUID } from "node:crypto";
type ModelProvider = "GOOGLE" | "HUGGINGFACE" | "GROK";
const DEFAULT_PROVIDER: ModelProvider = "GOOGLE";
const DEFAULT_TEXT_MODEL = MODEL_ID;
const DEFAULT_IMAGE_MODEL = "gemini-3.1-flash-image-preview";
const HF_IMAGE_MODEL = "Tongyi-MAI/Z-Image-Turbo";
let googleModelsCache: { names: Set<string>; fetchedAt: number } | null = null;

export type SharedMemory = {
  query: string;
  action?: "REFINE" | "RENAME" | "PROMPT";
  modelProvider: ModelProvider;
  modelName: string;
  logs: string[];
  artifacts: Record<string, { output: string; round: number; role: string }>;
  imagePaths: string[];
};

type UsageStats = {
  googleCalls: number;
  googleCallsWithoutSearchTool: number;
  huggingFaceCalls: number;
  imageCalls: number;
  googleImageCalls: number;
  huggingFaceImageCalls: number;
  modelValidationCalls: number;
};

export const defaultAgents: AgentDefinition[] = [
  {
    name: "ba-agent",
    role: "business-analyst",
    instructions:
      "Refine the raw query into clear requirements, acceptance criteria, and output expectations for all agents.",
  },
  {
    name: "search-agent",
    role: "search",
    instructions:
      "Research latest and strongest approach using internet-enabled grounding and summarize concrete steps.",
  },
  {
    name: "security-agent",
    role: "security",
    instructions: "Audit all outputs for security, privacy, abuse, and compliance risks with fixes.",
  },
  {
    name: "critic-agent",
    role: "critic",
    instructions: "Challenge weak reasoning, find gaps, and demand measurable quality improvements.",
  },
  {
    name: "tracker-agent",
    role: "logger",
    instructions:
      "Track which agent is doing what, and produce concise progress logs with status.",
  },
  {
    name: "refiner-agent",
    role: "refiner",
    instructions: "Synthesize all outputs into one accurate final result packet for the user.",
  },
];

function addLog(memory: SharedMemory, message: string, log: (message: string) => void) {
  memory.logs.push(message);
  log(message);
}

function extractJson<T>(raw: string): T | null {
  const cleaned = raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "");
  try {
    return JSON.parse(cleaned) as T;
  } catch {
    return null;
  }
}

async function askModel(prompt: string, model = MODEL_ID) {
  try {
    const response = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
        tools: [{ googleSearch: {} }],
      },
    });
    return response.text ?? "";
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    // Some Google models do not support Search as tool. Retry cleanly without tools.
    if (!message.includes("Search as tool is not enabled")) {
      throw error;
    }

    const fallback = await ai.models.generateContent({
      model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: {
        temperature: 0.2,
      },
    });
    return fallback.text ?? "";
  }
}

async function askHuggingFace(prompt: string, model: string) {
  if (!env.HUGGINGFACE_API_KEY) {
    throw new Error("HUGGINGFACE_API_KEY is required for HuggingFace provider.");
  }

  const response = await fetch(`https://api-inference.huggingface.co/models/${model}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: { max_new_tokens: 1200, temperature: 0.2, return_full_text: false },
    }),
  });

  if (!response.ok) {
    throw new Error(`HuggingFace request failed with status ${response.status}`);
  }

  const data = (await response.json()) as Array<{ generated_text?: string }> | { generated_text?: string };
  if (Array.isArray(data)) return data[0]?.generated_text ?? "";
  return data.generated_text ?? "";
}

async function fetchGoogleModels(): Promise<Set<string>> {
  const now = Date.now();
  if (googleModelsCache && now - googleModelsCache.fetchedAt < 10 * 60 * 1000) {
    return googleModelsCache.names;
  }

  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(env.GEMINI_API_KEY)}`,
  );
  if (!response.ok) {
    throw new Error(`Failed to list Google models: ${response.status}`);
  }

  const payload = (await response.json()) as { models?: Array<{ name?: string }> };
  const names = new Set(
    (payload.models ?? [])
      .map((item) => item.name ?? "")
      .filter(Boolean)
      .map((name) => name.replace(/^models\//, "")),
  );

  googleModelsCache = { names, fetchedAt: now };
  return names;
}

async function validateModelAvailability(provider: ModelProvider, modelName: string): Promise<boolean> {
  if (provider === "GOOGLE") {
    const models = await fetchGoogleModels();
    return models.has(modelName);
  }

  if (provider === "HUGGINGFACE") {
    const response = await fetch(`https://huggingface.co/api/models/${encodeURIComponent(modelName)}`);
    return response.ok;
  }

  return false;
}

async function resolveCtoModelSelection(
  plan: { selectedModelProvider?: ModelProvider; selectedModelName?: string },
  log: (message: string) => void,
): Promise<{ provider: ModelProvider; modelName: string }> {
  const provider = plan.selectedModelProvider ?? DEFAULT_PROVIDER;
  const candidate =
    plan.selectedModelName ??
    (provider === "HUGGINGFACE" ? "mistralai/Mistral-7B-Instruct-v0.2" : DEFAULT_TEXT_MODEL);

  try {
    const valid = await validateModelAvailability(provider, candidate);
    if (valid) {
      return { provider, modelName: candidate };
    }
    log(`[cto] rejected invalid model ${provider}/${candidate}, using default.`);
  } catch (error) {
    log(`[cto] model validation failed: ${error instanceof Error ? error.message : "unknown error"}`);
  }

  return { provider: DEFAULT_PROVIDER, modelName: DEFAULT_TEXT_MODEL };
}

async function askModelWithProvider(
  prompt: string,
  provider: ModelProvider,
  modelName: string,
): Promise<string> {
  if (provider === "HUGGINGFACE") {
    return askHuggingFace(prompt, modelName);
  }
  if (provider === "GROK") {
    // Placeholder for future XAI integration, fallback for now.
    return askModel(prompt, MODEL_ID);
  }
  return askModel(prompt, modelName);
}

async function ctoPlan(memory: SharedMemory): Promise<{
  maxRounds: number;
  shouldGenerateImage: boolean;
  suggestedAction?: "REFINE" | "RENAME" | "PROMPT";
  selectedModelProvider?: ModelProvider;
  selectedModelName?: string;
  additionalAgents: AgentDefinition[];
  strategy: string;
}> {
  const prompt = [
    "You are a CTO manager agent.",
    "Given user query and optional action, estimate complexity and plan the multi-agent execution.",
    "Return ONLY JSON with keys: maxRounds (1-8), shouldGenerateImage (boolean), suggestedAction (REFINE|RENAME|PROMPT), selectedModelProvider (GOOGLE|HUGGINGFACE|GROK), selectedModelName (string), strategy (string), additionalAgents (array of {name,role,instructions}).",
    `Memory: ${JSON.stringify(memory, null, 2)}`,
  ].join("\n");
  const raw = await askModel(prompt);
  const parsed = extractJson<{
    maxRounds?: number;
    shouldGenerateImage?: boolean;
    suggestedAction?: "REFINE" | "RENAME" | "PROMPT";
    selectedModelProvider?: ModelProvider;
    selectedModelName?: string;
    strategy?: string;
    additionalAgents?: AgentDefinition[];
  }>(raw);
  return {
    maxRounds: Math.min(8, Math.max(1, parsed?.maxRounds ?? 3)),
    shouldGenerateImage: parsed?.shouldGenerateImage ?? maybeImageIntent(memory),
    suggestedAction: parsed?.suggestedAction,
    selectedModelProvider: parsed?.selectedModelProvider,
    selectedModelName: parsed?.selectedModelName,
    strategy: parsed?.strategy ?? "Iterative improve until CTO acceptance.",
    additionalAgents: parsed?.additionalAgents?.filter((item) => item.name && item.role && item.instructions) ?? [],
  };
}

function generatePublicImageUrl(filePath: string, baseUrl: string) {
  return `${baseUrl}/assets/generated-images/${basename(filePath)}`;
}

async function runAgentStep(
  agent: AgentDefinition,
  memory: SharedMemory,
  round: number,
  usage: UsageStats,
): Promise<{ output: string; imagePath?: string; imageUrl?: string }> {
  const prompt = [
    "You are part of a coordinated multi-agent execution.",
    `Agent: ${agent.name} (${agent.role})`,
    `Instructions: ${agent.instructions}`,
    `Round: ${round}`,
    "Use latest internet context when helpful and provide concise actionable output.",
    `Model provider: ${memory.modelProvider}`,
    `Model name: ${memory.modelName}`,
    "Shared memory JSON:",
    JSON.stringify(memory, null, 2),
  ].join("\n");
  if (memory.modelProvider === "GOOGLE") usage.googleCalls += 1;
  if (memory.modelProvider === "HUGGINGFACE") usage.huggingFaceCalls += 1;
  const output = await askModelWithProvider(prompt, memory.modelProvider, memory.modelName);
  return { output };
}

async function ctoReview(memory: SharedMemory, round: number): Promise<{ satisfied: boolean; feedback: string }> {
  const prompt = [
    "You are CTO reviewer.",
    "Decide if outputs are production-ready for the user query.",
    "Return ONLY JSON with keys: satisfied (boolean), feedback (string).",
    `Round: ${round}`,
    `Memory: ${JSON.stringify(memory, null, 2)}`,
  ].join("\n");
  const raw = await askModel(prompt);
  const parsed = extractJson<{ satisfied?: boolean; feedback?: string }>(raw);
  return {
    satisfied: parsed?.satisfied ?? false,
    feedback: parsed?.feedback ?? "Improve completeness and precision.",
  };
}

function maybeImageIntent(memory: SharedMemory) {
  return /\b(image|poster|logo|icon|generate image|illustration)\b/i.test(memory.query);
}

function resolveWritableImageDir(): string {
  const candidates = [
    env.GENERATED_IMAGES_DIR,
    join(process.cwd(), "generated-images"),
    join(process.cwd(), ".cache", "generated-images"),
    join(tmpdir(), "code-polish-generated-images"),
  ];

  for (const candidate of candidates) {
    try {
      mkdirSync(candidate, { recursive: true });
      accessSync(candidate, constants.W_OK);
      return candidate;
    } catch {
      // Try next candidate directory.
    }
  }

  throw new Error("No writable directory available for generated images.");
}

async function generateImageFile(query: string, usage: UsageStats): Promise<string> {
  const imageDir = resolveWritableImageDir();
  const fileName = `img-${Date.now()}-${randomUUID().slice(0, 8)}.png`;
  const filePath = join(imageDir, fileName);

  const prompt = [
    "Generate a high-quality image for this request.",
    `User query: ${query}`,
    "Style: realistic, detailed, safe content.",
  ].join("\n");

  const isSimplePrompt = query.trim().split(/\s+/).length <= 10;
  const shouldUseGoogle = isSimplePrompt || !env.HUGGINGFACE_API_KEY;

  usage.imageCalls += 1;
  if (shouldUseGoogle) {
    usage.googleImageCalls += 1;
    const response = await ai.models.generateContent({
      model: DEFAULT_IMAGE_MODEL,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
    });

    const imageBase64 = response.candidates?.[0]?.content?.parts?.find((part) => part.inlineData)?.inlineData
      ?.data;
    if (!imageBase64) {
      throw new Error("Google image model did not return image data.");
    }

    writeFileSync(filePath, Buffer.from(imageBase64, "base64"));
    return filePath;
  }

  usage.huggingFaceImageCalls += 1;
  const hfResponse = await fetch(`https://api-inference.huggingface.co/models/${HF_IMAGE_MODEL}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${env.HUGGINGFACE_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      inputs: prompt,
      parameters: {
        width: 1024,
        height: 1024,
      },
    }),
  });

  if (!hfResponse.ok) {
    throw new Error(`Hugging Face image generation failed with status ${hfResponse.status}`);
  }

  const contentType = hfResponse.headers.get("content-type") ?? "";
  if (!contentType.includes("image")) {
    throw new Error("Hugging Face image generation did not return image content.");
  }

  const imageBuffer = Buffer.from(await hfResponse.arrayBuffer());
  writeFileSync(filePath, imageBuffer);
  return filePath;
}

function getLatestArtifactOutputByRole(
  artifacts: SharedMemory["artifacts"],
  role: string,
): string | null {
  const entries = Object.values(artifacts).filter((item) => item.role === role);
  if (entries.length === 0) return null;
  const latest = entries.sort((a, b) => b.round - a.round)[0];
  return latest?.output ?? null;
}

function buildFinalImagePrompt(memory: SharedMemory): string {
  const refined = getLatestArtifactOutputByRole(memory.artifacts, "refiner");
  const ba = getLatestArtifactOutputByRole(memory.artifacts, "business-analyst");

  return [
    "Create one final high-quality image from this refined context.",
    `Original query: ${memory.query}`,
    ba ? `Business analysis summary:\n${ba}` : "",
    refined ? `Refined output guidance:\n${refined}` : "",
    "Output target: accurate to user intent, clean composition, safe rendering.",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function runMultiAgentWorkflow(
  query: string,
  action: "REFINE" | "RENAME" | "PROMPT" | undefined,
  baseUrl: string,
  log: (message: string) => void,
) {
  const usage: UsageStats = {
    googleCalls: 0,
    googleCallsWithoutSearchTool: 0,
    huggingFaceCalls: 0,
    imageCalls: 0,
    googleImageCalls: 0,
    huggingFaceImageCalls: 0,
    modelValidationCalls: 0,
  };

  const sharedMemory: SharedMemory = {
    query,
    action,
    modelProvider: DEFAULT_PROVIDER,
    modelName: DEFAULT_TEXT_MODEL,
    logs: [],
    artifacts: {},
    imagePaths: [],
  };

  const plan = await ctoPlan(sharedMemory);
  usage.modelValidationCalls += 1;
  const selection = await resolveCtoModelSelection(plan, log);
  sharedMemory.modelProvider = selection.provider;
  sharedMemory.modelName = selection.modelName;

  const dynamicAgents = [
    ...defaultAgents,
    ...plan.additionalAgents.slice(0, env.MAX_DYNAMIC_AGENTS),
  ];
  const rounds = Math.min(plan.maxRounds, env.MAX_ROUNDS_PER_REQUEST);
  const resolvedAction = action ?? plan.suggestedAction;

  addLog(sharedMemory, `[cto] strategy: ${plan.strategy}`, log);
  addLog(sharedMemory, `[cto] agents: ${dynamicAgents.map((a) => a.name).join(", ")}`, log);
  addLog(
    sharedMemory,
    `[cto] model: ${sharedMemory.modelProvider}/${sharedMemory.modelName}`,
    log,
  );

  let ctoSatisfied = false;
  let ctoFeedback = "";

  for (let round = 1; round <= rounds; round += 1) {
    const snapshot: SharedMemory = JSON.parse(JSON.stringify(sharedMemory)) as SharedMemory;
    const outputs = await Promise.all(
      dynamicAgents.map(async (agent) => {
        if (
          sharedMemory.modelProvider === "GOOGLE" &&
          usage.googleCalls >= env.MAX_GOOGLE_CALLS_PER_REQUEST
        ) {
          return {
            agent,
            result: { output: "Skipped: request model budget reached before this agent." },
          };
        }
        const result = await runAgentStep(agent, snapshot, round, usage);
        return { agent, result };
      }),
    );

    for (const { agent, result } of outputs) {
      sharedMemory.artifacts[`${agent.name}:round-${round}`] = {
        output: result.output,
        round,
        role: agent.role,
      };
      if (result.imagePath) {
        sharedMemory.imagePaths.push(result.imagePath);
      }
      addLog(sharedMemory, `[round ${round}] ${agent.name} (${agent.role}) completed`, log);
    }

    const review = await ctoReview(sharedMemory, round);
    ctoFeedback = review.feedback;
    addLog(sharedMemory, `[cto-review][round ${round}] ${review.feedback}`, log);
    if (review.satisfied || round === rounds) {
      ctoSatisfied = review.satisfied;
      break;
    }
  }

  if (usage.googleCalls >= env.MAX_GOOGLE_CALLS_PER_REQUEST) {
    addLog(
      sharedMemory,
      `[budget] google call limit reached (${env.MAX_GOOGLE_CALLS_PER_REQUEST}), stopping further model work.`,
      log,
    );
  }

  if (plan.shouldGenerateImage && maybeImageIntent(sharedMemory)) {
    if (usage.imageCalls >= env.MAX_IMAGE_CALLS_PER_REQUEST) {
      addLog(
        sharedMemory,
        `[budget] image call limit reached (${env.MAX_IMAGE_CALLS_PER_REQUEST}), skipped image generation.`,
        log,
      );
    } else {
      const imagePrompt = buildFinalImagePrompt(sharedMemory);
      const imagePath = await generateImageFile(imagePrompt, usage);
      sharedMemory.imagePaths.push(imagePath);
      addLog(sharedMemory, `[image] generated once after discussion: ${imagePath}`, log);
    }
  }

  const feature = actionToFeature(resolvedAction);
  const finalPrompt = [
    "You are final CTO refiner. Build production-ready final response for user.",
    `User query: ${sharedMemory.query}`,
    `Action mode: ${feature}`,
    `CTO satisfied: ${ctoSatisfied}`,
    `CTO feedback: ${ctoFeedback}`,
    "Artifacts JSON:",
    JSON.stringify(sharedMemory.artifacts, null, 2),
    "Return strict JSON keys: summary, finalAnswer, implementationNotes, risks.",
  ].join("\n");
  const finalModel = sharedMemory.modelProvider === "GOOGLE" ? sharedMemory.modelName : MODEL_ID;
  const finalConfig = buildGeminiConfig(feature);

  let finalResult;
  if (
    sharedMemory.modelProvider === "GOOGLE" &&
    usage.googleCalls >= env.MAX_GOOGLE_CALLS_PER_REQUEST
  ) {
    finalResult = {
      text: JSON.stringify({
        summary: "Request hit configured model budget.",
        finalAnswer: "Result generation stopped to prevent excess cost.",
        implementationNotes: "Increase MAX_GOOGLE_CALLS_PER_REQUEST for higher tiers.",
        risks: "Output may be incomplete due to budget limit.",
      }),
    };
  } else {
    try {
      if (sharedMemory.modelProvider === "GOOGLE") usage.googleCalls += 1;
      finalResult = await ai.models.generateContent({
        model: finalModel,
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        config: finalConfig,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (!message.includes("Search as tool is not enabled")) {
        throw error;
      }

      addLog(sharedMemory, `[cto] final response retried without Search tool for model ${finalModel}`, log);
      usage.googleCallsWithoutSearchTool += 1;
      finalResult = await ai.models.generateContent({
        model: finalModel,
        contents: [{ role: "user", parts: [{ text: finalPrompt }] }],
        config: {
          ...finalConfig,
          tools: undefined,
        },
      });
    }
  }

  const defaultAgentNames = new Set(defaultAgents.map((agent) => agent.name));
  const dynamicAgentList = dynamicAgents.filter((agent) => !defaultAgentNames.has(agent.name));

  return {
    query: sharedMemory.query,
    action: resolvedAction ?? null,
    ctoSatisfied,
    ctoFeedback,
    agentsUsed: dynamicAgents,
    defaultAgents,
    dynamicAgents: dynamicAgentList,
    logs: sharedMemory.logs,
    artifacts: sharedMemory.artifacts,
    imagePaths: sharedMemory.imagePaths,
    imageUrls: sharedMemory.imagePaths.map((item) => generatePublicImageUrl(item, baseUrl)),
    usage,
    finalResult: finalResult.text ?? "",
  };
}

