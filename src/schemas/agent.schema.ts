import { z } from "zod";

export const AgentSchema = z.object({
  name: z.string().min(1),
  role: z.string().min(1),
  instructions: z.string().min(1),
});

export const AgentActionSchema = z
  .preprocess(
    (value) => (typeof value === "string" ? value.toUpperCase() : value),
    z.enum(["REFINE", "RENAME", "PROMPT"]),
  )
  .optional();

export const AgentRunRequestSchema = z.object({
  query: z.string().min(1),
  action: AgentActionSchema,
});

export type AgentDefinition = z.infer<typeof AgentSchema>;
export type AgentRunRequest = z.infer<typeof AgentRunRequestSchema>;

