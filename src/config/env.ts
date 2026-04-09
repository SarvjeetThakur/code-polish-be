import { z } from "zod";

const EnvSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  HOST: z.string().default("0.0.0.0"),
  PORT: z.coerce.number().int().positive().default(3000),
  ACCESS_PASSWORD: z.string().min(1, "ACCESS_PASSWORD is required"),
  NEXT_PUBLIC_SESSION_EXPIRE_S: z.coerce.number().int().positive().default(600),
  GEMINI_API_KEY: z.string().min(1, "GEMINI_API_KEY is required"),
  HUGGINGFACE_API_KEY: z.string().optional(),
  PROMPTS_DIR: z.string().default("../code-polish/lib/prompts"),
  GENERATED_IMAGES_DIR: z.string().default("./src/assets/generated-images"),
  MAX_ROUNDS_PER_REQUEST: z.coerce.number().int().positive().default(2),
  MAX_DYNAMIC_AGENTS: z.coerce.number().int().min(0).default(4),
  MAX_GOOGLE_CALLS_PER_REQUEST: z.coerce.number().int().positive().default(12),
  MAX_IMAGE_CALLS_PER_REQUEST: z.coerce.number().int().positive().default(1),
});

const parsed = EnvSchema.safeParse(process.env);

if (!parsed.success) {
  throw new Error(`Invalid environment configuration: ${parsed.error.message}`);
}

export const env = parsed.data;

