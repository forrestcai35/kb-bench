# Knowledge Base Benchmark Harness

Measures how efficiently an LLM agent can answer operational questions against **Lore**, **Notion**, **Confluence**, and **Obsidian** using each platform's standard agent-facing tools.

The benchmark runs a manual Claude Opus 4.7 agentic loop over a fixed corpus of 20 ops runbooks and records, per platform and per query:

- Total input tokens consumed by the agent
- Total output tokens produced
- **Tool-result tokens** — how much raw platform payload the agent was forced to read
- Wall-clock latency
- Number of tool calls / turns
- Final answer (scored 0–5 by an LLM judge)

The primary thesis this harness validates is:

> An agent querying Lore reads materially fewer tokens and finishes faster than the same agent querying Notion, Confluence, or Obsidian for the same question with the same corpus.

## Why this design

- **Identical corpus across platforms.** `corpus/sample-runbooks.md` is the source of truth. Each platform is seeded with the same runbooks so the only variable is the retrieval interface.
- **Single agent loop, swappable adapters.** The agent is one Claude Opus 4.7 loop; each `PlatformAdapter` exposes the tools that platform natively offers an agent (Lore's semantic-chunk `search_knowledge_base`, Notion's page-level `search_pages` + `get_page_content`, etc.). Differences in measured tokens and latency come from the tools, not the model.
- **Manual loop, not SDK tool runner.** We need per-tool-call token visibility — the high-level tool runner hides it.
- **No prompt caching.** `cache_control` is not set anywhere. Cache hits would skew comparative measurements across platforms.
- **LLM judge uses the same model.** The judge scores 0–5 on correctness. It does not see which platform produced the answer.

## Setup

### 1. Install

```bash
cd benchmarks
npm install
```

### 2. Environment variables

Required — provide **one** of these so the agent and judge can call Claude:

```bash
# Preferred if you have Claude Max — folds benchmark spend into your
# subscription instead of burning pay-per-token API credits.
export ANTHROPIC_AUTH_TOKEN=<oauth_token>       # or CLAUDE_CODE_OAUTH_TOKEN
# Fallback: regular API key.
export ANTHROPIC_API_KEY=sk-ant-...
```

If both are set, the OAuth token wins. OAuth requests are sent with
`anthropic-beta: oauth-2025-04-20` automatically.

Per platform (only set the ones you want to benchmark):

```bash
# Lore (bench/judge — PAT path)
export LORE_API_URL=https://lightfield.app            # default
export LORE_API_KEY=lore_pat_...
export LORE_WORKSPACE_ID=<workspace_uuid>             # scope queries to a dedicated workspace

# Lore (seed only — direct Supabase insert, same pattern as apps/blog-writer)
export SUPABASE_URL=https://<project>.supabase.co
export SUPABASE_SERVICE_ROLE_KEY=<service_role_key>
export LORE_USER_ID=<user_uuid>                        # author of the seeded documents
export LORE_BENCHMARK_FOLDER_NAME=Benchmarks           # optional; folder is created if missing
export LORE_AUTHOR="Benchmark Seed"                    # optional; display author on rows
export LORE_CLI_API_KEY=<cli_key>                      # POST /api/admin/backfill-sections to index seeded docs; falls back to LORE_API_KEY

# Notion
export NOTION_TOKEN=secret_...
export NOTION_PARENT_PAGE_ID=<parent_page_id>         # parent page the seed script creates runbooks under

# Confluence
export CONFLUENCE_BASE_URL=https://<site>.atlassian.net
export CONFLUENCE_EMAIL=<atlassian_account_email>
export CONFLUENCE_API_TOKEN=<api_token>               # id.atlassian.com → Security → API tokens
export CONFLUENCE_SPACE_KEY=<SPACEKEY>                # the KEY from /wiki/spaces/<KEY>/..., not the name
export CONFLUENCE_PARENT_PAGE_ID=<page_id>            # optional; nest seeded runbooks under this page

# Obsidian (via the Local REST API community plugin — https://github.com/coddingtonbear/obsidian-local-rest-api)
# Install the plugin, open its settings, and EITHER enable "Enable Non-encrypted (HTTP) Server"
# (recommended for benchmarking — port 27123) OR keep the default HTTPS on 27124 and set
# OBSIDIAN_INSECURE_TLS=true below to trust the self-signed cert.
export OBSIDIAN_API_URL=http://127.0.0.1:27123        # default; use https://127.0.0.1:27124 for the default HTTPS server
export OBSIDIAN_API_KEY=<api_key_from_plugin_settings>
export OBSIDIAN_VAULT_FOLDER=Benchmarks               # optional; vault-relative folder seeded runbooks go under
export OBSIDIAN_INSECURE_TLS=true                     # optional; only required when OBSIDIAN_API_URL is https:// with a self-signed cert
```

Optional tuning:

