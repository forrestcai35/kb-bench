import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getConfig } from "./config.js";

function isRelevantEnvKey(name: string): boolean {
  return [
    "OPENAI_API_KEY",
    "OPENAI_BASE_URL",
    "OPENROUTER_API_KEY",
    "OPENROUTER_BASE_URL",
    "GOOGLE_API_KEY",
    "GEMINI_API_KEY",
  ].includes(name) || /^FREE_GEMINI_API_KEY(?:_\d+)?$/.test(name);
}

const ORIGINAL_ENV = new Map(
  Object.entries(process.env).filter(([name]) => isRelevantEnvKey(name)),
);

function clearRelevantEnv(): void {
  for (const name of Object.keys(process.env)) {
    if (isRelevantEnvKey(name)) delete process.env[name];
  }
}

describe("getConfig", () => {
  beforeEach(() => {
    clearRelevantEnv();
  });

  afterEach(() => {
    clearRelevantEnv();
    for (const [name, value] of ORIGINAL_ENV) {
      process.env[name] = value;
    }
  });

  it("falls back to OpenRouter credentials for openai-family judges", () => {
    process.env.OPENROUTER_API_KEY = "or-key";

    const config = getConfig();

    expect(config.openai.apiKey).toBe("or-key");
    expect(config.openai.baseUrl).toBe("https://openrouter.ai/api/v1");
  });

  it("prefers direct OpenAI credentials when both are present", () => {
    process.env.OPENAI_API_KEY = "openai-key";
    process.env.OPENROUTER_API_KEY = "or-key";

    const config = getConfig();

    expect(config.openai.apiKey).toBe("openai-key");
    expect(config.openai.baseUrl).toBeUndefined();
  });

  it("collects direct and pooled Gemini credentials in stable order", () => {
    process.env.GEMINI_API_KEY = "direct";
    process.env.FREE_GEMINI_API_KEY_2 = "pool-2";
    process.env.FREE_GEMINI_API_KEY_1 = "pool-1";
    process.env.FREE_GEMINI_API_KEY_10 = "pool-10";

    const config = getConfig();

    expect(config.google.apiKey).toBe("direct");
    expect(config.google.apiKeys).toEqual(["direct", "pool-1", "pool-2", "pool-10"]);
  });
});
