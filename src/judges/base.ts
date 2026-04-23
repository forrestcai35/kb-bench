export type JudgeFamily = "anthropic" | "openai" | "google";

export interface JudgeBackend {
  readonly id: string;
  readonly family: JudgeFamily;
  readonly model: string;
  readonly available: boolean;
  readonly unavailableReason?: string;
  score(systemPrompt: string, userPrompt: string): Promise<string>;
}

export const SHARED_JUDGE_SYSTEM = `You are an impartial evaluator scoring a candidate answer to an operational question against a known-correct reference answer. You will be given the question, the reference answer, and the candidate answer. You do NOT know which system produced the candidate answer, and you must not speculate about it.

Score correctness from 0 to 5:

0 — wrong, hallucinated, or missing
1 — mostly wrong
2 — partially correct but misses key facts
3 — roughly correct, some details off
4 — correct, minor omissions
5 — fully correct and complete

Rules for scoring:
- Score only on factual correctness vs the reference. Style, verbosity, and phrasing do not matter.
- Do not penalize the candidate for using different wording if the facts match.
- Do not reward answers that add plausible-sounding but unverifiable extra details.
- If the candidate answer admits it could not find the information, score 0.

Return STRICT JSON only: {"score": <0-5>, "reasoning": "<one sentence>"}`;

export function familyOfModel(model: string): JudgeFamily | null {
  if (/^claude/i.test(model)) return "anthropic";
  if (/^gpt|^o\d|^chatgpt/i.test(model)) return "openai";
  if (/^gemini/i.test(model)) return "google";
  return null;
}

export function parseScore(text: string): { score: number; reasoning: string } {
  try {
    const match = text.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(match ? match[0] : text) as { score: unknown; reasoning: unknown };
    const score = Number(parsed.score);
    if (!Number.isFinite(score)) throw new Error("score not a number");
    return {
      score: Math.max(0, Math.min(5, score)),
      reasoning: String(parsed.reasoning ?? ""),
    };
  } catch {
    return { score: 0, reasoning: `Unparsable judge output: ${text.slice(0, 200)}` };
  }
}
