import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import type { PlatformAdapter } from "./base.js";

export class ConfluenceAdapter implements PlatformAdapter {
  readonly name = "confluence";
  readonly systemPrompt =
    "You are querying a Confluence space. Use `search_pages` with a text query (CQL-scoped to the configured space) to find matching pages — returns id, title, excerpt. Use `get_page` to fetch a specific page's full storage-format body when an excerpt is insufficient. Keep your answer grounded in what the tools return.";
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
      name: "search_pages",
      description: "Full-text search Confluence pages in the configured space. Returns array of matches with id, title, excerpt, and url.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Free-text query; matched with CQL text ~ operator" },
          limit: { type: "number", description: "Max results (default 10)", default: 10 },
        },
        required: ["query"],
      },
    },
    {
      name: "get_page",
      description: "Fetch a Confluence page by ID, including its storage-format body (XHTML-ish). Returns the full v2 page object.",
      input_schema: {
        type: "object",
        properties: { page_id: { type: "string" } },
        required: ["page_id"],
      },
    },
  ];

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
    if (!this.available) throw new Error(this.unavailableReason ?? "Confluence adapter unavailable");
    switch (toolName) {
      case "search_pages":
        return this.searchPages(toolInput);
      case "get_page":
        return this.getPage(toolInput);
      default:
        throw new Error(`Unknown Confluence tool: ${toolName}`);
    }
  }

  private async searchPages(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? "");
    const limit = Number(args.limit ?? 10);
    const escaped = query.replace(/"/g, '\\"');
    const parts: string[] = [`text ~ "${escaped}"`, `type = "page"`];
    if (this.spaceKey) parts.push(`space = "${this.spaceKey}"`);
    const cql = parts.join(" AND ");
    const params = new URLSearchParams({ cql, limit: String(limit) });
    const data = await this.fetchJson(`/wiki/rest/api/search?${params.toString()}`);
    return JSON.stringify(data, null, 2);
  }

  private async getPage(args: Record<string, unknown>): Promise<string> {
    const pageId = String(args.page_id ?? "");
    if (!pageId) throw new Error("Missing page_id");
    const data = await this.fetchJson(
      `/wiki/api/v2/pages/${encodeURIComponent(pageId)}?body-format=storage`,
    );
    return JSON.stringify(data, null, 2);
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
      throw new Error(`Confluence API error (${response.status}): ${message}`);
    }
    return response.json();
  }
}
