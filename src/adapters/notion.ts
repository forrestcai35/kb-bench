import { Client as NotionClient } from "@notionhq/client";
import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import type { PlatformAdapter } from "./base.js";

export class NotionAdapter implements PlatformAdapter {
  readonly name = "notion";
  readonly systemPrompt =
    "You are querying a Notion workspace. Use `search_pages` to find pages matching a query (returns page IDs and titles). Use `retrieve_page` for page metadata and properties. Use `get_page_content` to fetch a page's full block tree (may be large). Keep your answer grounded in what the tools return.";
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
      name: "search_pages",
      description: "Search Notion pages by title/text. Returns an array of matching pages (id, title, last_edited_time, url).",
      input_schema: {
        type: "object",
        properties: {
          query: { type: "string", description: "Search query" },
          page_size: { type: "number", description: "Max results (default 10)", default: 10 },
        },
        required: ["query"],
      },
    },
    {
      name: "retrieve_page",
      description: "Retrieve a Notion page object by ID — properties, parent, timestamps. Does NOT include the block content.",
      input_schema: {
        type: "object",
        properties: { page_id: { type: "string" } },
        required: ["page_id"],
      },
    },
    {
      name: "get_page_content",
      description: "Fetch the block children of a Notion page — the actual text, headings, bullets, etc. Returns the full block tree as JSON.",
      input_schema: {
        type: "object",
        properties: {
          page_id: { type: "string" },
          page_size: { type: "number", description: "Max blocks (default 100)", default: 100 },
        },
        required: ["page_id"],
      },
    },
  ];

  async execute(toolName: string, toolInput: Record<string, unknown>): Promise<string> {
    if (!this.client) throw new Error(this.unavailableReason ?? "Notion adapter unavailable");
    switch (toolName) {
      case "search_pages": {
        const query = String(toolInput.query ?? "");
        const pageSize = Number(toolInput.page_size ?? 10);
        const res = await this.client.search({
          query,
          page_size: pageSize,
          filter: { property: "object", value: "page" },
        });
        return JSON.stringify(res, null, 2);
      }
      case "retrieve_page": {
        const pageId = String(toolInput.page_id ?? "");
        if (!pageId) throw new Error("Missing page_id");
        const res = await this.client.pages.retrieve({ page_id: pageId });
        return JSON.stringify(res, null, 2);
      }
      case "get_page_content": {
        const pageId = String(toolInput.page_id ?? "");
        const pageSize = Number(toolInput.page_size ?? 100);
        if (!pageId) throw new Error("Missing page_id");
        const res = await this.client.blocks.children.list({ block_id: pageId, page_size: pageSize });
        return JSON.stringify(res, null, 2);
      }
      default:
        throw new Error(`Unknown Notion tool: ${toolName}`);
    }
  }
}
