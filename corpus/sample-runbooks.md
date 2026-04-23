# Lore Benchmark Corpus

A self-contained set of operational runbooks used to seed each platform (Lore, Notion, Google Docs, Guru) with identical content before running the benchmark. Copy/paste each section as a separate document/page/card in the target platform, or run the platform-specific ingest script.

---

## Deploying the Web App

To deploy the web app to production, run `npm run deploy:netlify:app` from the repo root. The script wraps the Netlify CLI and requires the `NETLIFY_AUTH_TOKEN` env var to be set. It deploys the `apps/web` build artifact to the `lore-app` Netlify site.

Staging deploys use `npm run deploy:netlify:app -- --alias=staging`. CI runs a preview deploy on every PR via the Netlify GitHub app.

---

## Node Version Policy

The project targets **Node 20 LTS**. Node 22 is known to break the Waterfall Rust build because of a runtime mismatch between napi-rs and the N-API header bundled in Node 22.x. The root `.nvmrc` pins 20. CI uses `actions/setup-node@v4` with `node-version-file: .nvmrc`.

If you see a `symbol not found: napi_*` error during `cargo build`, your local Node is likely 22 — switch to 20.

---

## On-Call Rotation (Q2 2026)

**Billing incidents**
- Primary: Maya Chen (`@maya`) — through Q2 2026
- Secondary: Dmitri Park (`@dmitri`)

**Ingest pipeline**
- Primary: Priya Shah
- Secondary: Jordan Lee

Rotation updates go in `#oncall-schedule` every Friday. The PagerDuty schedule is `lore-core-primary`.

---

## Embedding Model Selection

Lore uses **`gemini-embedding-001`** (Google) for all vector embeddings. We evaluated this model against `text-embedding-3-small` (OpenAI) and `voyage-2` in March 2026.

Gemini won on two axes:
1. Multilingual runbooks (our Japanese and German content retrieved with higher MRR).
2. Cost — ~40% cheaper per 1M tokens at our current volume.

The embedding dimension is 768. The HNSW index parameters are tuned for this dimensionality.

---

## Workspace Scoping for API Routes

Every API route **must** be scoped to the active workspace. Always use `getActiveWorkspace()` from `@/lib/db/workspace` — it reads the `lore-workspace` cookie and falls back to the user's first `workspace_members` row.

Never query `workspace_members` directly with `.limit(1).single()` — that ignores the cookie and returns an arbitrary workspace, causing data to leak across workspaces.

`ActiveWorkspace` returns `{ id, workspace_id, role }` where `id` is the membership row id.

---

## Supabase Migration Workflow

Migrations live in `supabase/migrations/` and are the only mechanism for changing production schema.

1. Author a dated migration (e.g. `20260418220000_add_chunks_index.sql`).
2. Apply it to prod via the Supabase dashboard or CLI.
3. Regenerate `supabase/reset-and-setup.sql` so it reflects the new prod state. Either fold the change into the relevant `CREATE TABLE` / `CREATE POLICY` block, or regenerate via `pg_dump`.

`reset-and-setup.sql` is a flat snapshot of prod. Drift between it and the live database is a bug.

---

## Ingest Rate Limits

The `/api/v1/ingest` endpoint is rate-limited to **60 requests per minute per PAT**. Excess requests return HTTP 429 with a `Retry-After` header.

Waterfall and the CLI both coalesce short text captures client-side to stay under the limit. The coalescing window is 2 seconds.

---

## Personal Access Tokens (PATs)

Each user has at most **one active PAT** at a time. Tokens are stored as SHA-256 hashes in the `personal_access_tokens` table (never the raw token).

Creating a new PAT via `POST /api/user/pat` invalidates any existing PAT for that user. The response is the only time the raw token is visible.

PATs do not expire on a schedule — only explicit rotation invalidates them. Users can rotate via `lore auth rotate` in the CLI.

---

## Typography Symlink Quirk

`apps/web/styles/typography.css` is a **symlink**, not a regular file. This is a workaround for a webpack resolver bug in Next.js 15 where a certain combination of CSS modules and Tailwind `@layer` directives fails to resolve unless the file is a symlink.

