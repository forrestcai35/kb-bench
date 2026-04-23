import type { Config } from "./config.js";
import { AnthropicJudge } from "./judges/anthropic.js";
import { OpenAIJudge } from "./judges/openai.js";
import { GoogleJudge } from "./judges/google.js";
import {
  SHARED_JUDGE_SYSTEM,
  familyOfModel,
  parseScore,
  type JudgeBackend,
  type JudgeFamily,
} from "./judges/base.js";
import type { BenchmarkQuery, JudgeScore, JudgeVerdict, QueryMetrics } from "./types.js";

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
  private readonly backends: JudgeBackend[];
  private readonly excludeSameFamily: boolean;
  private readonly candidateFamily: JudgeFamily | null;

  constructor(config: Config) {
    this.excludeSameFamily = config.excludeSameFamilyJudge;
    this.candidateFamily = familyOfModel(config.model);

    const backends: JudgeBackend[] = [];
    for (const model of config.judgeModels) {
      const family = familyOfModel(model);
      if (!family) {
        console.warn(`[judge] Skipping unknown judge family for model: ${model}`);
        continue;
      }
      let backend: JudgeBackend;
      switch (family) {
        case "anthropic":
          backend = new AnthropicJudge(config, model);
          break;
        case "openai":
          backend = new OpenAIJudge(config, model);
          break;
        case "google":
          backend = new GoogleJudge(config, model);
          break;
      }
      if (!backend.available) {
        console.warn(`[judge] ${backend.id} unavailable: ${backend.unavailableReason}`);
        continue;
      }
      backends.push(backend);
    }

    if (backends.length === 0) {
      throw new Error(
        "No judge backends available. Provide credentials for at least one of: Anthropic (ANTHROPIC_AUTH_TOKEN / ANTHROPIC_API_KEY), OpenAI/OpenRouter (OPENAI_API_KEY / OPENROUTER_API_KEY), Google Gemini (GOOGLE_API_KEY / GEMINI_API_KEY / FREE_GEMINI_API_KEY_N). Current judge panel: " +
          config.judgeModels.join(", "),
      );
    }

    this.backends = backends;
    const families = new Set(backends.map((b) => b.family));
    if (backends.length === 1) {
      console.warn(
        `[judge] Running with a single-judge panel (${backends[0]!.id}). A public benchmark should use >=3 judges from different families.`,
      );
    } else if (families.size === 1) {
      console.warn(
        `[judge] All judges come from the same family (${[...families].join(", ")}). Consider adding cross-family judges for fairness.`,
      );
    }
  }

  get panel(): JudgeBackend[] {
    return this.backends;
  }

  async score(query: BenchmarkQuery, result: QueryMetrics): Promise<JudgeVerdict> {
    if (result.error || !result.answer) {
      const reason = result.error ?? "No answer produced";
      return {
        queryId: query.id,
        platform: result.platform,
        run: result.run,
        score: 0,
        meanScore: 0,
        medianScore: 0,
        stddev: 0,
        reasoning: reason,
        perJudge: this.backends.map((b) => ({
          judgeId: b.id,
          model: b.model,
          family: b.family,
          score: 0,
          reasoning: reason,
          error: result.error,
        })),
      };
    }

    const sanitized = sanitizeAnswer(result.answer);
    const userPrompt = `Question: ${query.question}

Reference answer: ${query.goldAnswer}

Candidate answer: ${sanitized}

Score the candidate answer. Return JSON only.`;

    const perJudge = await Promise.all(
      this.backends.map(async (backend): Promise<JudgeScore> => {
        if (this.excludeSameFamily && this.candidateFamily && backend.family === this.candidateFamily) {
          return {
            judgeId: backend.id,
            model: backend.model,
            family: backend.family,
            score: 0,
            reasoning: "Excluded: same family as candidate model",
            excluded: true,
            excludedReason: `Candidate family ${this.candidateFamily} matches judge family`,
          };
        }
        try {
          const raw = await backend.score(SHARED_JUDGE_SYSTEM, userPrompt);
          const parsed = parseScore(raw);
          return {
            judgeId: backend.id,
            model: backend.model,
            family: backend.family,
            score: parsed.score,
            reasoning: parsed.reasoning,
          };
        } catch (error) {
          return {
            judgeId: backend.id,
            model: backend.model,
            family: backend.family,
            score: 0,
            reasoning: `judge error: ${(error as Error).message}`,
            error: (error as Error).message,
          };
        }
      }),
    );

    const valid = perJudge.filter((j) => !j.excluded && !j.error);
    const scores = valid.map((j) => j.score);
    const mean = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : 0;
    const median = scores.length > 0 ? computeMedian(scores) : 0;
    const stddev = stdev(scores);
    const reasoningDigest = valid.map((j) => `${j.judgeId}: ${j.reasoning}`).join(" | ");

    return {
      queryId: query.id,
      platform: result.platform,
      run: result.run,
      score: mean,
      meanScore: mean,
      medianScore: median,
      stddev,
      reasoning: reasoningDigest,
      perJudge,
    };
  }
}

function computeMedian(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return 0;
  if (n % 2 === 1) return sorted[(n - 1) / 2]!;
  return (sorted[n / 2 - 1]! + sorted[n / 2]!) / 2;
}

function stdev(nums: number[]): number {
  const n = nums.length;
  if (n <= 1) return 0;
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const variance = nums.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  return Math.sqrt(variance);
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
