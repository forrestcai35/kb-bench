---
language:
- en
license: mit
size_categories:
- n<1K
task_categories:
- question-answering
- text-retrieval
task_ids:
- closed-domain-qa
- document-retrieval
pretty_name: kb-bench
tags:
- retrieval
- knowledge-base
- agent
- rag
- benchmark
configs:
- config_name: default
  data_files:
  - split: public
    path: queries/queries.jsonl
---

# kb-bench (dataset)

An open benchmark for agentic knowledge-base retrieval. This dataset bundles
20 fictional operational runbooks for a made-up SaaS company called "Acme"
and 20 matching questions, each annotated with the runbooks that contain the
answer.

The harness that drives an LLM agent against this dataset lives at
<https://github.com/forrestcai/kb-bench>. You can use the dataset
independently of the harness — it is just a small QA+retrieval corpus.

## Dataset structure

```
data/
├── corpus/
│   ├── corpus.jsonl     # one JSON doc per line: {id, title, body}
│   ├── INDEX.md         # human-readable table of contents
│   └── doc-*.md         # same documents, one markdown file per doc
└── queries/
    └── queries.jsonl    # one JSON query per line
```

### Corpus schema

```json
{"id": "doc-01-deploy-web", "title": "Deploying the Web App", "body": "..."}
```

- `id` — stable string id, used for retrieval-metric labels.
- `title` — human-readable title.
- `body` — the runbook content in plain markdown.

### Queries schema

```json
{
  "id": "q01-deploy-web",
  "question": "How do I deploy the web app to production?",
  "goldAnswer": "Run `npm run deploy:netlify:app` ...",
  "relevantDocs": ["doc-01-deploy-web"],
  "tags": ["devops", "deployment"],
  "split": "public"
}
```

- `question` — the user-facing question.
- `goldAnswer` — the reference answer used by LLM judges.
- `relevantDocs` — list of `corpus.id`s containing the answer. The
  evaluation harness uses this to compute recall/MRR/nDCG without needing
  an independent retriever.
- `tags` — loose subject categories.
- `split` — `public` (committed to the repo) or `holdout` (reserved, not
  committed).

## Splits

| split | count | notes |
| --- | ---: | --- |
| public | 20 | released with the repo |
| holdout | 0 | reserved for private evaluation, not committed |

## Intended uses

- **Agent benchmarks.** Drive an LLM against different knowledge bases that
  have been seeded with this corpus. Compare retrieval quality, token cost,
  latency, and answer correctness under a fair, blind LLM judge.
- **Retrieval model evaluation.** Use `queries.jsonl` + `corpus.jsonl` to
  evaluate an embedding model or BM25 baseline on recall@k / nDCG.
- **RAG-framework smoke tests.** A small, self-contained corpus that can
  exercise a RAG pipeline end-to-end in seconds.

## Dataset construction

All 20 documents were authored by the maintainers specifically for this
benchmark. No real companies, people, or internal systems are referenced —
the content describes a fictional SaaS platform called "Acme". This means:

- The corpus is safe to redistribute under MIT.
- There is no leakage risk from proprietary training data.
- The benchmark can be run in any environment without NDA concerns.

Each query was written jointly with the document it targets. Every question
has exactly one target document today, but the schema supports multiple
relevant documents per query.

## Known limitations

- 20 documents is a *micro-benchmark* — it cannot distinguish platforms
  that scale differently with corpus size. Retrieval differences widen on
  larger corpora.
- Gold answers are human-authored, single-draft. They reflect the
  maintainer's judgment about what a correct response looks like.
- LLM judges are noisy. Spot-check low scores; average across multiple
  runs.
- Contamination risk: the dataset is public. If you evaluate a model that
  was fine-tuned on this repo, treat results as training-set leakage, not
  evaluation.

## Citation

```bibtex
@software{kb_bench_2026,
  title = {kb-bench: An open benchmark for agentic knowledge-base retrieval},
  year  = {2026},
  url   = {https://github.com/forrestcai/kb-bench}
}
```

## License

MIT. See [LICENSE](../LICENSE).
