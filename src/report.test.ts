import { describe, expect, it } from "vitest";
import { generateReport } from "./report.js";
import { sanitizeAnswer } from "./judge.js";
import { computeRetrievalMetrics } from "./retrieval.js";
import { summarize } from "./stats.js";
import { pricingForModel, computeCost } from "./pricing.js";
import type { BenchmarkQuery, BenchmarkReport, QueryMetrics } from "./types.js";

function makeEnv(): BenchmarkReport["environment"] {
  return {
    model: "claude-opus-4-7",
    judgeModel: "claude-opus-4-7",
    effort: "high",
    maxTurns: 10,
    maxTokens: 16000,
    runsPerQuery: 1,
    retries: 3,
    topK: 5,
    pricePerMillion: { input: 15, output: 75 },
    sdkVersion: "0.90.0",
    nodeVersion: "v20.0.0",
    corpusHash: "sha256:abc123",
    queriesHash: "sha256:def456",
    benchVersion: "0.2.0",
  };
}

function makeQuery(overrides: Partial<BenchmarkQuery> = {}): BenchmarkQuery {
  return {
    id: "q1",
    question: "What?",
    goldAnswer: "Answer.",
    relevantDocs: ["doc-01"],
    tags: [],
    split: "public",
    ...overrides,
  };
}

function makeResult(overrides: Partial<QueryMetrics> = {}): QueryMetrics {
  return {
    platform: "alpha",
    queryId: "q1",
    run: 1,
    question: "What?",
    answer: "Answer.",
    totalInputTokens: 1000,
    totalOutputTokens: 200,
    toolResultTokens: 300,
    totalLatencyMs: 2000,
    toolCallCount: 2,
    turns: 2,
    toolCalls: [],
    retrieval: {
      retrievedDocs: ["doc-01"],
      firstRelevantRank: 1,
      recall: 1,
      precision: 1,
      reciprocalRank: 1,
      ndcg: 1,
    },
    cost: { inputUsd: 0.015, outputUsd: 0.015, totalUsd: 0.03 },
    ...overrides,
  };
}

function makeReport(overrides: Partial<BenchmarkReport> = {}): BenchmarkReport {
  return {
    runStartedAt: "2026-04-20T00:00:00Z",
    runCompletedAt: "2026-04-20T01:00:00Z",
    environment: makeEnv(),
    queries: [makeQuery()],
    platforms: ["alpha", "beta"],
    results: [
      makeResult({ platform: "alpha" }),
      makeResult({
        platform: "beta",
        answer: "Different answer.",
        totalInputTokens: 4000,
        totalOutputTokens: 250,
        toolResultTokens: 1200,
        totalLatencyMs: 5000,
        toolCallCount: 6,
        turns: 4,
        retrieval: {
          retrievedDocs: ["doc-02", "doc-01"],
          firstRelevantRank: 2,
          recall: 1,
          precision: 0.5,
          reciprocalRank: 0.5,
          ndcg: 0.63,
        },
        cost: { inputUsd: 0.06, outputUsd: 0.02, totalUsd: 0.08 },
      }),
    ],
    verdicts: [
      { queryId: "q1", platform: "alpha", run: 1, score: 5, reasoning: "ok" },
      { queryId: "q1", platform: "beta", run: 1, score: 3, reasoning: "partial" },
    ],
    ...overrides,
  };
}

