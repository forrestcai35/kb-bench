import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { renderSystemPrompt, type PlatformAdapter, type ToolExecutionResult } from "./base.js";

const TOOLS_DESCRIPTION = `- \`search\`(query, limit): full-text search across the knowledge base. Returns an array of matches with a document id (filename), title, and relevance snippet.
- \`fetch\`(id): return the full content of a specific document by its id (filename).
- \`list\`(limit): list all documents. Only use if search fails.`;

export class ObsidianAdapter implements PlatformAdapter {
  readonly name = "obsidian";
  readonly systemPrompt = renderSystemPrompt(TOOLS_DESCRIPTION);
  readonly available: boolean;
  readonly unavailableReason?: string;

  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly folder: string;
  private readonly allowInsecureTls: boolean;

  constructor(config: Config) {
    this.apiUrl = config.obsidian.apiUrl.replace(/\/$/, "");
    this.apiKey = config.obsidian.apiKey;
    this.folder = config.obsidian.folder.replace(/^\/+|\/+$/g, "");
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
      name: "search",
      description: "Full-text search across the knowledge base. Returns an array of matches with id (path), title, and relevance snippet.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          limit: { type: "number", description: "Max results (default 5)", default: 5 },
        },
        required: ["query"],
      },
    },
    {
      name: "fetch",
      description: "Return the full content of a specific document by its id (vault-relative path including .md).",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "Vault-relative path to the markdown file, including the .md extension." },
        },
        required: ["id"],
      },
    },
    {
      name: "list",
      description: "List all documents. Only use when search fails to surface likely candidates.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max documents to return (default 50)", default: 50 },
        },
      },
    },
  ];

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<ToolExecutionResult> {
    if (!this.available) throw new Error(this.unavailableReason ?? "Adapter unavailable");
    switch (toolName) {
      case "search":
        return this.searchVault(toolInput);
      case "fetch":
        return this.getNote(toolInput);
      case "list":
        return this.listVault(toolInput);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async searchVault(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const query = String(args.query ?? "");
    const limit = Number(args.limit ?? 5);
    const params = new URLSearchParams({ query, contextLength: "160" });
    const raw = await this.request(`/search/simple/?${params.toString()}`, {
      method: "POST",
      accept: "application/json",
    });
    try {
      const parsed = JSON.parse(raw) as Array<{ filename?: string }>;
      const trimmed = parsed.slice(0, limit);
      const ids = trimmed.map((r) => r.filename ?? "").filter(Boolean);
      return { text: JSON.stringify(trimmed, null, 2), retrievedDocIds: ids };
    } catch {
      return { text: raw, retrievedDocIds: [] };
    }
  }

  private async getNote(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const id = String(args.id ?? "");
    if (!id) throw new Error("Missing id");
    const text = await this.request(`/vault/${encodeVaultPath(id)}`, {
      method: "GET",
      accept: "text/markdown",
    });
    return { text, retrievedDocIds: [id] };
  }

  private async listVault(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const limit = Number(args.limit ?? 50);
    const endpoint = this.folder ? `/vault/${encodeVaultPath(this.folder)}/` : "/vault/";
    const raw = await this.request(endpoint, { method: "GET", accept: "application/json" });
    try {
      const parsed = JSON.parse(raw) as { files?: string[] };
      const trimmed = (parsed.files ?? []).slice(0, limit);
      const prefix = this.folder ? `${this.folder}/` : "";
      const ids = trimmed.filter((f) => !f.endsWith("/")).map((f) => `${prefix}${f}`);
      return { text: JSON.stringify({ files: trimmed }, null, 2), retrievedDocIds: ids };
    } catch {
      return { text: raw, retrievedDocIds: [] };
    }
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
        throw new Error(`API error (${response.status}): ${message}`);
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
