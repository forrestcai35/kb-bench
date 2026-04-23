---
id: doc-08-pat-lifecycle
title: Personal Access Tokens (PATs)
---

# Personal Access Tokens (PATs)

Each user has at most **one active PAT** at a time. Tokens are stored as SHA-256 hashes in the `personal_access_tokens` table (never the raw token).

Creating a new PAT via `POST /api/user/pat` invalidates any existing PAT for that user. The response is the only time the raw token is visible.

PATs do not expire on a schedule — only explicit rotation invalidates them. Users can rotate via `acme auth rotate` in the CLI.
