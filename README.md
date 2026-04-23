# kb-bench

**An open benchmark for agentic knowledge-base retrieval.**

`kb-bench` drives a single LLM agent against a shared, fictional operational
corpus, swapping only the *knowledge base the agent queries* between runs, and
records what it takes the agent to correctly answer the same 20 questions from
each one.

For every (platform, query, run) triple it records:

- **Correctness** — a mean score 0–5 from a **cross-family jury** of LLM
  judges (Anthropic + OpenAI + Google by default). The candidate's own family
  is excluded from its own panel to mitigate self-preference bias. Judges
  never see which platform produced an answer, and platform names are
  scrubbed from the candidate answer before scoring.
- **Retrieval quality** — recall, precision, MRR, and nDCG against annotated
  gold documents. The agent's tool calls are inspected, not its prose.
- **Cost** — input tokens, output tokens, and **tool-result tokens** (how much
  raw payload the platform forced the agent to read), mapped to USD via a
  pricing table.
- **Work** — wall-clock latency, tool-call count, agentic turns.
- **Failure modes** — categorized error types (rate limit, API, tool, timeout,
  no-answer, unknown).

There is no privileged platform. The reference runbook set is a made-up SaaS
company called "Acme". Every adapter must implement the same three tools
(`search`, `fetch`, `list`) and is driven by the same system-prompt template.
Relative comparisons (one platform as a denominator) are opt-in via
`--baseline <platform>`.

## Design principles

The benchmark is useful only to the extent that it is *fair*. These are the
invariants — if you find one being violated, please open an issue.

1. **Identical corpus across platforms.** `data/corpus/` is canonical. The
   `seed` script pushes the same documents to every platform; the corpus
   hash is embedded in every result file.
2. **Identical system prompt.** All adapters produce their system prompt from
   `renderSystemPrompt(toolsDescription)` in `src/adapters/base.ts`. Only the
   tool signature lines differ.
3. **Identical tool contract.** Every adapter exposes exactly `search`,
   `fetch`, and `list` with matching parameter schemas. Tool descriptions are
   structurally the same.
