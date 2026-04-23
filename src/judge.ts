import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, type Config } from "./config.js";
import { withRetry } from "./retry.js";
import type { BenchmarkQuery, JudgeVerdict, QueryMetrics } from "./types.js";

const JUDGE_SYSTEM = `You are an impartial evaluator scoring a candidate answer to an operational question against a known-correct reference answer. You will be given the question, the reference answer, and the candidate answer. You do NOT know which system produced the candidate answer, and you must not speculate about it.

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

const PLATFORM_NAME_BLACKLIST = [
  "lore",
  "notion",
  "confluence",
  "obsidian",
  "atlassian",
  "knowledge base",
  "local rest api",
  "vault",
  "wiki",
];

export class Judge {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly retries: number;

  constructor(config: Config) {
    this.client = createAnthropicClient(config);
    this.model = config.judgeModel;
    this.retries = config.retries;
  }

  async score(query: BenchmarkQuery, result: QueryMetrics): Promise<JudgeVerdict> {
    if (result.error || !result.answer) {
      return {
        queryId: query.id,
        platform: result.platform,
        run: result.run,
        score: 0,
        reasoning: result.error ?? "No answer produced",
      };
    }

    const sanitized = sanitizeAnswer(result.answer);
    const prompt = `Question: ${query.question}

Reference answer: ${query.goldAnswer}

Candidate answer: ${sanitized}

Score the candidate answer. Return JSON only.`;

    const response = await withRetry(
      `judge ${query.id} ${result.platform}`,
      () =>
        this.client.messages.create({
          model: this.model,
          max_tokens: 300,
          system: JUDGE_SYSTEM,
          messages: [{ role: "user", content: prompt }],
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
        }),
      { retries: this.retries },
    );

    const text = response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

    let parsed: { score: number; reasoning: string };
    try {
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      parsed = JSON.parse(jsonMatch ? jsonMatch[0] : text) as { score: number; reasoning: string };
    } catch {
      parsed = { score: 0, reasoning: `Judge returned unparsable output: ${text.slice(0, 200)}` };
    }

    return {
      queryId: query.id,
      platform: result.platform,
      run: result.run,
      score: Math.max(0, Math.min(5, Number(parsed.score) || 0)),
      reasoning: String(parsed.reasoning ?? ""),
    };
  }
}

export function sanitizeAnswer(answer: string): string {
  let cleaned = answer;
  for (const term of PLATFORM_NAME_BLACKLIST) {
    const pattern = new RegExp(`\\b${escapeRegex(term)}\\b`, "gi");
    cleaned = cleaned.replace(pattern, "[KB]");
  }
  return cleaned;
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
