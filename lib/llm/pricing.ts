/**
 * Model list prices in USD per million tokens, for cost estimates in the
 * traces log and the eval report. Estimates only: they ignore OpenAI's
 * cached-input discount, so real charges come in a little lower.
 */
export const MODEL_PRICES_PER_M: Record<string, { input: number; output: number }> = {
  "gpt-4o-mini": { input: 0.15, output: 0.6 },
};

/** Estimated USD cost of one model call or turn; 0 for a model with no listed price. */
export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const price = MODEL_PRICES_PER_M[model];
  if (!price) return 0;
  return (promptTokens * price.input + completionTokens * price.output) / 1_000_000;
}