4. **Blind cross-family jury.** Scoring uses a panel of ≥3 LLM judges from
   different providers, aggregated by mean. The candidate's own family is
   dropped from its own panel. This mitigates self-preference bias, which is
   a well-documented LLM-as-judge failure mode
   ([Panickssery et al., 2024](https://arxiv.org/abs/2404.13076);
   [Verga et al., 2024](https://arxiv.org/abs/2404.18796)). Judges never see
   the platform name, and the candidate answer is additionally scrubbed of
   platform identifiers (`Notion`, `Obsidian`, etc.) before scoring.
5. **No prompt caching.** `cache_control` is deliberately unset; cache hits
   would skew comparative measurements.
6. **Deterministic-ish but measured.** Pass `--runs N` to average across N
   runs; the report renders 95% confidence intervals whenever N ≥ 2.
7. **Reproducibility metadata.** The corpus hash, query hash, model, SDK
   version, node version, and benchmark version are recorded in every run.
   Any two runs with matching hashes used the same inputs.

## Supported platforms

| Platform | Tools exposed | Notes |
| --- | --- | --- |
| Lore | `search`, `fetch`, `list` | REST API with PAT auth. Reference adapter. |
| Notion | `search`, `fetch`, `list` | Uses the Notion SDK (`pages.create`, `search`, `blocks.children.list`). |
| Confluence | `search`, `fetch`, `list` | CQL search, v2 pages API. |
| Obsidian | `search`, `fetch`, `list` | Local REST API plugin, loopback only. |

Adding a new platform is a single adapter file — see
[CONTRIBUTING.md](./CONTRIBUTING.md).

## Quickstart

```bash
git clone https://github.com/forrestcai/kb-bench
cd kb-bench
npm install
cp .env.example .env
# fill in at least ANTHROPIC_AUTH_TOKEN (or ANTHROPIC_API_KEY)
# + credentials for at least one platform
npm run seed -- --platform notion         # once per platform
npm run bench -- --runs 3                 # all platforms, 3 runs each
```

Results land in `results/bench-<timestamp>.json` (raw) and
`results/bench-<timestamp>.md` (formatted).

## Dataset

The dataset lives in `data/`:

```
data/
├── corpus/
│   ├── INDEX.md              # human-readable table of contents
│   ├── corpus.jsonl          # {id, title, body} per line — canonical form
│   └── doc-*.md              # same corpus, one markdown file per doc
└── queries/
    └── queries.jsonl         # {id, question, goldAnswer, relevantDocs, ...}
```

**20 documents, 20 queries.** Each query is annotated with the document id(s)
that contain the answer — this is what makes retrieval metrics possible
without running an independent retriever.

**Split.** Today all 20 queries are in the `public` split. A `holdout` split
is reserved for future private evaluation (we will not commit it to the repo).
Pass `--split holdout` or `--split all` if you have extended the dataset.

**Corpus content.** Every runbook is a fictional operational document for a
made-up SaaS company called "Acme". No real companies, people, or internal
URLs are referenced. The corpus is MIT-licensed along with the code.

## CLI

```bash
# All platforms available, all queries, 1 run each (default)
npm run bench

# Subset of platforms + queries
npm run bench -- --platforms lore,notion --queries q01-deploy-web,q05-workspace-scoping

# Multi-run with a baseline in the report
npm run bench -- --runs 5 --baseline notion

# Public split (default) vs private holdout set
npm run bench -- --split public
npm run bench -- --split holdout

# Re-render a report from an existing json
npm run report -- results/bench-....json --baseline lore
```

Every platform missing credentials is auto-skipped with a `[skip]` message.

### Seeding

```bash
npm run seed -- --platform lore
npm run seed -- --platform notion
npm run seed -- --platform confluence
npm run seed -- --platform obsidian
```

Use fresh, dedicated surfaces on each platform (a new workspace / parent page /
vault folder) so unrelated content doesn't contaminate search results.

## Interpreting the report

The generated markdown has four sections:

### 1. Platform summary

Mean values across runs with 95% confidence intervals. Columns:

- `Score` — judge 0–5 (mean of N runs × 20 queries).
- `Recall`, `MRR`, `nDCG` — retrieval quality of the tool calls the agent
  made, vs the documents labelled relevant for each question.
- `Input tokens`, `Output tokens`, `Tool-result tokens` — LLM input, LLM
  output, and raw tool payload read by the model.
- `Latency` — wall-clock per query.
- `Tool calls`, `Turns` — count of tool invocations and agentic turns.
- `Cost` — mapped to USD via `src/pricing.ts`. Edit that file to reflect your
  own contract / subscription.
- `Errors` — count of runs that failed.

### 2. Relative comparison

Only rendered when `--baseline <platform>` is set. Values > 1.0 mean the
other platform consumes more of that metric than the baseline; < 1.0 means
less. `kb-bench` does not choose a baseline for you — there is no "winner" by
default.

### 3. Error breakdown

Per-platform counts by error type. Only rendered if any run errored.

### 4. Per-query breakdown

One table per query. Useful for spot-checking: low scores are often judge
quirks rather than genuine failures.

## Methodology

### Agent loop

The agent is a manual loop in `src/agent.ts`:

1. Send the question + system prompt + tool definitions to Claude.
2. If the model returns `tool_use`, invoke the tool on the adapter, count the
   raw result tokens, record the retrieved document ids, append the tool
   result, and loop.
3. Stop on `end_turn`, `stop_sequence`, or after `BENCH_MAX_TURNS` (default
   10) turns.
4. If the model never emits a final answer, the run is recorded with
   `errorType: "no_answer"`.

All API and tool calls are retried with exponential backoff (with a hint from
`Retry-After`) on rate limits, connection errors, and 5xx. `BENCH_RETRIES`
controls the count.

### Judging — cross-family jury

`kb-bench` uses an **LLM-as-a-jury** setup rather than a single-judge setup.
Single-judge setups are biased toward outputs of the judge's own family (the
"self-preference" bias, formally measured in
[Panickssery et al., 2024](https://arxiv.org/abs/2404.13076)); multi-judge
panels from different providers correlate better with humans at a lower
cost ([Verga et al., "Replacing Judges with Juries," 2024](https://arxiv.org/abs/2404.18796)).

**Default panel:**

| Judge | Env var | Model |
| --- | --- | --- |
| Anthropic | `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_API_KEY` | `claude-opus-4-7` |
| OpenAI | `OPENAI_API_KEY` | `gpt-4.1` |
| Google | `GOOGLE_API_KEY` / `GEMINI_API_KEY` | `gemini-2.5-pro` |

Override the panel with `BENCH_JUDGE_MODELS` (comma-separated). Each model
is routed to the SDK that matches its prefix (`claude-*` → Anthropic,
`gpt-*` / `o*` → OpenAI, `gemini-*` → Google).

Every judge sees the same prompt:

- The question
- The reference answer from `queries.jsonl`
- The candidate answer, with platform identifiers scrubbed to `[KB]`

The judge does not see which platform produced the candidate. It scores 0–5
on factual correctness only.

**Aggregation.** Scores are combined by arithmetic mean across non-excluded
judges. The report also shows the median and the cross-judge standard
deviation so you can spot rows where the panel disagreed.

**Same-family exclusion.** If the candidate model's family (e.g.,
`claude-opus-4-7` → `anthropic`) matches a judge's family, that judge is
excluded from the panel for all queries in that run. Disable with
`BENCH_EXCLUDE_SAME_FAMILY_JUDGE=false` if you have a reason to keep the
same-family judge in the panel (e.g., intentional ablation).

**Inter-judge agreement.** Every report includes Krippendorff's α
(interval) and the mean pairwise Pearson correlation across judges. Typical
interpretation: α ≥ 0.80 is strong, 0.67–0.80 is tentative, anything below
0.67 is reader-level disagreement — small platform differences on that run
should not be treated as decisive.

**Single-judge fallback.** If only one provider's credentials are set, the
benchmark will run with a single-judge panel and log a warning. The report
still works; you just lose the self-preference mitigation and the agreement
stats.

### Retrieval metrics

Every adapter is required to return a set of document ids with every tool
result (`ToolExecutionResult.retrievedDocIds`). The benchmark collects those
ids in call order, deduplicates, and computes:

- **Recall** — fraction of `relevantDocs` the agent's tools surfaced.
- **Precision** — fraction of retrieved docs that are relevant.
- **MRR** — reciprocal rank of the first relevant doc in the dedup'd list.
- **nDCG** — discounted-cumulative-gain normalization with binary relevance.

These are orthogonal to the judge score: a platform can retrieve the correct
document but the model can still answer incorrectly (or vice versa).

### Cost

Token counts are mapped to USD using `src/pricing.ts`. The defaults reflect
list prices as of 2026-04. If you run on a different contract, edit the
pricing table; the benchmark does not hardcode any discount.

## Known limitations

- **Corpus size.** 20 documents is small. Platforms whose response size scales
  with corpus size (Notion, Confluence) may look better than they would on
  an enterprise-scale corpus.
- **Judge variance.** Even a cross-family jury is noisier than expert human
  evaluation. For public comparisons use `--runs N ≥ 3`, inspect the
  per-judge breakdown for disagreement, and spot-check low-scoring rows
  against the reference answer.
- **Single model family.** Current adapters and the agent loop use the
  Anthropic SDK. Porting the agent loop to OpenAI / Gemini is in scope —
  contributions welcome.
- **Obsidian is loopback-only.** The Local REST API plugin binds to
  127.0.0.1, so `kb-bench` must run on the same machine as Obsidian. Latency
  comparisons involving Obsidian are biased in its favor (near-zero network
  RTT); token comparisons are not affected.
- **Seeding is not idempotent.** Running `seed` twice creates duplicates.
  Seed into a fresh, dedicated workspace / parent page / vault folder.
- **Confluence storage format is verbose.** Confluence returns XHTML storage
  format; Notion returns JSON blocks. Token counts include that overhead,
  which is the intended "realistic agent experience" measurement.

## Contributing

New adapters, expanded corpora, alternative judges, and additional agent
frameworks are all welcome. See [CONTRIBUTING.md](./CONTRIBUTING.md).

## Citation

If you use this benchmark, please cite:

```bibtex
@software{kb_bench_2026,
  title = {kb-bench: An open benchmark for agentic knowledge-base retrieval},
  year  = {2026},
  url   = {https://github.com/forrestcai/kb-bench}
}
```

## License

MIT. See [LICENSE](./LICENSE).
