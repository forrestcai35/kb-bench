import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, type Config } from "./config.js";
import type { BenchmarkQuery, JudgeVerdict, QueryMetrics } from "./types.js";

const JUDGE_SYSTEM = `You are an impartial evaluator scoring a RAG agent's answer to an operational question. You will be given the question, the gold answer, and the agent's answer. Score correctness from 0 to 5:

0 — wrong, hallucinated, or missing
1 — mostly wrong
2 — partially correct but misses key facts
3 — roughly correct, some details off
4 — correct, minor omissions
5 — fully correct and complete

Return STRICT JSON only: {"score": <0-5>, "reasoning": "<one sentence>"}`;

export class Judge {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor(config: Config) {
    this.client = createAnthropicClient(config);
    this.model = config.model;
  }

  async score(query: BenchmarkQuery, result: QueryMetrics): Promise<JudgeVerdict> {
    if (result.error || !result.answer) {
      return {
        queryId: query.id,
        platform: result.platform,
        score: 0,
        reasoning: result.error ?? "No answer produced",
      };
    }

    const prompt = `Question: ${query.question}

Gold answer: ${query.goldAnswer}

Agent answer: ${result.answer}

Score the agent's answer. Return JSON only.`;

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 300,
      system: JUDGE_SYSTEM,
      messages: [{ role: "user", content: prompt }],
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
    });

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
      score: Math.max(0, Math.min(5, Number(parsed.score) || 0)),
      reasoning: String(parsed.reasoning ?? ""),
    };
  }
}
