---
id: doc-10-dedup-threshold
title: Dedup Threshold
---

# Dedup Threshold

The ingest pipeline dedups incoming captures against existing chunks in the same workspace. A new capture is merged into an existing document when the **cosine similarity is ≥ 0.92** against any chunk in that workspace.

Below 0.92, the capture creates a new document. The merge updates the existing doc's `updated_at` and appends the capture's source to the doc's provenance array.
