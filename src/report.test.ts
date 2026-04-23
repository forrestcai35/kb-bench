import { describe, expect, it } from "vitest";
import { generateReport } from "./report.js";
import { sanitizeAnswer } from "./judge.js";
import { computeRetrievalMetrics } from "./retrieval.js";
import { summarize } from "./stats.js";
import { pricingForModel, computeCost } from "./pricing.js";
import { computeJudgeAgreement } from "./agreement.js";
import { parseScore, familyOfModel } from "./judges/base.js";
import type { BenchmarkQuery, BenchmarkReport, JudgeVerdict, QueryMetrics } from "./types.js";

function makeEnv(): BenchmarkReport["environment"] {
  return {
    model: "claude-opus-4-7",
    judgeModels: ["anthropic:claude-opus-4-7", "openai:gpt-4.1", "google:gemini-2.5-pro"],
    excludeSameFamilyJudge: true,
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
    benchVersion: "0.3.0",
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

function makeVerdict(
  platform: string,
  scores: Record<string, number>,
  overrides: Partial<JudgeVerdict> = {},
): JudgeVerdict {
  const entries = Object.entries(scores);
  const values = entries.map(([, v]) => v);
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const sorted = [...values].sort((a, b) => a - b);
  const median = sorted.length % 2 === 1
    ? sorted[(sorted.length - 1) / 2]!
    : (sorted[sorted.length / 2 - 1]! + sorted[sorted.length / 2]!) / 2;
  const variance = values.length <= 1
    ? 0
    : values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
  return {
    queryId: "q1",
    platform,
    run: 1,
    score: mean,
    meanScore: mean,
    medianScore: median,
    stddev: Math.sqrt(variance),
    reasoning: "ok",
    perJudge: entries.map(([judgeId, score]) => {
      const [family, model] = judgeId.split(":");
      return {
        judgeId,
        model: model ?? judgeId,
        family: family ?? "unknown",
        score,
        reasoning: "ok",
      };
    }),
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
      makeVerdict("alpha", { "openai:gpt-4.1": 5, "google:gemini-2.5-pro": 5 }),
      makeVerdict("beta", { "openai:gpt-4.1": 3, "google:gemini-2.5-pro": 4 }),
    ],
    ...overrides,
  };
}

describe("generateReport", () => {
  it("includes run metadata and the jury panel", () => {
    const md = generateReport(makeReport());
    expect(md).toContain("# kb-bench results");
    expect(md).toContain("**Judge panel:** anthropic:claude-opus-4-7, openai:gpt-4.1, google:gemini-2.5-pro");
    expect(md).toContain("**Same-family judge excluded:** true");
    expect(md).toContain("**Corpus hash:** sha256:abc123");
  });

  it("renders both mean and median jury scores per platform", () => {
    const md = generateReport(makeReport());
    expect(md).toMatch(/\| alpha \| 5\.00\/5/);
    expect(md).toMatch(/\| beta \| 3\.50\/5/);
  });

  it("renders a per-judge breakdown table", () => {
    const md = generateReport(makeReport());
    expect(md).toContain("## Per-judge score breakdown");
    expect(md).toContain("openai:gpt-4.1");
    expect(md).toContain("google:gemini-2.5-pro");
  });

  it("renders inter-judge agreement stats when >=2 judges scored", () => {
    const md = generateReport(makeReport());
    expect(md).toContain("Krippendorff's α");
    expect(md).toContain("Mean pairwise Pearson");
  });

  it("omits relative comparison when no baseline given", () => {
    const md = generateReport(makeReport());
    expect(md).toContain("No baseline selected");
  });

  it("renders ratios when baseline is chosen", () => {
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
      verdicts: [makeVerdict("alpha", { "openai:gpt-4.1": 0, "google:gemini-2.5-pro": 0 })],
      platforms: ["alpha"],
    });
    const md = generateReport(report);
    expect(md).toContain("ERROR [rate_limit]: boom");
    expect(md).toContain("## Error breakdown");
  });
});

describe("sanitizeAnswer", () => {
  it("scrubs platform names to keep judges blind", () => {
    expect(sanitizeAnswer("Found in Notion under Runbooks.")).toBe("Found in [KB] under Runbooks.");
    expect(sanitizeAnswer("Lore's search returned one hit.")).toBe("[KB]'s search returned one hit.");
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

describe("computeJudgeAgreement", () => {
  it("returns NaN-like results when fewer than two judges scored", () => {
    const agreement = computeJudgeAgreement([
      makeVerdict("alpha", { "openai:gpt-4.1": 4 }),
    ]);
    expect(agreement.judges.length).toBe(1);
    expect(Number.isNaN(agreement.krippendorffAlpha)).toBe(true);
  });

  it("returns perfect agreement when all judges give identical scores", () => {
    const verdicts = [
      makeVerdict("alpha", { "openai:gpt-4.1": 5, "google:gemini-2.5-pro": 5 }),
      makeVerdict("beta", { "openai:gpt-4.1": 3, "google:gemini-2.5-pro": 3 }),
    ];
    const agreement = computeJudgeAgreement(verdicts);
    expect(agreement.krippendorffAlpha).toBeCloseTo(1, 2);
  });

  it("returns lower agreement when judges disagree", () => {
    const verdicts = [
      makeVerdict("alpha", { "openai:gpt-4.1": 5, "google:gemini-2.5-pro": 2 }),
      makeVerdict("beta", { "openai:gpt-4.1": 1, "google:gemini-2.5-pro": 4 }),
    ];
    const agreement = computeJudgeAgreement(verdicts);
    expect(agreement.krippendorffAlpha).toBeLessThan(0.5);
  });
});

describe("judge helpers", () => {
  it("parses well-formed JSON scores", () => {
    const parsed = parseScore('{"score": 4, "reasoning": "good"}');
    expect(parsed.score).toBe(4);
    expect(parsed.reasoning).toBe("good");
  });

  it("clamps out-of-range scores", () => {
    expect(parseScore('{"score": 99, "reasoning": ""}').score).toBe(5);
    expect(parseScore('{"score": -3, "reasoning": ""}').score).toBe(0);
  });

  it("falls back to 0 on unparsable output", () => {
    const parsed = parseScore("no json here");
    expect(parsed.score).toBe(0);
    expect(parsed.reasoning).toContain("Unparsable");
  });

  it("maps model names to families", () => {
    expect(familyOfModel("claude-opus-4-7")).toBe("anthropic");
    expect(familyOfModel("gpt-4.1")).toBe("openai");
    expect(familyOfModel("o3")).toBe("openai");
    expect(familyOfModel("gemini-2.5-pro")).toBe("google");
    expect(familyOfModel("mistral-large")).toBeNull();
  });
});
