import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { renderSystemPrompt, type PlatformAdapter, type ToolExecutionResult } from "./base.js";

const TOOLS_DESCRIPTION = `- \`search\`(query, limit): semantic search across the corpus. Returns an array of matches, each with a document id, a title, and a relevance snippet.
- \`fetch\`(id): return the full content of a specific document by its id.
- \`list\`(limit, offset): list documents. Only use if search fails.`;

export class LoreAdapter implements PlatformAdapter {
  readonly name = "lore";
  readonly systemPrompt = renderSystemPrompt(TOOLS_DESCRIPTION);
  readonly available: boolean;
  readonly unavailableReason?: string;

  private readonly apiUrl: string;
  private readonly apiKey: string | undefined;
  private readonly workspaceSlug: string | undefined;

  constructor(config: Config) {
    this.apiUrl = config.lore.apiUrl;
    this.apiKey = config.lore.apiKey;
    this.workspaceSlug = config.lore.workspaceSlug;
    if (!this.apiKey) {
      this.available = false;
      this.unavailableReason = "LORE_API_KEY not set";
    } else {
      this.available = true;
    }
  }

  readonly tools: Anthropic.Tool[] = [
    {
      name: "search",
      description: "Semantic search across the corpus. Returns an array of matches with a document id, title, and relevance snippet.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query" },
          limit: { type: "number", description: "Max number of results (default 5)", default: 5 },
        },
        required: ["query"],
      },
    },
    {
      name: "fetch",
      description: "Return the full content of a specific document by its id.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The document id" },
        },
        required: ["id"],
      },
    },
    {
      name: "list",
      description: "List documents (paginated). Only use when search fails to surface likely candidates.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max documents to return (default 50)", default: 50 },
          offset: { type: "number", description: "Pagination offset (default 0)", default: 0 },
        },
      },
    },
  ];

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<ToolExecutionResult> {
    switch (toolName) {
      case "search":
        return this.searchKnowledgeBase(toolInput);
      case "fetch":
        return this.getDocument(toolInput);
      case "list":
        return this.listDocuments(toolInput);
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }

  private async searchKnowledgeBase(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const query = String(args.query ?? "");
    const limit = Number(args.limit ?? 5);
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const data = await this.fetchJson(`/api/v1/search?${params.toString()}`);
    const ids = extractDocIds(data);
    if (typeof data?.text === "string" && data.text.length > 0) {
      return { text: data.text, retrievedDocIds: ids };
    }
    if (Array.isArray(data?.results) && data.results.length === 0) {
      return { text: "No matches found.", retrievedDocIds: [] };
    }
    return { text: JSON.stringify(data, null, 2), retrievedDocIds: ids };
  }

  private async getDocument(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const id = String(args.id ?? "");
    if (!id) throw new Error("Missing document id");
    const data = await this.fetchJson(`/api/v1/documents/${encodeURIComponent(id)}`);
    return { text: JSON.stringify(data, null, 2), retrievedDocIds: [id] };
  }

  private async listDocuments(args: Record<string, unknown>): Promise<ToolExecutionResult> {
    const limit = Number(args.limit ?? 50);
    const offset = Number(args.offset ?? 0);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const data = await this.fetchJson(`/api/v1/documents?${params.toString()}`);
    return { text: JSON.stringify(data, null, 2), retrievedDocIds: extractDocIds(data) };
  }

  private async fetchJson(endpoint: string): Promise<{ text?: string; results?: unknown[] } & Record<string, unknown>> {
    const headers: Record<string, string> = {
      Authorization: `Bearer ${this.apiKey}`,
      "Content-Type": "application/json",
    };
    if (this.workspaceSlug) headers["x-lore-workspace"] = this.workspaceSlug;
    const response = await fetch(`${this.apiUrl}${endpoint}`, { headers });
    if (!response.ok) {
      let message = response.statusText;
      try {
        const body = (await response.json()) as { error?: string };
        if (body.error) message = body.error;
      } catch {}
      throw new Error(`API error (${response.status}): ${message}`);
    }
    return (await response.json()) as { text?: string; results?: unknown[] } & Record<string, unknown>;
  }
}

function extractDocIds(data: unknown): string[] {
  const ids = new Set<string>();
  const visit = (value: unknown): void => {
    if (value === null || value === undefined) return;
    if (Array.isArray(value)) {
      for (const item of value) visit(item);
      return;
    }
    if (typeof value === "object") {
      const obj = value as Record<string, unknown>;
      for (const key of ["document_id", "doc_id", "id"]) {
        const v = obj[key];
        if (typeof v === "string") ids.add(v);
      }
      for (const v of Object.values(obj)) visit(v);
    }
  };
  visit(data);
  return Array.from(ids);
}
