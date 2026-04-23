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

  private readonly clients: GoogleGenAI[];
  private readonly retries: number;
  private nextClientIndex = 0;

  constructor(config: Config, model: string) {
    this.model = model;
    this.id = `google:${model}`;
    this.retries = config.retries;
    const apiKeys = config.google.apiKeys;
    if (apiKeys.length === 0) {
      this.clients = [];
      this.available = false;
      this.unavailableReason = "GOOGLE_API_KEY, GEMINI_API_KEY, or FREE_GEMINI_API_KEY_N not set";
      return;
    }
    this.clients = apiKeys.map((apiKey) => new GoogleGenAI({ apiKey }));
    this.available = true;
  }

  async score(systemPrompt: string, userPrompt: string): Promise<string> {
    if (this.clients.length === 0) throw new Error(this.unavailableReason ?? "Google judge unavailable");
    const response = await withRetry(`judge ${this.id}`, () => this.generateWithFallback(systemPrompt, userPrompt), {
      retries: this.retries,
    });
    return response.text?.trim() ?? "";
  }

  private async generateWithFallback(systemPrompt: string, userPrompt: string) {
    let lastError: unknown;
    for (let attempt = 0; attempt < this.clients.length; attempt++) {
      const index = this.nextClientIndex;
      const client = this.clients[index]!;
      try {
        return await client.models.generateContent({
          model: this.model,
          contents: [{ role: "user", parts: [{ text: userPrompt }] }],
          config: {
            systemInstruction: systemPrompt,
            temperature: 0,
            maxOutputTokens: 300,
            responseMimeType: "application/json",
          },
        });
      } catch (error) {
        lastError = error;
        if (!shouldRotateGeminiKey(error) || this.clients.length === 1) throw error;
        const nextIndex = (index + 1) % this.clients.length;
        if (nextIndex === index) throw error;
        this.nextClientIndex = nextIndex;
        console.warn(
          `[judge] ${this.id} hit Gemini quota/rate limits on credential ${index + 1}/${this.clients.length}; rotating to ${nextIndex + 1}/${this.clients.length}`,
        );
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }
}

function shouldRotateGeminiKey(error: unknown): boolean {
  const message = (error as Error | undefined)?.message?.toLowerCase() ?? "";
  return /\b429\b|quota|resource_exhausted|rate limit|too many requests/.test(message);
}
