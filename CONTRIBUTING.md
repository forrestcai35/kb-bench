# Contributing to kb-bench

Thanks for your interest in extending the benchmark. The two highest-leverage
contributions are **new platform adapters** and **expanded corpora**.

## Ground rules

- No adapter gets a privileged system prompt. Tool descriptions should be
  structurally identical across adapters — only the wording that names what
  each tool returns should differ.
- Tool results must be returned verbatim. Do not summarize or filter raw
  payloads in the adapter; measuring "the raw platform experience" is the
  point.
- Every tool result must include `retrievedDocIds` so retrieval metrics are
  comparable across platforms.
- Do not add platform-specific logic to the agent, judge, or report
  generator. All platform-specific code lives in `src/adapters/<platform>.ts`.

## Adding a new adapter

### 1. Implement `PlatformAdapter`

Create `src/adapters/<platform>.ts`:

```ts
import type Anthropic from "@anthropic-ai/sdk";
import type { Config } from "../config.js";
import { renderSystemPrompt, type PlatformAdapter, type ToolExecutionResult } from "./base.js";

const TOOLS_DESCRIPTION = `- \`search\`(query, limit): semantic/full-text search. Returns an array of matches with id, title, and snippet.
- \`fetch\`(id): return the full content of a document by id.
- \`list\`(limit): list documents. Only use if search fails.`;

export class MyPlatformAdapter implements PlatformAdapter {
  readonly name = "myplatform";
  readonly systemPrompt = renderSystemPrompt(TOOLS_DESCRIPTION);
  readonly available: boolean;
  readonly unavailableReason?: string;

  constructor(config: Config) {
    // set this.available / this.unavailableReason based on env vars
  }

  readonly tools: Anthropic.Tool[] = [
    { name: "search", description: "...", input_schema: { /* ... */ } },
    { name: "fetch",  description: "...", input_schema: { /* ... */ } },
    { name: "list",   description: "...", input_schema: { /* ... */ } },
  ];

  async execute(toolName: string, input: Record<string, unknown>): Promise<ToolExecutionResult> {
    // call the platform API, return { text, retrievedDocIds }
  }
}
```

### 2. Register in `src/index.ts`

Add one line:

```ts
import { MyPlatformAdapter } from "./adapters/myplatform.js";
// ...
const allAdapters: PlatformAdapter[] = [
  // ...
  new MyPlatformAdapter(config),
];
```

### 3. Add a `seed*` branch in `scripts/seed.ts`

The seed script reads `data/corpus/` and pushes every document to the target
platform. Use whatever native write API the platform has, converting
markdown → the platform's storage format as needed.

### 4. Add env vars

- Extend the `Config` interface in `src/config.ts` with a new section.
- Add the variables to `.env.example` with comments describing what they are
  and where to find them.

### 5. Test

```bash
npm run seed -- --platform myplatform
npm run bench -- --platforms myplatform --queries q01-deploy-web
```

Verify the result markdown shows reasonable recall and tokens. If recall is
0, the adapter isn't returning `retrievedDocIds` correctly.

### 6. Document

Add a row to the "Supported platforms" table in the README.

## Extending the corpus

`data/corpus/corpus.jsonl` is the source of truth. Each line is a
JSON-encoded `{ id, title, body }` record. If you edit the corpus, remember:

- The `id` must be stable across runs (it's what retrieval metrics are
  computed against).
- The `body` should be self-contained — no cross-references to other
  documents, no external URLs.
- After editing the corpus, update `data/corpus/INDEX.md` to match.
- The corpus hash embedded in result files will change. Old results cannot
  be compared to new results without caveat.

If you want to add documents for specific retrieval styles (ambiguous
titles, distractors, duplicate facts across docs), add them — the corpus is
intentionally small and simple, and more interesting failure modes are
welcome.

## Extending the queries

`data/queries/queries.jsonl` is the source of truth. Every query must
include:

```jsonc
{
  "id": "q-unique-id",
  "question": "The question as the user would ask it.",
  "goldAnswer": "The reference answer, used by the judge only.",
  "relevantDocs": ["doc-id-1", "doc-id-2"],
  "tags": ["category", "difficulty"],
  "split": "public"
}
```

- `relevantDocs` must reference real ids in `corpus.jsonl`.
- `split: "holdout"` is reserved for a private test set. Only public split
  entries are committed to the repo.

## Running tests

```bash
npm run typecheck
npm run test
```

The unit tests cover report generation, retrieval metrics, summary stats,
judge sanitization, and pricing. An adapter-level integration test suite is
intentionally *not* included — live platform credentials and seeded data are
prerequisites, so integration testing is manual (`npm run bench -- --queries
q01-deploy-web`).

## Releasing

1. Bump `version` in `package.json` (semver).
2. Update `environment.benchVersion` gets set automatically from the
   package.json version.
3. Tag the release: `git tag v0.x.0 && git push --tags`.