```bash
export BENCH_MODEL=claude-opus-4-7           # default
export BENCH_EFFORT=high                     # low|medium|high|xhigh|max
export BENCH_MAX_TOKENS=16000                # per-call max_tokens
export BENCH_MAX_TURNS=10                    # stop runaway loops
```

Platforms missing credentials are auto-skipped.

### 3. Seed each platform

Instead of copy-pasting by hand, the seed script reads `corpus/sample-runbooks.md`, splits on `---`, and pushes each section to the target platform via its write API:

```bash
npm run seed -- --platform lore
npm run seed -- --platform notion
npm run seed -- --platform confluence
npm run seed -- --platform obsidian
```

Per-platform notes:

- **Lore** inserts rows directly into the `documents` table via the Supabase service role (same mechanism as `apps/blog-writer`). Each section becomes one document in the `LORE_BENCHMARK_FOLDER_NAME` folder, authored by `LORE_USER_ID`. This bypasses the ingest API's dedup + PAT-auth entirely — appropriate because the benchmark harness is internal tooling, not a product surface. After the inserts finish, the script calls `POST /api/admin/backfill-sections` (bearer = `LORE_CLI_API_KEY`, falls back to `LORE_API_KEY`) on the configured `LORE_API_URL` to populate `document_section` / `document_section_chunk`. The server does the embedding via Gemini `gemini-embedding-001`, rotating through `FREE_GEMINI_API_KEY_*` env vars on quota errors.
- **Notion** calls `pages.create` under `NOTION_PARENT_PAGE_ID`. The integration token must have that parent page shared with it. Markdown is converted to Notion blocks (headings, bullets, numbered lists, paragraphs).
- **Confluence** resolves `CONFLUENCE_SPACE_KEY` → numeric `spaceId` via v2 API, then `POST /wiki/api/v2/pages` per runbook with markdown converted to Confluence storage-format XHTML (headings, bulleted/numbered lists, paragraphs, inline `<strong>` and `<code>`). Auth is basic (email + API token). No storage-quota gotchas. If `CONFLUENCE_PARENT_PAGE_ID` is set, pages nest under it; otherwise they land at the space root.
- **Obsidian** requires the vault to be open in the desktop app with the Local REST API plugin running. Seed `PUT`s each section as `<OBSIDIAN_VAULT_FOLDER>/<title>.md` via `PUT /vault/<path>` — Obsidian picks up the new files on the fly (no reindex step). Because the plugin listens on localhost only, the benchmark must be run from the same machine as Obsidian. The vault's built-in search powers `search_vault` at query time; there is no separate indexing call.

Use fresh, dedicated surfaces on each platform (new workspace / parent page / vault folder) so unrelated content doesn't contaminate search results.

## Run

All platforms, all queries:

```bash
npm run bench
```

A subset:

```bash
npm run bench -- --platforms lore,notion,obsidian --queries q01-deploy-web,q05-workspace-scoping
```

Custom output directory:

```bash
npm run bench -- --out results/2026-04-20-run1
```

Results land in `results/bench-<timestamp>.json` (raw) and `results/bench-<timestamp>.md` (formatted).

## Interpreting the report

The markdown report has:

1. **Platform summary** — averaged metrics per platform.
2. **Ratios vs Lore** — how much more (or less) each competitor consumes vs Lore on the same queries.
3. **Per-query breakdown** — one table per query showing how each platform performed on that specific question.

Tool-result tokens is usually the most discriminating metric: it's the raw payload each platform dumps into the model's context before the model reasons about it.

## Adding a new platform

1. Implement `PlatformAdapter` in `src/adapters/<platform>.ts`.
2. Register it in `src/index.ts`.
3. Extend the README's env var section.
4. If the platform needs seeding, add a `seedX()` branch in `scripts/seed.ts`.

Rules of thumb:

- The `tools` array should mirror what a realistic agent sees when calling that platform (the MCP server, official API wrappers, or similar).
- `execute(toolName, input)` returns the raw string the LLM will see as `tool_result`. Do **not** summarize or strip content — that defeats the benchmark.
- If the platform's API requires pagination to fetch full content, honor that in the adapter. The point is to measure _realistic_ agent usage.

## Caveats

- **Corpus size.** 20 runbooks is small. Differences widen with bigger corpora because Notion/Docs responses grow with doc count more than Lore's chunked retrieval does.
- **Network latency.** Add `--runs N` averaging once latency numbers stabilize across warm runs (currently a single run per query per platform).
- **Judge variance.** The LLM judge is deterministic-ish but not perfect. Spot-check low scores before drawing strong conclusions.
- **No rate-limit handling.** Long runs may hit platform rate limits; add backoff if needed.
- **Obsidian runs locally.** The Local REST API plugin binds to loopback only, so the harness must run on the same machine as Obsidian — network latency on that hop is effectively zero and will bias latency-based comparisons in Obsidian's favor. Token-count comparisons are unaffected.
