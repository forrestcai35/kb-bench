---
id: doc-07-rate-limits
title: Ingest Rate Limits
---

# Ingest Rate Limits

The `/api/v1/ingest` endpoint is rate-limited to **60 requests per minute per PAT**. Excess requests return HTTP 429 with a `Retry-After` header.

The Capture desktop client and CLI both coalesce short text captures client-side to stay under the limit. The coalescing window is 2 seconds.