**Do not delete the symlink.** Do not replace it with a regular file. If you need to change typography styles, edit the target of the symlink.

---

## Dedup Threshold

The ingest pipeline dedups incoming captures against existing chunks in the same workspace. A new capture is merged into an existing document when the **cosine similarity is ≥ 0.92** against any chunk in that workspace.

Below 0.92, the capture creates a new document. The merge updates the existing doc's `updated_at` and appends the capture's source to the doc's provenance array.

---

## Vector Index Configuration

The `chunks.embedding` column uses an **HNSW index** via `pgvector`:
- `m = 16`
- `ef_construction = 64`
- `ef_search = 40` (set per session)

Index was chosen over IVFFlat because recall at our scale (~5M chunks) is noticeably better for HNSW at similar query times.

---

## Waterfall Capture Transport

The Waterfall desktop app sends captures via HTTPS `POST /api/v1/ingest`. Authentication priority:
1. **Supabase JWT** (preferred, auto-refresh in-app)
2. **PAT** (fallback for legacy installs)

The JWT is stored in the system keychain. Short-text captures (< 200 chars) are batch-buffered for up to 2 seconds before being sent as a single request.

---

## Slack Bot Permissions

The ingestion Slack bot requires these scopes:
- `channels:history` — read public channel messages
- `groups:history` — read private channel messages (invite required)
- `chat:write` — post replies with captured excerpts
- `users:read` — resolve user IDs to display names

The bot must be explicitly added to every channel it should monitor (`/invite @lore-bot`).

---

## Data Retention

Raw `ingestion_logs` rows are retained for **30 days**, then pruned by the daily cron at **03:00 UTC**. Synthesized documents are retained indefinitely.

Vector embeddings are re-computed if the source document is edited — the stale embeddings are deleted from the `chunks` table.

---

## Search Fallback Strategy

The `/api/v1/search` endpoint uses vector search by default. If vector search fails (embedding API timeout, HNSW error), the endpoint **falls back to PostgreSQL full-text search** against the `chunks.text` column, ranked by `ts_rank`.

The fallback returns the top-N chunks with a `fallback: true` flag in the response so clients can indicate degraded search to the user.

---

## Worktree Policy

For any multi-file feature work, use a **dedicated git worktree on a feature branch**. Do not edit `main` directly. The `/delegate` command auto-creates worktrees under `.claude/worktrees/`.

Worktrees are disposable — after merging, delete the branch and the worktree with `git worktree remove`.

---

## Git Attribution

Commits and PRs must never include `Co-Authored-By` trailers referencing Claude, Anthropic, or any AI account. The `.claude/settings.local.json` file keeps the `commit` and `pr` attribution fields empty.

Commit messages follow Conventional Commits: `<type>: <imperative summary>`, lowercase, no trailing period, under 72 chars.

---

## Workspace Roles

Four roles exist on `workspace_members.role`:
- **owner** — full admin, can delete the workspace
- **admin** — manage members, manage settings
- **editor** — create and edit documents
- **viewer** — read-only access

The first member of a workspace is automatically `owner`. Only an `owner` can promote another member to `owner`, and a workspace must always have at least one `owner`.

---

## Ingest Chunking

The ingest pipeline splits documents into chunks of **approximately 500 tokens** with a **50-token overlap**. Chunking is section-aware — splits prefer heading boundaries (h1/h2/h3) so a chunk doesn't span two logically-unrelated sections.

Token counting uses the `tiktoken` `cl100k_base` encoding for compatibility with older eval scripts, even though the production embedding model is Gemini.

---

## Slack Thread Synthesis

When the Slack bot receives a `/lore capture` command on a thread, the thread is piped to the **synthesis worker**, which calls **Claude Opus** with a structured-output schema:

```json
{
  "title": "...",
  "summary": "...",
  "steps": ["...", "..."],
  "tags": ["...", "..."]
}
```

The structured output is validated against a Zod schema, then ingested as a new document with `source: "slack-synth"` and a provenance pointer to the original Slack thread.

If the synthesis output fails validation, the raw thread is captured unchanged with `needs_review: true`.
