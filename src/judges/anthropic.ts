import Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { createAnthropicClient } from "../config.js";
import { withRetry } from "../retry.js";
import type { JudgeBackend } from "./base.js";

export class AnthropicJudge implements JudgeBackend {
  readonly id: string;
  readonly family = "anthropic" as const;
  readonly model: string;
  readonly available: boolean;
  readonly unavailableReason?: string;

  private readonly client: Anthropic | null;
  private readonly retries: number;

  constructor(config: Config, model: string) {
    this.model = model;
    this.id = `anthropic:${model}`;
    this.retries = config.retries;
    try {
      this.client = createAnthropicClient(config);
      this.available = true;
    } catch (error) {
      this.client = null;
      this.available = false;
      this.unavailableReason = (error as Error).message;
    }
  }

  async score(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.client) throw new Error(this.unavailableReason ?? "Anthropic judge unavailable");
    const response = await withRetry(
      `judge ${this.id}`,
      () =>
        this.client!.messages.create({
          model: this.model,
          max_tokens: 300,
          system: systemPrompt,
          messages: [{ role: "user", content: userPrompt }],
          thinking: { type: "adaptive" },
          output_config: { effort: "low" },
        }),
      { retries: this.retries },
    );
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();
  }
}
