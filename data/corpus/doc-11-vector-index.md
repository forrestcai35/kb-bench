---
id: doc-11-vector-index
title: Vector Index Configuration
---

# Vector Index Configuration

The `chunks.embedding` column uses an **HNSW index** via `pgvector`:
- `m = 16`
- `ef_construction = 64`
- `ef_search = 40` (set per session)

Index was chosen over IVFFlat because recall at our scale (~5M chunks) is noticeably better for HNSW at similar query times.
