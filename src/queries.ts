import type { BenchmarkQuery } from "./types.js";

export const QUERIES: BenchmarkQuery[] = [
  {
    id: "q01-deploy-web",
    question: "How do I deploy the web app to production?",
    goldAnswer: "Run `npm run deploy:netlify:app` from the repo root. Requires the NETLIFY_AUTH_TOKEN env var.",
  },
  {
    id: "q02-node-version",
    question: "What Node version does the project require and why?",
    goldAnswer: "Node 20 LTS. Node 22 breaks the waterfall Rust build due to a mismatch with the napi-rs runtime.",
  },
  {
    id: "q03-oncall-billing",
    question: "Who is on-call for billing incidents this quarter?",
    goldAnswer: "Maya Chen is primary on-call for billing through Q2 2026; Dmitri Park is secondary.",
  },
  {
    id: "q04-embeddings-model",
    question: "Which embedding model do we use and why?",
    goldAnswer: "gemini-embedding-001 (Google). Chosen over text-embedding-3 because it handles our multilingual runbooks and costs ~40% less at our volume.",
  },
  {
    id: "q05-workspace-scoping",
    question: "How are API routes scoped to a workspace?",
    goldAnswer: "Every API route calls getActiveWorkspace() from @/lib/db/workspace. It reads the lore-workspace cookie and falls back to the user's first membership.",
  },
  {
    id: "q06-migration-workflow",
    question: "What's the workflow for applying a Supabase schema change?",
    goldAnswer: "1) Author a dated migration in supabase/migrations/. 2) Apply it to prod. 3) Regenerate supabase/reset-and-setup.sql so it reflects the new prod state.",
  },
  {
    id: "q07-rate-limit-ingest",
    question: "What's the ingest rate limit for the /api/v1/ingest endpoint?",
    goldAnswer: "60 requests per minute per PAT. Waterfall captures are coalesced client-side to stay under the limit.",
  },
  {
    id: "q08-pat-lifecycle",
    question: "How do PATs (Personal Access Tokens) work?",
    goldAnswer: "One active PAT per user. Stored as a SHA-256 hash in the personal_access_tokens table. Rotating via POST /api/user/pat invalidates the previous token.",
  },
  {
    id: "q09-typography-symlink",
    question: "Why is apps/web/styles/typography.css a symlink?",
    goldAnswer: "It's a workaround for a webpack resolver bug in the Next.js build. Do not delete the symlink or replace it with a regular file.",
  },
  {
    id: "q10-dedup-threshold",
    question: "What's the dedup threshold for the ingest pipeline?",
    goldAnswer: "Cosine similarity >= 0.92 against existing chunks in the same workspace merges the capture into the existing document instead of creating a new one.",
  },
  {
    id: "q11-vector-index",
    question: "What vector index does Lore use?",
    goldAnswer: "Supabase pgvector with an HNSW index (m=16, ef_construction=64) on the chunks.embedding column.",
  },
  {
    id: "q12-waterfall-transport",
    question: "How does the waterfall desktop app send captures?",
    goldAnswer: "HTTPS POST to /api/v1/ingest with a Supabase JWT (preferred) or PAT (fallback) in the Authorization header. Short text is batch-buffered before ingest.",
  },
  {
    id: "q13-slack-bot-permissions",
    question: "What Slack scopes does the ingestion bot require?",
    goldAnswer: "channels:history, groups:history, chat:write, and users:read. The bot requires the channel to be explicitly added.",
  },
  {
    id: "q14-retention-policy",
    question: "What's the data retention policy for raw ingestion logs?",
    goldAnswer: "Raw ingestion_logs rows are retained for 30 days, then pruned by the daily cron job at 03:00 UTC.",
  },
  {
    id: "q15-search-fallback",
    question: "What happens if vector search fails during a query?",
    goldAnswer: "The search endpoint falls back to postgres full-text search (tsvector) on the chunks.text column, returning the top-N by ts_rank.",
  },
  {
    id: "q16-worktree-policy",
    question: "What's our policy for git worktrees?",
    goldAnswer: "Use a dedicated git worktree on a feature branch for any multi-file feature work. Do not edit main directly.",
  },
  {
    id: "q17-co-author-attribution",
    question: "Should AI co-author trailers be included in commits?",
    goldAnswer: "No. Never include Co-Authored-By trailers referencing Claude, Anthropic, or any AI account. Attribution settings must keep commit and pr fields empty.",
  },
  {
    id: "q18-permission-roles",
    question: "What workspace roles exist and what can each do?",
    goldAnswer: "owner (full admin, can delete workspace), admin (manage members and settings), editor (create/edit docs), viewer (read-only).",
  },
  {
    id: "q19-capture-chunk-size",
    question: "What chunk size does the ingest pipeline use?",
    goldAnswer: "Approximately 500 tokens per chunk with a 50-token overlap. Chunks are section-aware — splits prefer heading boundaries.",
  },
  {
    id: "q20-llm-synthesis",
    question: "How are Slack threads turned into runbooks?",
    goldAnswer: "The thread is piped to the synthesis worker, which calls Claude Opus with a structured-output schema to produce {title, summary, steps, tags}. The result is ingested as a new document.",
  },
];
