---
id: doc-19-chunking
title: Ingest Chunking
---

# Ingest Chunking

The ingest pipeline splits documents into chunks of **approximately 500 tokens** with a **50-token overlap**. Chunking is section-aware — splits prefer heading boundaries (h1/h2/h3) so a chunk doesn't span two logically-unrelated sections.

Token counting uses the `tiktoken` `cl100k_base` encoding for compatibility with older eval scripts, even though the production embedding model is Gemini.
