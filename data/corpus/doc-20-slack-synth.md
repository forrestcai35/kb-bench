---
id: doc-20-slack-synth
title: Slack Thread Synthesis
---

# Slack Thread Synthesis

When the Slack bot receives an `/acme capture` command on a thread, the thread is piped to the **synthesis worker**, which calls a large language model with a structured-output schema:

```json
{
  "title": "...",
  "summary": "...",
  "steps": ["...", "..."],
  "tags": ["...", "..."]
}
```

The structured output is validated against a Zod schema, then ingested as a new document with `source: "slack-synth"` and a provenance pointer to the original Slack thread.

If the synthesis output fails validation, the raw thread is captured unchanged with `needs_review: true`.
