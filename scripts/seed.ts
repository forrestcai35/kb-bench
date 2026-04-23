import { Client as NotionClient } from "@notionhq/client";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { getConfig } from "../src/config.js";
import { loadCorpus } from "../src/dataset.js";
import { encodeVaultPath } from "../src/adapters/obsidian.js";
import type { CorpusDocument } from "../src/types.js";

async function resolveBenchmarkFolderId(
  supabase: SupabaseClient,
  workspaceId: string,
  folderName: string,
): Promise<string | null> {
  const { data, error } = await supabase
    .from("folders")
    .select("id")
    .eq("workspace_id", workspaceId)
    .ilike("name", folderName)
    .limit(1)
    .maybeSingle();

  if (!error && (data as { id?: string } | null)?.id) {
    return (data as { id: string }).id;
  }
  if (error) {
    console.warn(`  [warn] Folder lookup failed, will attempt to create: ${error.message}`);
  }

  const { data: created, error: createError } = await supabase
    .from("folders")
    .insert({ name: folderName, workspace_id: workspaceId })
    .select("id")
    .single();

  if (createError) {
    console.error(`  [fail] Could not create folder "${folderName}": ${createError.message}`);
    return null;
  }
  console.log(`  [info] Created folder "${folderName}" (${(created as { id: string }).id})`);
  return (created as { id: string }).id;
}

