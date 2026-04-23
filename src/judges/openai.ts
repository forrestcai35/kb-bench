import OpenAI from "openai";
import type { Config } from "../config.js";
import { withRetry } from "../retry.js";
import type { JudgeBackend } from "./base.js";

export class OpenAIJudge implements JudgeBackend {
  readonly id: string;
  readonly family = "openai" as const;
  readonly model: string;
  readonly available: boolean;
  readonly unavailableReason?: string;

  private readonly client: OpenAI | null;
  private readonly retries: number;

  constructor(config: Config, model: string) {
    this.model = model;
    this.id = `openai:${model}`;
    this.retries = config.retries;
    const apiKey = config.openai.apiKey;
    if (!apiKey) {
      this.client = null;
      this.available = false;
      this.unavailableReason = "OPENAI_API_KEY or OPENROUTER_API_KEY not set";
      return;
    }
    this.client = new OpenAI({
      apiKey,
      baseURL: config.openai.baseUrl,
    });
    this.available = true;
  }

  async score(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.client) throw new Error(this.unavailableReason ?? "OpenAI judge unavailable");
    const response = await withRetry(
      `judge ${this.id}`,
      () =>
        this.client!.chat.completions.create({
          model: this.model,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          max_tokens: 300,
          temperature: 0,
          response_format: { type: "json_object" },
        }),
      { retries: this.retries },
    );
    return response.choices[0]?.message?.content?.trim() ?? "";
  }
}
