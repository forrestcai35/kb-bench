---
id: doc-17-commit-style
title: Commit Message Style
---

# Commit Message Style

Commit messages follow Conventional Commits: `<type>: <imperative summary>`, lowercase, no trailing period, under 72 chars.

Valid types: `feat`, `fix`, `refactor`, `docs`, `test`, `chore`, `perf`. Scopes (e.g. `fix(api):`) are encouraged but not required.

Pull request titles follow the same rule. The squash-merge UI copies the PR title into the merge commit, so keep PR titles in the canonical form.
