---
id: doc-14-retention
title: Data Retention
---

# Data Retention

Raw `ingestion_logs` rows are retained for **30 days**, then pruned by the daily cron at **03:00 UTC**. Synthesized documents are retained indefinitely.

Vector embeddings are re-computed if the source document is edited — the stale embeddings are deleted from the `chunks` table.
