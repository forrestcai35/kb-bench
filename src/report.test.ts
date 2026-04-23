import { describe, expect, it } from "vitest";
import { generateReport } from "./report.js";
import type { BenchmarkReport } from "./types.js";

function makeReport(overrides: Partial<BenchmarkReport> = {}): BenchmarkReport {
  return {
    runStartedAt: "2026-04-20T00:00:00Z",
    runCompletedAt: "2026-04-20T01:00:00Z",
    queries: [
      { id: "q1", question: "What?", goldAnswer: "Answer." },
    ],
    platforms: ["lore", "notion"],
    results: [
      {
        platform: "lore",
        queryId: "q1",
        question: "What?",
        answer: "Answer.",
        totalInputTokens: 1000,
        totalOutputTokens: 200,
        toolResultTokens: 300,
        totalLatencyMs: 2000,
        toolCallCount: 2,
        turns: 2,
        toolCalls: [],
      },
      {
        platform: "notion",
        queryId: "q1",
        question: "What?",
        answer: "Different answer.",
        totalInputTokens: 4000,
        totalOutputTokens: 250,
        toolResultTokens: 1200,
        totalLatencyMs: 5000,
        toolCallCount: 6,
        turns: 4,
        toolCalls: [],
      },
    ],
    verdicts: [
      { queryId: "q1", platform: "lore", score: 5, reasoning: "ok" },
      { queryId: "q1", platform: "notion", score: 3, reasoning: "partial" },
    ],
    ...overrides,
  };
}

describe("generateReport", () => {
  it("includes run metadata and platform summary header", () => {
    const md = generateReport(makeReport());
    expect(md).toContain("# Lore Knowledge Base Benchmark");
    expect(md).toContain("**Started:** 2026-04-20T00:00:00Z");
    expect(md).toContain("**Completed:** 2026-04-20T01:00:00Z");
    expect(md).toContain("**Queries:** 1");
    expect(md).toContain("**Platforms:** lore, notion");
    expect(md).toContain("## Platform Summary");
  });

  it("aggregates averages per platform and rounds to one decimal", () => {
    const report = makeReport({
      results: [
        {
          platform: "lore",
          queryId: "q1",
          question: "What?",
          answer: "A",
          totalInputTokens: 100,
          totalOutputTokens: 50,
          toolResultTokens: 10,
          totalLatencyMs: 1000,
          toolCallCount: 1,
          turns: 1,
          toolCalls: [],
        },
        {
          platform: "lore",
          queryId: "q1",
          question: "What?",
          answer: "B",
          totalInputTokens: 300,
          totalOutputTokens: 50,
          toolResultTokens: 20,
          totalLatencyMs: 3000,
          toolCallCount: 3,
          turns: 3,
          toolCalls: [],
        },
      ],
      verdicts: [
        { queryId: "q1", platform: "lore", score: 5, reasoning: "ok" },
        { queryId: "q1", platform: "lore", score: 4, reasoning: "ok" },
      ],
      platforms: ["lore"],
    });
    const md = generateReport(report);
    // Input token mean (100 + 300) / 2 = 200 → rendered as "200"
    expect(md).toMatch(/\| lore \| 4\.5\/5 \| 200 \|/);
  });

  it("renders ratios vs lore for non-lore platforms", () => {
    const md = generateReport(makeReport());
    expect(md).toContain("## Ratios vs Lore");
    // notion / lore input tokens = 4000 / 1000 = 4.00x
    expect(md).toMatch(/\| notion \| 4\.00x \|/);
  });

  it("omits ratios section when lore is not a platform", () => {
    const report = makeReport({
      platforms: ["notion"],
      results: [
        {
          platform: "notion",
          queryId: "q1",
          question: "What?",
          answer: "A",
          totalInputTokens: 100,
          totalOutputTokens: 50,
          toolResultTokens: 10,
          totalLatencyMs: 1000,
          toolCallCount: 1,
          turns: 1,
          toolCalls: [],
        },
      ],
      verdicts: [
        { queryId: "q1", platform: "notion", score: 3, reasoning: "ok" },
      ],
    });
    const md = generateReport(report);
    expect(md).not.toContain("## Ratios vs Lore");
  });

  it("reports errors as ERROR: ... in the per-query table and counts them in the platform summary", () => {
    const report = makeReport({
      results: [
        {
          platform: "lore",
          queryId: "q1",
          question: "What?",
          answer: "",
          totalInputTokens: 0,
          totalOutputTokens: 0,
          toolResultTokens: 0,
          totalLatencyMs: 0,
          toolCallCount: 0,
          turns: 0,
          toolCalls: [],
          error: "boom",
        },
      ],
      verdicts: [{ queryId: "q1", platform: "lore", score: 0, reasoning: "boom" }],
      platforms: ["lore"],
    });
    const md = generateReport(report);
    expect(md).toContain("ERROR: boom");
    // Error row should contribute to the errors column
    expect(md).toContain("| lore | 0/5 | 0 | 0 | 0 | 0 | 0 | 0 | 1 |");
  });

  it("renders (no run) when a platform is missing results for a query", () => {
    const report = makeReport({
      results: [
        // Only lore reports; notion is missing
        {
          platform: "lore",
          queryId: "q1",
          question: "What?",
          answer: "A",
          totalInputTokens: 100,
          totalOutputTokens: 50,
          toolResultTokens: 10,
          totalLatencyMs: 1000,
          toolCallCount: 1,
          turns: 1,
          toolCalls: [],
        },
      ],
    });
    const md = generateReport(report);
    expect(md).toContain("| notion | — | — | — | — | — | (no run) |");
  });

  it("truncates long answers with an ellipsis", () => {
    const longAnswer = "a".repeat(200);
    const report = makeReport({
      results: [
        {
          platform: "lore",
          queryId: "q1",
          question: "What?",
          answer: longAnswer,
          totalInputTokens: 1,
          totalOutputTokens: 1,
          toolResultTokens: 1,
          totalLatencyMs: 1,
          toolCallCount: 1,
          turns: 1,
          toolCalls: [],
        },
      ],
      verdicts: [{ queryId: "q1", platform: "lore", score: 5, reasoning: "ok" }],
      platforms: ["lore"],
    });
    const md = generateReport(report);
    // Truncation keeps 119 chars + the ellipsis character
    expect(md).toContain("…");
    expect(md).not.toContain(longAnswer);
  });

  it("escapes pipe characters and newlines in answers to keep the markdown table intact", () => {
    const report = makeReport({
      results: [
        {
          platform: "lore",
          queryId: "q1",
          question: "What?",
          answer: "answer with | pipe\nand newline",
          totalInputTokens: 1,
          totalOutputTokens: 1,
          toolResultTokens: 1,
          totalLatencyMs: 1,
          toolCallCount: 1,
          turns: 1,
          toolCalls: [],
        },
      ],
      verdicts: [{ queryId: "q1", platform: "lore", score: 5, reasoning: "ok" }],
      platforms: ["lore"],
    });
    const md = generateReport(report);
    expect(md).toContain("answer with \\| pipe and newline");
  });
});