async function seedLore(docs: CorpusDocument[]): Promise<void> {
  const config = getConfig();
  if (!config.lore.supabaseUrl) throw new Error("SUPABASE_URL not set");
  if (!config.lore.serviceRoleKey) throw new Error("SUPABASE_SERVICE_ROLE_KEY not set");
  if (!config.lore.workspaceId) throw new Error("LORE_WORKSPACE_ID not set");
  if (!config.lore.userId) throw new Error("LORE_USER_ID not set");
  if (!config.lore.cliApiKey) {
    throw new Error(
      "LORE_API_KEY (or LORE_CLI_API_KEY) not set — required to call POST /api/admin/backfill-sections after seeding so new docs get embedded and become reachable via semantic search.",
    );
  }

  const supabase = createClient(config.lore.supabaseUrl, config.lore.serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const folderId = await resolveBenchmarkFolderId(
    supabase,
    config.lore.workspaceId,
    config.lore.folderName,
  );

  let inserted = 0;
  for (const doc of docs) {
    const payload: Record<string, unknown> = {
      title: doc.title,
      content: doc.body,
      source: "Agent",
      status: "Published",
      author: config.lore.author,
      workspace_id: config.lore.workspaceId,
      user_id: config.lore.userId,
    };
    if (folderId) payload.folder_id = folderId;

    const { data, error } = await supabase
      .from("documents")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      console.error(`  [fail] ${doc.title}: ${error.message}`);
      continue;
    }
    inserted++;
    console.log(`  [ok]   ${doc.title} → ${(data as { id: string }).id}`);
  }
  console.log(`\nLore seed: ${inserted}/${docs.length} inserted.`);

  if (inserted === 0) return;

  const backfillUrl = `${config.lore.apiUrl.replace(/\/$/, "")}/api/admin/backfill-sections`;
  console.log(`\nIndexing via ${backfillUrl} …`);
  const response = await fetch(backfillUrl, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.lore.cliApiKey}`,
      "Content-Type": "application/json",
    },
  });
  if (!response.ok) {
    const body = await response.text().catch(() => response.statusText);
    throw new Error(`Backfill failed (${response.status}): ${body}`);
  }
  const result = (await response.json()) as {
    processed: number;
    ok: number;
    results: Array<{ id: string; status: string; error?: string }>;
  };
  for (const r of result.results) {
    if (r.status === "error") {
      console.error(`  [fail] index ${r.id}: ${r.error ?? "unknown error"}`);
    }
  }
  console.log(`Lore index: ${result.ok}/${result.processed} documents indexed.`);
}

function markdownToNotionBlocks(markdown: string): unknown[] {
  const lines = markdown.split("\n");
  const blocks: unknown[] = [];
  for (const line of lines) {
    if (line.trim() === "") continue;
    if (line.startsWith("### ")) {
      blocks.push({
        object: "block",
        type: "heading_3",
        heading_3: { rich_text: [{ type: "text", text: { content: line.slice(4) } }] },
      });
    } else if (line.startsWith("## ")) {
      blocks.push({
        object: "block",
        type: "heading_2",
        heading_2: { rich_text: [{ type: "text", text: { content: line.slice(3) } }] },
      });
    } else if (line.startsWith("- ") || line.startsWith("* ")) {
      blocks.push({
        object: "block",
        type: "bulleted_list_item",
        bulleted_list_item: { rich_text: [{ type: "text", text: { content: line.slice(2) } }] },
      });
    } else if (/^\d+\.\s/.test(line)) {
      blocks.push({
        object: "block",
        type: "numbered_list_item",
        numbered_list_item: {
          rich_text: [{ type: "text", text: { content: line.replace(/^\d+\.\s/, "") } }],
        },
      });
    } else {
      blocks.push({
        object: "block",
        type: "paragraph",
        paragraph: { rich_text: [{ type: "text", text: { content: line } }] },
      });
    }
  }
  return blocks;
}

async function seedNotion(docs: CorpusDocument[]): Promise<void> {
  const config = getConfig();
  if (!config.notion.token) throw new Error("NOTION_TOKEN not set");
  const parentId = config.notion.parentPageId;
  if (!parentId) throw new Error("NOTION_PARENT_PAGE_ID not set — the parent page each runbook will be created under");
  const client = new NotionClient({ auth: config.notion.token });

  let inserted = 0;
  for (const doc of docs) {
    try {
      const res = await client.pages.create({
        parent: { type: "page_id", page_id: parentId },
        properties: {
          title: { title: [{ type: "text", text: { content: doc.title } }] },
        },
        children: markdownToNotionBlocks(doc.body) as Parameters<typeof client.pages.create>[0]["children"],
      });
      inserted++;
      console.log(`  [ok]   ${doc.title} → ${(res as { id: string }).id}`);
    } catch (err) {
      console.error(`  [fail] ${doc.title}: ${(err as Error).message}`);
    }
  }
  console.log(`\nNotion seed: ${inserted}/${docs.length} inserted.`);
}

function escapeXml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function inlineMarkdownToStorage(text: string): string {
  const escaped = escapeXml(text);
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

function markdownToConfluenceStorage(markdown: string): string {
  const lines = markdown.split("\n");
  const out: string[] = [];
  let listType: "ul" | "ol" | null = null;

  const closeList = (): void => {
    if (listType) {
      out.push(`</${listType}>`);
      listType = null;
    }
  };

  for (const raw of lines) {
    const line = raw.trimEnd();
    if (line === "") {
      closeList();
      continue;
    }
    if (line.startsWith("### ")) {
      closeList();
      out.push(`<h3>${inlineMarkdownToStorage(line.slice(4))}</h3>`);
    } else if (line.startsWith("## ")) {
      closeList();
      out.push(`<h2>${inlineMarkdownToStorage(line.slice(3))}</h2>`);
    } else if (/^[-*]\s+/.test(line)) {
      if (listType !== "ul") {
        closeList();
        out.push("<ul>");
        listType = "ul";
      }
      out.push(`<li>${inlineMarkdownToStorage(line.replace(/^[-*]\s+/, ""))}</li>`);
    } else if (/^\d+\.\s+/.test(line)) {
      if (listType !== "ol") {
        closeList();
        out.push("<ol>");
        listType = "ol";
      }
      out.push(`<li>${inlineMarkdownToStorage(line.replace(/^\d+\.\s+/, ""))}</li>`);
    } else {
      closeList();
      out.push(`<p>${inlineMarkdownToStorage(line)}</p>`);
    }
  }
  closeList();
  return out.join("");
}

async function resolveConfluenceSpaceId(
  spaceKey: string,
  fetchJson: (path: string, init?: RequestInit) => Promise<unknown>,
): Promise<string> {
  const explicitId = process.env.CONFLUENCE_SPACE_ID;
  if (explicitId) return explicitId;

  try {
    const v1 = (await fetchJson(
      `/wiki/rest/api/space/${encodeURIComponent(spaceKey)}`,
    )) as { id?: string | number };
    if (v1.id !== undefined) return String(v1.id);
  } catch (err) {
    console.warn(`  [warn] v1 space lookup failed: ${(err as Error).message}`);
  }

  const v2 = (await fetchJson(
    `/wiki/api/v2/spaces?keys=${encodeURIComponent(spaceKey)}`,
  )) as { results?: Array<{ id: string }> };
  const id = v2.results?.[0]?.id;
  if (id) return id;

  throw new Error(
    `Could not resolve Confluence space "${spaceKey}". Set CONFLUENCE_SPACE_ID to the numeric space id directly as a workaround.`,
  );
}

async function seedConfluence(docs: CorpusDocument[]): Promise<void> {
  const config = getConfig();
  if (!config.confluence.baseUrl) throw new Error("CONFLUENCE_BASE_URL not set");
  if (!config.confluence.email) throw new Error("CONFLUENCE_EMAIL not set");
  if (!config.confluence.apiToken) throw new Error("CONFLUENCE_API_TOKEN not set");
  if (!config.confluence.spaceKey) throw new Error("CONFLUENCE_SPACE_KEY not set");

  const baseUrl = config.confluence.baseUrl.replace(/\/$/, "").replace(/\/wiki$/, "");
  const authHeader = `Basic ${Buffer.from(
    `${config.confluence.email}:${config.confluence.apiToken}`,
  ).toString("base64")}`;

  const fetchJson = async (path: string, init?: RequestInit): Promise<unknown> => {
    const response = await fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        Authorization: authHeader,
        Accept: "application/json",
        "Content-Type": "application/json",
        ...(init?.headers ?? {}),
      },
    });
    if (!response.ok) {
      const text = await response.text().catch(() => response.statusText);
      throw new Error(`Confluence ${response.status}: ${text}`);
    }
    return response.json();
  };

  const spaceId = await resolveConfluenceSpaceId(config.confluence.spaceKey, fetchJson);
  console.log(`  [info] Resolved space ${config.confluence.spaceKey} → id ${spaceId}`);

  let inserted = 0;
  for (const doc of docs) {
    const body: Record<string, unknown> = {
      spaceId,
      status: "current",
      title: doc.title,
      body: {
        representation: "storage",
        value: markdownToConfluenceStorage(doc.body),
      },
    };
    if (config.confluence.parentPageId) body.parentId = config.confluence.parentPageId;

    try {
      const created = (await fetchJson("/wiki/api/v2/pages", {
        method: "POST",
        body: JSON.stringify(body),
      })) as { id: string };
      inserted++;
      console.log(`  [ok]   ${doc.title} → ${created.id}`);
    } catch (err) {
      console.error(`  [fail] ${doc.title}: ${(err as Error).message}`);
    }
  }
  console.log(`\nConfluence seed: ${inserted}/${docs.length} inserted.`);
}

function sanitizeObsidianFilename(name: string): string {
  return name.replace(/[\\/:*?"<>|#^[\]]/g, "-").replace(/\s+/g, " ").trim();
}

async function seedObsidian(docs: CorpusDocument[]): Promise<void> {
  const config = getConfig();
  if (!config.obsidian.apiKey) throw new Error("OBSIDIAN_API_KEY not set");
  const apiUrl = config.obsidian.apiUrl.replace(/\/$/, "");
  const folder = config.obsidian.folder.replace(/^\/+|\/+$/g, "");
  const isHttps = apiUrl.startsWith("https://");

  const previous = process.env.NODE_TLS_REJECT_UNAUTHORIZED;
  if (isHttps && config.obsidian.insecureTls) {
    process.env.NODE_TLS_REJECT_UNAUTHORIZED = "0";
  }

  let inserted = 0;
  try {
    for (const doc of docs) {
      const filename = `${sanitizeObsidianFilename(doc.title)}.md`;
      const relPath = folder ? `${folder}/${filename}` : filename;
      const body = `# ${doc.title}\n\n${doc.body}\n`;

      try {
        const response = await fetch(`${apiUrl}/vault/${encodeVaultPath(relPath)}`, {
          method: "PUT",
          headers: {
            Authorization: `Bearer ${config.obsidian.apiKey}`,
            "Content-Type": "text/markdown",
          },
          body,
        });
        if (!response.ok) {
          const text = await response.text().catch(() => response.statusText);
          throw new Error(`${response.status}: ${text}`);
        }
        inserted++;
        console.log(`  [ok]   ${doc.title} → ${relPath}`);
      } catch (err) {
        console.error(`  [fail] ${doc.title}: ${(err as Error).message}`);
      }
    }
  } finally {
    if (isHttps && config.obsidian.insecureTls) {
      if (previous === undefined) delete process.env.NODE_TLS_REJECT_UNAUTHORIZED;
      else process.env.NODE_TLS_REJECT_UNAUTHORIZED = previous;
    }
  }
  console.log(`\nObsidian seed: ${inserted}/${docs.length} inserted.`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const platformIdx = args.indexOf("--platform");
  const platform = platformIdx >= 0 ? args[platformIdx + 1] : undefined;
  if (!platform) {
    console.error("Usage: tsx scripts/seed.ts --platform <lore|notion|confluence|obsidian>");
    process.exit(1);
  }

  const docs = loadCorpus();
  console.log(`Loaded ${docs.length} documents from data/corpus\n=== Seeding ${platform} ===`);

  switch (platform) {
    case "lore":
      await seedLore(docs);
      break;
    case "notion":
      await seedNotion(docs);
      break;
    case "confluence":
      await seedConfluence(docs);
      break;
    case "obsidian":
      await seedObsidian(docs);
      break;
    default:
      console.error(`Unknown platform: ${platform}`);
      process.exit(1);
  }
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
