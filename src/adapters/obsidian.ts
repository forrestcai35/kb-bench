import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import type { PlatformAdapter } from "./base.js";

export class ObsidianAdapter implements PlatformAdapter {
  readonly name = "obsidian";
  readonly systemPrompt =
    "You are querying an Obsidian vault via the Local REST API plugin. Use `search_vault` for full-text search across notes (returns filename, score, and match context). Use `get_note` to read a specific markdown note in full when the search context is insufficient. Use `list_vault` to browse files in a folder. Keep your answer grounded in what the tools return.";
  readonly available: boolean;
  readonly unavailableReason?: string;

  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly allowInsecureTls: boolean;

  constructor(config: Config) {
    this.apiUrl = config.obsidian.apiUrl.replace(/\/$/, "");
    this.apiKey = config.obsidian.apiKey;
    this.allowInsecureTls = config.obsidian.insecureTls;
    if (!this.apiKey) {
      this.available = false;
      this.unavailableReason = "OBSIDIAN_API_KEY not set";
    } else {
      this.available = true;
    }
  }

  readonly tools: Anthropic.Tool[] = [
    {
      name: "search_vault",
      description:
        "Full-text search across all notes in the Obsidian vault. Returns an array of { filename, score, matches: [{ context, match }] }. Use `get_note` to read a full file once you've identified a relevant filename.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          context_length: {
            type: "number",
            description: "Characters of context around each match (default 100)",
            default: 100,
          },
        },
        required: ["query"],
      },
    },
    {
      name: "get_note",
      description:
        "Read the full markdown content of a note by its vault-relative path (including .md extension), e.g. \"Benchmarks/Deploying the Web App.md\".",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Vault-relative path to the markdown file, including the .md extension.",
          },
        },
        required: ["path"],
      },
    },
    {
      name: "list_vault",
      description:
        "List the files and subfolders at a given vault-relative folder path. Pass an empty string to list the vault root. Returns { files: string[] } where directory entries end with a trailing slash.",
      input_schema: {
        type: "object",
        properties: {
          path: {
            type: "string",
            description: "Vault-relative folder path. Empty string (or omitted) for the root.",
            default: "",
          },
        },
      },
    },
  ];

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
    if (!this.available) throw new Error(this.unavailableReason ?? "Obsidian adapter unavailable");
    switch (toolName) {
      case "search_vault":
        return this.searchVault(toolInput);
      case "get_note":
        return this.getNote(toolInput);
      case "list_vault":
        return this.listVault(toolInput);
      default:
        throw new Error(`Unknown Obsidian tool: ${toolName}`);
    }
  }

  private async searchVault(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? "");
    const contextLength = Number(args.context_length ?? 100);
    const params = new URLSearchParams({
      query,
      contextLength: String(contextLength),
    });
    return this.request(`/search/simple/?${params.toString()}`, {
      method: "POST",
      accept: "application/json",
    });
  }

  private async getNote(args: Record<string, unknown>): Promise<string> {
    const path = String(args.path ?? "");
    if (!path) throw new Error("Missing path");
    return this.request(`/vault/${encodeVaultPath(path)}`, {
      method: "GET",
      accept: "text/markdown",
    });
  }

  private async listVault(args: Record<string, unknown>): Promise<string> {
    const path = String(args.path ?? "");
    const endpoint = path ? `/vault/${encodeVaultPath(path)}/` : "/vault/";
    return this.request(endpoint, { method: "GET", accept: "application/json" });
  }

  private async request(
    endpoint: string,
    init: { method: string; accept: string },
  ): Promise<string> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      Accept: init.accept,
    };

    const isHttps = this.apiUrl.startsWith("https://");
    const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
    if (isHttps && this.allowInsecureTls) {
      process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
    }
    try {
      const response = await fetch(`${this.apiUrl}${endpoint}`, {
        method: init.method,
        headers,
      });
      if (!response.ok) {
        let message = response.statusText;
        try {
          const body = await response.text();
          if (body) message = body;
        } catch {}
        throw new Error(`Obsidian API error (${response.status}): ${message}`);
      }
      return await response.text();
    } finally {
      if (isHttps && this.allowInsecureTls) {
        if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
        else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
      }
    }
  }
}

export function encodeVaultPath(path: string): string {
  return path
    .split("/")
    .filter((segment) => segment.length > 0)
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}
