import { GoogleGenAI } from "@google/genai";
import type { Config } from "../config.js";
import { withRetry } from "../retry.js";
import type { JudgeBackend } from "./base.js";

export class GoogleJudge implements JudgeBackend {
  readonly id: string;
  readonly family = "google" as const;
  readonly model: string;
  readonly available: boolean;
  readonly unavailableReason?: string;

  private readonly client: GoogleGenAI | null;
  private readonly retries: number;

  constructor(config: Config, model: string) {
    this.model = model;
    this.id = `google:${model}`;
    this.retries = config.retries;
    const apiKey = config.google.apiKey;
    if (!apiKey) {
      this.client = null;
      this.available = false;
      this.unavailableReason = "GOOGLE_API_KEY (or GEMINI_API_KEY) not set";
      return;
    }
    this.client = new GoogleGenAI({ apiKey });
    this.available = true;
  }

  async score(systemPrompt: string, userPrompt: string): Promise<string> {
    if (!this.client) throw new Error(this.unavailableReason ?? "Google judge unavailable");
    const response = await withRetry(
      `judge ${this.id}`,
      () =>
        this.client!.models.generateContent({
          model: this.model,
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          config: {
            systemInstruction: systemPrompt,
            temperature: 0,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
          },
        }),
      { retries: this.retries },
    );
    return response.text?.trim() ?? "";
  }
}
