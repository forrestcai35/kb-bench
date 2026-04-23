import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import type { PlatformAdapter } from "./base.js";

export class LoreAdapter implements PlatformAdapter {
  readonly name = "lore";
  readonly systemPrompt =
    "You are querying the Lore operational knowledge base. Use `search_knowledge_base` for semantic search over the corpus. Use `get_document` to read a specific document in full when a search snippet is insufficient. Use `list_documents` only when browsing recent content. Keep your answer grounded in what the tools return.";
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
      name: "search_knowledge_base",
      description: "Search the Lore knowledge base using semantic search. Returns pre-formatted chunks with breadcrumb-style headings, scoped to the user's workspace.",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "The search query formulation" },
          limit: { type: "number", description: "Maximum number of results to return (default: 5)", default: 5 },
        },
        required: ["query"],
      },
    },
    {
      name: "get_document",
      description: "Get full details and content of a specific Lore document by ID.",
      input_schema: {
        type: "object",
        properties: {
          id: { type: "string", description: "The document ID to fetch" },
        },
        required: ["id"],
      },
    },
    {
      name: "list_documents",
      description: "List recent documents in the Lore knowledge base.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Maximum number of documents to list (default: 50)", default: 50 },
          offset: { type: "number", description: "Pagination offset (default: 0)", default: 0 },
        },
      },
    },
  ];

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
    switch (toolName) {
      case "search_knowledge_base":
        return this.searchKnowledgeBase(toolInput);
      case "get_document":
        return this.getDocument(toolInput);
      case "list_documents":
        return this.listDocuments(toolInput);
      default:
        throw new Error(`Unknown Lore tool: ${toolName}`);
    }
  }

  private async searchKnowledgeBase(args: Record<string, unknown>): Promise<string> {
    const query = String(args.query ?? "");
    const limit = Number(args.limit ?? 5);
    const params = new URLSearchParams({ q: query, limit: String(limit) });
    const data = await this.fetchJson(`/api/v1/search?${params.toString()}`);
    if (typeof data?.text === "string" && data.text.length > 0) return data.text;
    if (Array.isArray(data?.results) && data.results.length === 0) return "No matches found.";
    return JSON.stringify(data, null, 2);
  }

  private async getDocument(args: Record<string, unknown>): Promise<string> {
    const id = String(args.id ?? "");
    if (!id) throw new Error("Missing document id");
    const data = await this.fetchJson(`/api/v1/documents/${encodeURIComponent(id)}`);
    return JSON.stringify(data, null, 2);
  }

  private async listDocuments(args: Record<string, unknown>): Promise<string> {
    const limit = Number(args.limit ?? 50);
    const offset = Number(args.offset ?? 0);
    const params = new URLSearchParams({ limit: String(limit), offset: String(offset) });
    const data = await this.fetchJson(`/api/v1/documents?${params.toString()}`);
    return JSON.stringify(data, null, 2);
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
      throw new Error(`Lore API error (${response.status}): ${message}`);
    }
    return (await response.json()) as { text?: string; results?: unknown[] } & Record<string, unknown>;
  }
}
