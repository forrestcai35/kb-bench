---
id: doc-15-search-fallback
title: Search Fallback Strategy
---

# Search Fallback Strategy

The `/api/v1/search` endpoint uses vector search by default. If vector search fails (embedding API timeout, HNSW error), the endpoint **falls back to PostgreSQL full-text search** against the `chunks.text` column, ranked by `ts_rank`.

The fallback returns the top-N chunks with a `fallback: true` flag in the response so clients can indicate degraded search to the user.
