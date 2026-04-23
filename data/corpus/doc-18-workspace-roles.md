---
id: doc-18-workspace-roles
title: Workspace Roles
---

# Workspace Roles

Four roles exist on `workspace_members.role`:
- **owner** — full admin, can delete the workspace
- **admin** — manage members, manage settings
- **editor** — create and edit documents
- **viewer** — read-only access

The first member of a workspace is automatically `owner`. Only an `owner` can promote another member to `owner`, and a workspace must always have at least one `owner`.
