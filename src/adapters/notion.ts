import { Client as NotionClient } from "@notionhq/client";
import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { renderSystemPrompt, type PlatformAdapter, type ToolExecutionResult } from "./base.js";

const TOOLS_DESCRIPTION = `- \`search\`(query, limit): search across the knowledge base. Returns an array of matches with page id, title, and metadata.
- \`fetch\`(id): return the full content (block tree) of a specific page by its id.
- \`list\`(limit): list recent pages. Only use if search fails.`;

export class NotionAdapter implements PlatformAdapter {
  readonly name = "notion";
  readonly systemPrompt = renderSystemPrompt(TOOLS_DESCRIPTION);
  readonly available: boolean;
  readonly unavailableReason?: string;

  private readonly client: NotionClient | null;

  constructor(config: Config) {
    if (!config.notion.token) {
      this.client = null;
      this.available = false;
      this.unavailableReason = "NOTION_TOKEN not set";
    } else {
      this.client = new NotionClient({ auth: config.notion.token });
      this.available = true;
    }
  }

  readonly tools: Anthropic.Tool[] = [
    {
      name: "search",
      description: "Search the knowledge base. Returns an array of matching pages (id, title, last_edited_time, url).",
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
      description: "Return the full content (block tree) of a specific page by its id.",
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
      description: "List recent pages. Only use when search fails to surface likely candidates.",
      input_schema: {
        type: "object",
        properties: {
          limit: { type: "number", description: "Max pages to return (default 50)", default: 50 },
        },
      },
    },
  ];

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<ToolExecutionResult> {
    if (!this.client) throw new Error(this.unavailableReason ?? "Adapter unavailable");
    switch (toolName) {
      case "search": {
        const query = String(toolInput.query ?? "");
        const limit = Number(toolInput.limit ?? 5);
        const res = await this.client.search({
          query,
          page_size: limit,
          filter: { property: "object", value: "page" },
        });
        const ids = extractNotionPageIds(res);
        return { text: JSON.stringify(res, null, 2), retrievedDocIds: ids };
      }
      case "fetch": {
        const id = String(toolInput.id ?? "");
        if (!id) throw new Error("Missing id");
        const blocks = await this.client.blocks.children.list({ block_id: id, page_size: 100 });
        return { text: JSON.stringify(blocks, null, 2), retrievedDocIds: [id] };
      }
      case "list": {
        const limit = Number(toolInput.limit ?? 50);
        const res = await this.client.search({
          query: "",
          page_size: limit,
          filter: { property: "object", value: "page" },
        });
        return { text: JSON.stringify(res, null, 2), retrievedDocIds: extractNotionPageIds(res) };
      }
      default:
        throw new Error(`Unknown tool: ${toolName}`);
    }
  }
}

function extractNotionPageIds(res: unknown): string[] {
  const results = (res as { results?: Array<{ id?: string }> })?.results ?? [];
  return results.map((r) => r.id ?? "").filter(Boolean);
}
