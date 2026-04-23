import type { CostBreakdown } from "./types.js";

export interface Pricing {
  inputPerMillion: number;
  outputPerMillion: number;
}

const PRICING_TABLE: Record<string, Pricing> = {
  "claude-opus-4-7": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-opus-4-6": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-opus-4-5": { inputPerMillion: 15, outputPerMillion: 75 },
  "claude-sonnet-4-6": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-sonnet-4-5": { inputPerMillion: 3, outputPerMillion: 15 },
  "claude-haiku-4-5-20251001": { inputPerMillion: 0.8, outputPerMillion: 4 },
};

export function pricingForModel(model: string): Pricing {
  const exact = PRICING_TABLE[model];
  if (exact) return exact;
  const prefix = Object.keys(PRICING_TABLE).find((m) => model.startsWith(m));
  if (prefix) {
    const prefixed = PRICING_TABLE[prefix];
    if (prefixed) return prefixed;
  }
  if (model.includes("opus")) return { inputPerMillion: 15, outputPerMillion: 75 };
  if (model.includes("sonnet")) return { inputPerMillion: 3, outputPerMillion: 15 };
  if (model.includes("haiku")) return { inputPerMillion: 0.8, outputPerMillion: 4 };
  return { inputPerMillion: 0, outputPerMillion: 0 };
}

export function computeCost(
  inputTokens: number,
  outputTokens: number,
  pricing: Pricing,
): CostBreakdown {
  const inputUsd = (inputTokens / 1_000_000) * pricing.inputPerMillion;
  const outputUsd = (outputTokens / 1_000_000) * pricing.outputPerMillion;
  return {
    inputUsd: round6(inputUsd),
    outputUsd: round6(outputUsd),
    totalUsd: round6(inputUsd + outputUsd),
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