describe("generateReport", () => {
  it("includes run metadata and platform summary header", () => {
    const md = generateReport(makeReport());
    expect(md).toContain("# kb-bench results");
    expect(md).toContain("**Started:** 2026-04-20T00:00:00Z");
    expect(md).toContain("**Completed:** 2026-04-20T01:00:00Z");
    expect(md).toContain("**Queries:** 1");
    expect(md).toContain("**Platforms:** alpha, beta");
    expect(md).toContain("**Corpus hash:** sha256:abc123");
    expect(md).toContain("## Platform summary");
  });

  it("reports recall and MRR per platform", () => {
    const md = generateReport(makeReport());
    expect(md).toMatch(/\| alpha \| 5\.00\/5 \| 1\.00 \| 1\.00/);
    expect(md).toMatch(/\| beta \| 3\.00\/5 \| 1\.00 \| 0\.50/);
  });

  it("omits relative comparison table when no baseline is provided", () => {
    const md = generateReport(makeReport());
    expect(md).toContain("No baseline selected");
  });

  it("renders ratios vs the chosen baseline", () => {
    const md = generateReport(makeReport(), { baseline: "alpha" });
    expect(md).toMatch(/\| beta \| 4\.00x \|/);
  });

  it("reports errors with errorType in the per-query table", () => {
    const report = makeReport({
      results: [
        makeResult({
          platform: "alpha",
          answer: "",
          totalInputTokens: 0,
          totalOutputTokens: 0,
          toolResultTokens: 0,
          totalLatencyMs: 0,
          toolCallCount: 0,
          turns: 0,
          error: "boom",
          errorType: "rate_limit",
        }),
      ],
      verdicts: [{ queryId: "q1", platform: "alpha", run: 1, score: 0, reasoning: "boom" }],
      platforms: ["alpha"],
    });
    const md = generateReport(report);
    expect(md).toContain("ERROR [rate_limit]: boom");
    expect(md).toContain("## Error breakdown");
  });

  it("renders (no run) when a platform is missing results for a query", () => {
    const report = makeReport({
      results: [makeResult({ platform: "alpha" })],
    });
    const md = generateReport(report);
    expect(md).toContain("| beta | — | — | — | — | — | — | — | (no run) |");
  });

  it("truncates long answers with an ellipsis", () => {
    const long = "a".repeat(200);
    const report = makeReport({
      results: [makeResult({ platform: "alpha", answer: long })],
      platforms: ["alpha"],
      verdicts: [{ queryId: "q1", platform: "alpha", run: 1, score: 5, reasoning: "ok" }],
    });
    const md = generateReport(report);
    expect(md).toContain("…");
    expect(md).not.toContain(long);
  });

  it("averages metrics across runs for multi-run reports", () => {
    const report = makeReport({
      environment: { ...makeEnv(), runsPerQuery: 2 },
      results: [
        makeResult({ platform: "alpha", run: 1, totalInputTokens: 100 }),
        makeResult({ platform: "alpha", run: 2, totalInputTokens: 300 }),
      ],
      verdicts: [
        { queryId: "q1", platform: "alpha", run: 1, score: 5, reasoning: "ok" },
        { queryId: "q1", platform: "alpha", run: 2, score: 4, reasoning: "ok" },
      ],
      platforms: ["alpha"],
    });
    const md = generateReport(report);
    expect(md).toContain("4.5");
    expect(md).toMatch(/\| alpha \| 4\.50 ± \d/);
  });
});

describe("sanitizeAnswer", () => {
  it("scrubs platform names to keep judge blind", () => {
    expect(sanitizeAnswer("Found in Notion under Runbooks.")).toBe("Found in [KB] under Runbooks.");
    expect(sanitizeAnswer("Lore's search returned one hit.")).toBe("[KB]'s search returned one hit.");
    expect(sanitizeAnswer("Per my Obsidian vault notes.")).toBe("Per my [KB] [KB] notes.");
  });

  it("leaves answers without platform names unchanged", () => {
    const text = "Run npm run deploy to ship the web app.";
    expect(sanitizeAnswer(text)).toBe(text);
  });
});

describe("computeRetrievalMetrics", () => {
  it("computes recall, precision, MRR and nDCG", () => {
    const m = computeRetrievalMetrics(["a", "b", "c"], ["b", "d"]);
    expect(m.recall).toBeCloseTo(0.5);
    expect(m.precision).toBeCloseTo(1 / 3);
    expect(m.reciprocalRank).toBeCloseTo(0.5);
    expect(m.firstRelevantRank).toBe(2);
    const idealDcg = 1 + 1 / Math.log2(3);
    expect(m.ndcg).toBeCloseTo(1 / Math.log2(3) / idealDcg, 2);
  });

  it("returns zero metrics when nothing relevant is retrieved", () => {
    const m = computeRetrievalMetrics(["a", "b"], ["c"]);
    expect(m.recall).toBe(0);
    expect(m.reciprocalRank).toBe(0);
    expect(m.firstRelevantRank).toBeNull();
    expect(m.ndcg).toBe(0);
  });

  it("deduplicates retrieved ids before scoring", () => {
    const m = computeRetrievalMetrics(["a", "a", "b"], ["b"]);
    expect(m.retrievedDocs).toEqual(["a", "b"]);
    expect(m.reciprocalRank).toBeCloseTo(0.5);
  });
});

describe("summarize", () => {
  it("handles empty and single-value inputs", () => {
    expect(summarize([])).toEqual({ n: 0, mean: 0, stddev: 0, ci95: 0, min: 0, max: 0 });
    const one = summarize([5]);
    expect(one.mean).toBe(5);
    expect(one.ci95).toBe(0);
  });

  it("produces a positive 95% CI for multi-value inputs", () => {
    const s = summarize([1, 2, 3, 4, 5]);
    expect(s.mean).toBe(3);
    expect(s.ci95).toBeGreaterThan(0);
  });
});

describe("pricing", () => {
  it("computes cost for known models", () => {
    const p = pricingForModel("claude-opus-4-7");
    const cost = computeCost(1_000_000, 1_000_000, p);
    expect(cost.totalUsd).toBeCloseTo(90);
  });

  it("falls back to family defaults for unknown model ids", () => {
    const p = pricingForModel("claude-opus-0-0-test");
    expect(p.inputPerMillion).toBe(15);
  });
});
