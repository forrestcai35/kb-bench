---
id: doc-16-worktree-policy
title: Worktree Policy
---

# Worktree Policy

For any multi-file feature work, use a **dedicated git worktree on a feature branch**. Do not edit `main` directly. The team tooling auto-creates worktrees under `.worktrees/`.

Worktrees are disposable — after merging, delete the branch and the worktree with `git worktree remove`.
