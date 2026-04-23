import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { renderSystemPrompt, type PlatformAdapter, type ToolExecutionResult } from "./base.js";

const TOOLS_DESCRIPTION = `- \`search\`(query, limit): full-text search across the knowledge base. Returns an array of matches with page id, title, excerpt, and url.
- \`fetch\`(id): return the full content of a specific page by its id.
- \`list\`(limit): list pages in the space. Only use if search fails.`;

export class ConfluenceAdapter implements PlatformAdapter {
  readonly name = "confluence";
  readonly systemPrompt = renderSystemPrompt(TOOLS_DESCRIPTION);
  readonly available: boolean;
  readonly unavailableReason?: string;

  private readonly baseUrl: string | undefined;
  private readonly authHeader: string | undefined;
  private readonly spaceKey: string | undefined;

  constructor(config: Config) {
    this.baseUrl = config.confluence.baseUrl?.replace(/\/$/, "").replace(/\/wiki$/, "");
    this.spaceKey = config.confluence.spaceKey;
    if (!config.confluence.baseUrl || !config.confluence.email || !config.confluence.apiToken) {
      this.available = false;
      this.unavailableReason = "CONFLUENCE_BASE_URL, CONFLUENCE_EMAIL, or CONFLUENCE_API_TOKEN not set";
      return;
    }
    const token = Buffer.from(`${config.confluence.email}:${config.confluence.apiToken}`).toString("base64");
    this.authHeader = `Basic ${token}`;
    this.available = true;
  }

  readonly tools: Anthropic.Tool[] = [
    {
      name: "search",
      description: "Full-text search across the knowledge base. Returns an array of matches with page id, title, excerpt, and url.",
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
      description: "Return the full content of a specific page by its id (storage-format body).",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The page id" },
        },
        required: ["id"],
      },
    },
    {
      name: "list",
      description: "List pages in the configured space. Only use when search fails to surface likely candidates.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max pages to return (default 50)", default: 50 },
        },
      },
    },
  ];

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<ToolExecutionResult> {
    if (!this.available) throw new Error(this.unavailableReason ?? "Adapter unavailable");
    switch (toolName) {
      case "search":
        return this.searchPages(toolInput);
      case "fetch":
        return this.getPage(toolInput);
      case "list":
        return this.listPages(toolInput);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async searchPages(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const query = String(args.query ?? "");
    const limit = Number(args.limit ?? 5);
    const escaped = query.replace(/"/g, '\\"');
    const parts: string[] = [`text ~ "${escaped}"`, `type = "page"`];
    if (this.spaceKey) parts.push(`space = "${this.spaceKey}"`);
    const cql = parts.join(" AND ");
    const params = new URLSearchParams({ cql, limit: String(limit) });
    const data = (await this.fetchJson(`/wiki/rest/api/search?${params.toString()}`)) as {
      results?: Array<{ content?: { id?: string } }>;
    };
    const ids =
      data.results?.map((r) => r.content?.id).filter((x): x is string => typeof x === "string") ??
      [];
    return { text: JSON.stringify(data, null, 2), retrievedDocIds: ids };
  }

  private async getPage(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const id = String(args.id ?? "");
    if (!id) throw new Error("Missing id");
    const data = await this.fetchJson(
      `/wiki/api/v2/pages/${encodeURIComponent(id)}?body-format=storage`,
    );
    return { text: JSON.stringify(data, null, 2), retrievedDocIds: [id] };
  }

  private async listPages(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const limit = Number(args.limit ?? 50);
    const params = new URLSearchParams({ limit: String(limit) });
    const endpoint = this.spaceKey
      ? `/wiki/rest/api/content?spaceKey=${encodeURIComponent(this.spaceKey)}&${params.toString()}`
      : `/wiki/rest/api/content?${params.toString()}`;
    const data = (await this.fetchJson(endpoint)) as {
      results?: Array<{ id?: string }>;
    };
    const ids = data.results?.map((r) => r.id).filter((x): x is string => typeof x === "string") ?? [];
    return { text: JSON.stringify(data, null, 2), retrievedDocIds: ids };
  }

  private async fetchJson(endpoint: string): Promise<unknown> {
    const response = await fetch(`${this.baseUrl}${endpoint}`, {
      headers: {
        Authorization: this.authHeader as string,
        Accept: "application/json",
      },
    });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as { message?: string };
        if (body.message) message = body.message;
      } catch {}
      throw new Error(`API error (${response.status}): ${message}`);
    }
    return response.json();
  }
}
