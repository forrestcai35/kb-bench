---
id: doc-06-migrations
title: Supabase Migration Workflow
---

# Supabase Migration Workflow

Migrations live in `supabase/migrations/` and are the only mechanism for changing production schema.

1. Author a dated migration (e.g. `20260418220000_add_chunks_index.sql`).
2. Apply it to prod via the Supabase dashboard or CLI.
3. Regenerate `supabase/reset-and-setup.sql` so it reflects the new prod state. Either fold the change into the relevant `CREATE TABLE` / `CREATE POLICY` block, or regenerate via `pg_dump`.

`reset-and-setup.sql` is a flat snapshot of prod. Drift between it and the live database is a bug.
