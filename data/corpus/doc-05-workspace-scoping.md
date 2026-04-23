---
id: doc-05-workspace-scoping
title: Workspace Scoping for API Routes
---

# Workspace Scoping for API Routes

Every API route **must** be scoped to the active workspace. Always use `getActiveWorkspace()` from `@/lib/db/workspace` — it reads the `acme-workspace` cookie and falls back to the user's first `workspace_members` row.

Never query `workspace_members` directly with `.limit(1).single()` — that ignores the cookie and returns an arbitrary workspace, causing data to leak across workspaces.

`ActiveWorkspace` returns `{ id, workspace_id, role }` where `id` is the membership row id.
