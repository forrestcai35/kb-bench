import { createHash } from "node:crypto";
import { readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";
import type { BenchmarkQuery, CorpusDocument } from "./types.js";

const DATA_DIR = resolve(process.cwd(), "data");

export interface Dataset {
  documents: CorpusDocument[];
  queries: BenchmarkQuery[];
  corpusHash: string;
  queriesHash: string;
}

export function loadDataset(options: { split?: "public" | "holdout" | "all" } = {}): Dataset {
  const split = options.split ?? "public";
  const documents = loadCorpus();
  const queries = loadQueries(split);
  return {
    documents,
    queries,
    corpusHash: hashCorpus(documents),
    queriesHash: hashQueries(queries),
  };
}

export function loadCorpus(corpusDir: string = join(DATA_DIR, "corpus")): CorpusDocument[] {
  const jsonlPath = join(corpusDir, "corpus.jsonl");
  try {
    const raw = readFileSync(jsonlPath, "utf-8");
    const docs: CorpusDocument[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const doc = JSON.parse(trimmed) as CorpusDocument;
      docs.push(doc);
    }
    return docs.sort((a, b) => a.id.localeCompare(b.id));
  } catch {
    return loadCorpusFromMarkdown(corpusDir);
  }
}

function loadCorpusFromMarkdown(corpusDir: string): CorpusDocument[] {
  const files = readdirSync(corpusDir).filter((f) => f.endsWith(".md") && f !== "INDEX.md");
  const docs: CorpusDocument[] = [];
  for (const file of files.sort()) {
    const full = join(corpusDir, file);
    const raw = readFileSync(full, "utf-8");
    const parsed = parseMarkdownWithFrontmatter(raw);
    docs.push(parsed);
  }
  return docs;
}

function parseMarkdownWithFrontmatter(raw: string): CorpusDocument {
  const fmMatch = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!fmMatch || !fmMatch[1] || !fmMatch[2]) {
    throw new Error("Corpus markdown file missing YAML frontmatter with id and title");
  }
  const fm = fmMatch[1];
  const rest = fmMatch[2].trim();
  const fmFields: Record<string, string> = {};
  for (const line of fm.split("\n")) {
    const match = line.match(/^(\w+):\s*(.*)$/);
    if (match && match[1] && match[2] !== undefined) {
      fmFields[match[1]] = match[2].trim();
    }
  }
  const id = fmFields.id;
  const title = fmFields.title;
  if (!id || !title) {
    throw new Error("Corpus markdown file missing id or title in frontmatter");
  }
  const body = rest.replace(/^#\s+[^\n]+\n+/, "").trim();
  return { id, title, body };
}

export function loadQueries(
  split: "public" | "holdout" | "all" = "public",
  queriesDir: string = join(DATA_DIR, "queries"),
): BenchmarkQuery[] {
  const path = join(queriesDir, "queries.jsonl");
  const raw = readFileSync(path, "utf-8");
  const queries: BenchmarkQuery[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const q = JSON.parse(trimmed) as BenchmarkQuery;
    if (split === "all" || q.split === split) queries.push(q);
  }
  return queries;
}

function hashCorpus(docs: CorpusDocument[]): string {
  const canonical = docs
    .map((d) => `${d.id}\t${d.title}\t${d.body}`)
    .sort()
    .join("\n");
  return "sha256:" + createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}

function hashQueries(queries: BenchmarkQuery[]): string {
  const canonical = queries
    .map((q) => `${q.id}\t${q.question}\t${q.goldAnswer}\t${q.relevantDocs.join(",")}`)
    .sort()
    .join("\n");
  return "sha256:" + createHash("sha256").update(canonical).digest("hex").slice(0, 16);
}
