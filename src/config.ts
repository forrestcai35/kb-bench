import Anthropic from "@anthropic-ai/sdk";
import { config as loadDotenv } from "dotenv";
import { resolve } from "node:path";

loadDotenv({ path: resolve(process.cwd(), ".env"), quiet: true });

function optionalEnv(name: string): string | undefined {
  return process.env[name];
}

export interface Config {
  anthropicApiKey: string | undefined;
  anthropicAuthToken: string | undefined;
  model: string;
  effort: "low" | "medium" | "high" | "xhigh" | "max";
  maxTokens: number;
  maxTurns: number;
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
    databaseId: string | undefined;
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

export function getConfig(): Config {
  return {
    anthropicApiKey: optionalEnv("ANTHROPIC_API_KEY"),
    anthropicAuthToken:
      optionalEnv("ANTHROPIC_AUTH_TOKEN") ?? optionalEnv("CLAUDE_CODE_OAUTH_TOKEN"),
    model: optionalEnv("BENCH_MODEL") ?? "claude-opus-4-7",
    effort: (optionalEnv("BENCH_EFFORT") as Config["effort"] | undefined) ?? "high",
    maxTokens: Number(optionalEnv("BENCH_MAX_TOKENS") ?? "16000"),
    maxTurns: Number(optionalEnv("BENCH_MAX_TURNS") ?? "10"),
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
      author: optionalEnv("LORE_AUTHOR") ?? "Benchmark Seed",
    },
    notion: {
      token: optionalEnv("NOTION_TOKEN"),
      databaseId: optionalEnv("NOTION_DATABASE_ID"),
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
    "Set ANTHROPIC_AUTH_TOKEN (OAuth — e.g. Claude Max subscription) or ANTHROPIC_API_KEY to run the benchmark agent and judge. CLAUDE_CODE_OAUTH_TOKEN is also accepted.",
  );
}
