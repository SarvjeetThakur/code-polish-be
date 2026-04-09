export const FEATURES = {
  REFINE: "REFINE",
  RENAME: "RENAME",
  PROMPT: "PROMPT",
} as const;

export type Feature = (typeof FEATURES)[keyof typeof FEATURES];

export function normalizeFeature(input?: string): Feature | null {
  if (!input) return null;
  const normalized = input.trim().toUpperCase();
  if (normalized === FEATURES.REFINE) return FEATURES.REFINE;
  if (normalized === FEATURES.RENAME) return FEATURES.RENAME;
  if (normalized === FEATURES.PROMPT) return FEATURES.PROMPT;
  return null;
}

