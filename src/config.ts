import Anthropic from "@anthropic-ai/sdk";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

function optionalEnv(name: string): string | undefined {
  return process.env[name];
}

function freeGeminiApiKeys(): string[] {
  return dedupe(
    Object.entries(process.env)
      .filter(([name, value]) => /^FREE_GEMINI_API_KEY(?:_\d+)?$/.test(name) && Boolean(value))
      .sort(([a], [b]) => freeGeminiKeyOrder(a) - freeGeminiKeyOrder(b) || a.localeCompare(b))
      .map(([, value]) => value!)
      .filter((value) => value.length > 0),
  );
}

function freeGeminiKeyOrder(name: string): number {
  const match = name.match(/^FREE_GEMINI_API_KEY(?:_(\d+))?$/);
  return Number(match?.[1] ?? 0);
}

function dedupe(values: Array<string | undefined>): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const value of values) {
    if (!value || seen.has(value)) continue;
    seen.add(value);
    result.push(value);
  }
  return result;
}

function parseList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export interface Config {
  anthropicApiKey: string | undefined;
  anthropicAuthToken: string | undefined;
  model: string;
  judgeModels: string[];
  excludeSameFamilyJudge: boolean;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  maxTurns: number;
  retries: number;
  runsPerQuery: number;
  topK: number;
  openai: {
    apiKey: string | undefined;
    baseUrl: string | undefined;
  };
  google: {
    apiKey: string | undefined;
    apiKeys: string[];
  };
  lore: {
    apiUrl: string;
    apiKey: string | undefined;
    cliApiKey: string | undefined;
    workspaceSlug: string | undefined;
    supabaseUrl: string | undefined;
    serviceRoleKey: string | undefined;
    workspaceId: string | undefined;
    userId: string | undefined;
    folderName: string;
    author: string;
  };
  notion: {
    token: string | undefined;
    parentPageId: string | undefined;
  };
  confluence: {
    baseUrl: string | undefined;
    email: string | undefined;
    apiToken: string | undefined;
    spaceKey: string | undefined;
    parentPageId: string | undefined;
  };
  obsidian: {
    apiUrl: string;
    apiKey: string | undefined;
    folder: string;
    insecureTls: boolean;
  };
}

const DEFAULT_JUDGE_PANEL = [
  "claude-sonnet-4-6",
  "gpt-5.4",
  "gemini-3-pro",
];

export function getConfig(): Config {
  const singleJudge = optionalEnv("BENCH_JUDGE_MODEL");
  const panelEnv = optionalEnv("BENCH_JUDGE_MODELS");
  const judgeModels = parseList(panelEnv);
  const resolvedJudges = judgeModels.length > 0
    ? judgeModels
    : singleJudge
      ? [singleJudge]
      : DEFAULT_JUDGE_PANEL;
  const openaiApiKey = optionalEnv("OPENAI_API_KEY");
  const openrouterApiKey = optionalEnv("OPENROUTER_API_KEY");
  const googleApiKey = optionalEnv("GOOGLE_API_KEY") ?? optionalEnv("GEMINI_API_KEY");
  const googleApiKeys = dedupe([googleApiKey, ...freeGeminiApiKeys()]);

  return {
    anthropicApiKey: optionalEnv("ANTHROPIC_API_KEY"),
    anthropicAuthToken:
      optionalEnv("ANTHROPIC_AUTH_TOKEN") ?? optionalEnv("CLAUDE_CODE_OAUTH_TOKEN"),
    model: optionalEnv("BENCH_MODEL") ?? "claude-sonnet-4-6",
    judgeModels: resolvedJudges,
    excludeSameFamilyJudge: (optionalEnv("BENCH_EXCLUDE_SAME_FAMILY_JUDGE") ?? "true") !== "false",
    effort: (optionalEnv("BENCH_EFFORT") as Config["effort"] | undefined) ?? "high",
    maxTokens: Number(optionalEnv("BENCH_MAX_TOKENS") ?? "16000"),
    maxTurns: Number(optionalEnv("BENCH_MAX_TURNS") ?? "10"),
    retries: Number(optionalEnv("BENCH_RETRIES") ?? "3"),
    runsPerQuery: Number(optionalEnv("BENCH_RUNS") ?? "1"),
    topK: Number(optionalEnv("BENCH_TOP_K") ?? "5"),
    openai: {
      apiKey: openaiApiKey ?? openrouterApiKey,
      baseUrl: openaiApiKey
        ? optionalEnv("OPENAI_BASE_URL")
        : openrouterApiKey
          ? optionalEnv("OPENROUTER_BASE_URL") ?? "https://openrouter.ai/api/v1"
          : optionalEnv("OPENAI_BASE_URL"),
    },
    google: {
      apiKey: googleApiKeys[0],
      apiKeys: googleApiKeys,
    },
    lore: {
      apiUrl: optionalEnv("LORE_API_URL") ?? "https://lightfield.app",
      apiKey: optionalEnv("LORE_API_KEY"),
      cliApiKey: optionalEnv("LORE_CLI_API_KEY") ?? optionalEnv("LORE_API_KEY"),
      workspaceSlug: optionalEnv("LORE_WORKSPACE_SLUG") ?? optionalEnv("LORE_WORKSPACE_ID"),
      supabaseUrl: optionalEnv("SUPABASE_URL"),
      serviceRoleKey: optionalEnv("SUPABASE_SERVICE_ROLE_KEY"),
      workspaceId: optionalEnv("LORE_WORKSPACE_ID"),
      userId: optionalEnv("LORE_USER_ID"),
      folderName: optionalEnv("LORE_BENCHMARK_FOLDER_NAME") ?? "Benchmarks",
      author: optionalEnv("LORE_AUTHOR") ?? "kb-bench",
    },
    notion: {
      token: optionalEnv("NOTION_TOKEN"),
      parentPageId: optionalEnv("NOTION_PARENT_PAGE_ID"),
    },
    confluence: {
      baseUrl: optionalEnv("CONFLUENCE_BASE_URL"),
      email: optionalEnv("CONFLUENCE_EMAIL"),
      apiToken: optionalEnv("CONFLUENCE_API_TOKEN"),
      spaceKey: optionalEnv("CONFLUENCE_SPACE_KEY"),
      parentPageId: optionalEnv("CONFLUENCE_PARENT_PAGE_ID"),
    },
    obsidian: {
      apiUrl: optionalEnv("OBSIDIAN_API_URL") ?? "http://127.0.0.1:27123",
      apiKey: optionalEnv("OBSIDIAN_API_KEY"),
      folder: optionalEnv("OBSIDIAN_VAULT_FOLDER") ?? "Benchmarks",
      insecureTls: optionalEnv("OBSIDIAN_INSECURE_TLS") === "true",
    },
  };
}

export function createAnthropicClient(config: Config): Anthropic {
  if (config.anthropicAuthToken) {
    return new Anthropic({
      apiKey: null,
      authToken: config.anthropicAuthToken,
      defaultHeaders: { "anthropic-beta": "oauth-2025-04-20" },
    });
  }
  if (config.anthropicApiKey) {
    return new Anthropic({ apiKey: config.anthropicApiKey });
  }
  throw new Error(
    "Set ANTHROPIC_AUTH_TOKEN (OAuth — e.g. Claude Max subscription) or ANTHROPIC_API_KEY to run the benchmark agent. CLAUDE_CODE_OAUTH_TOKEN is also accepted.",
  );
}
