---
id: doc-04-embeddings
title: Embedding Model Selection
---

# Embedding Model Selection

Acme uses **`gemini-embedding-001`** (Google) for all vector embeddings. We evaluated this model against `text-embedding-3-small` (OpenAI) and `voyage-2` in March 2026.

Gemini won on two axes:
1. Multilingual runbooks (our Japanese and German content retrieved with higher MRR).
2. Cost — ~40% cheaper per 1M tokens at our current volume.

The embedding dimension is 768. The HNSW index parameters are tuned for this dimensionality.
