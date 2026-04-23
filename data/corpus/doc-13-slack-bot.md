---
id: doc-13-slack-bot
title: Slack Bot Permissions
---

# Slack Bot Permissions

The ingestion Slack bot requires these scopes:
- `channels:history` — read public channel messages
- `groups:history` — read private channel messages (invite required)
- `chat:write` — post replies with captured excerpts
- `users:read` — resolve user IDs to display names

The bot must be explicitly added to every channel it should monitor (`/invite @acme-bot`).
