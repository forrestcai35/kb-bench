import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { summarize, type Summary } from "./stats.js";
import type { BenchmarkReport, JudgeVerdict, QueryMetrics } from "./types.js";

interface PlatformAggregate {
  platform: string;
  runs: number;
  queries: number;
  inputTokens: Summary;
  outputTokens: Summary;
  toolResultTokens: Summary;
  latencyMs: Summary;
  toolCalls: Summary;
  turns: Summary;
  score: Summary;
  recall: Summary;
  mrr: Summary;
  ndcg: Summary;
  costUsd: Summary;
  errors: number;
  errorByType: Record<string, number>;
}

function fmt(n: number, digits = 1): string {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(digits);
}

function fmtCi(summary: Summary, digits = 1): string {
  if (summary.n === 0) return "—";
  if (summary.n === 1) return fmt(summary.mean, digits);
  return `${fmt(summary.mean, digits)} ± ${fmt(summary.ci95, digits)}`;
}

function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return "—";
  return `$${n.toFixed(4)}`;
}

function aggregate(report: BenchmarkReport): PlatformAggregate[] {
  return report.platforms.map((platform) => {
    const rows = report.results.filter((r) => r.platform === platform);
    const verdicts = report.verdicts.filter((v) => v.platform === platform);
    const valid = rows.filter((r) => !r.error);
    const errorByType: Record<string, number> = {};
    for (const row of rows) {
      if (!row.error) continue;
      const key = row.errorType ?? "unknown";
      errorByType[key] = (errorByType[key] ?? 0) + 1;
    }
    const uniqueQueryIds = new Set(rows.map((r) => r.queryId)).size;
    return {
      platform,
      runs: rows.length,
      queries: uniqueQueryIds,
      inputTokens: summarize(valid.map((r) => r.totalInputTokens)),
      outputTokens: summarize(valid.map((r) => r.totalOutputTokens)),
      toolResultTokens: summarize(valid.map((r) => r.toolResultTokens)),
      latencyMs: summarize(valid.map((r) => r.totalLatencyMs)),
      toolCalls: summarize(valid.map((r) => r.toolCallCount)),
      turns: summarize(valid.map((r) => r.turns)),
      score: summarize(verdicts.map((v) => v.score)),
      recall: summarize(valid.map((r) => r.retrieval.recall)),
      mrr: summarize(valid.map((r) => r.retrieval.reciprocalRank)),
      ndcg: summarize(valid.map((r) => r.retrieval.ndcg)),
      costUsd: summarize(valid.map((r) => r.cost.totalUsd)),
      errors: rows.length - valid.length,
      errorByType,
    };
  });
}

export interface GenerateOptions {
  baseline?: string | null;
}

export function generateReport(report: BenchmarkReport, options: GenerateOptions = {}): string {
  const aggregates = aggregate(report);
  const requestedBaseline = options.baseline ?? null;
  const baseline = requestedBaseline
    ? aggregates.find((a) => a.platform === requestedBaseline) ?? null
    : null;

  const lines: string[] = [];
  lines.push("# kb-bench results");
  lines.push("");
  lines.push(`**Started:** ${report.runStartedAt}  `);
  lines.push(`**Completed:** ${report.runCompletedAt}  `);
  lines.push(`**Queries:** ${report.queries.length}  `);
  lines.push(`**Platforms:** ${report.platforms.join(", ")}  `);
  lines.push(`**Runs per query:** ${report.environment.runsPerQuery}  `);
  lines.push(`**Agent model:** ${report.environment.model} (effort: ${report.environment.effort})  `);
  lines.push(`**Judge model:** ${report.environment.judgeModel}  `);
  lines.push(`**Corpus hash:** ${report.environment.corpusHash}  `);
  lines.push(`**Queries hash:** ${report.environment.queriesHash}  `);
  lines.push(`**Bench version:** ${report.environment.benchVersion}  `);
  lines.push("");

  lines.push("## Platform summary");
  lines.push("");
  lines.push("Values show mean across all runs, with the 95% confidence interval (`±`) when ≥2 runs per query were executed.");
  lines.push("");
  lines.push(
    "| Platform | Score | Recall | MRR | nDCG | Input tokens | Output tokens | Tool-result tokens | Latency (ms) | Tool calls | Turns | Cost (USD) | Errors |",
  );
  lines.push(
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |",
  );
  for (const a of aggregates) {
    lines.push(
      `| ${a.platform} | ${fmtCi(a.score, 2)}/5 | ${fmtCi(a.recall, 2)} | ${fmtCi(a.mrr, 2)} | ${fmtCi(a.ndcg, 2)} | ${fmtCi(a.inputTokens, 0)} | ${fmtCi(a.outputTokens, 0)} | ${fmtCi(a.toolResultTokens, 0)} | ${fmtCi(a.latencyMs, 0)} | ${fmtCi(a.toolCalls, 2)} | ${fmtCi(a.turns, 2)} | ${fmtUsd(a.costUsd.mean)} | ${a.errors} |`,
    );
  }
  lines.push("");

  lines.push("## Relative comparison");
  lines.push("");
  if (baseline) {
    lines.push(`Ratios are relative to \`${baseline.platform}\`. Values > 1.0 mean the platform uses more of that metric than the baseline; < 1.0 means less.`);
    lines.push("");
    lines.push("| Platform | Input tokens | Tool-result tokens | Latency | Tool calls | Cost |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: |");
    for (const a of aggregates) {
      if (a.platform === baseline.platform) continue;
      lines.push(
        `| ${a.platform} | ${fmtRatio(baseline.inputTokens.mean, a.inputTokens.mean)} | ${fmtRatio(baseline.toolResultTokens.mean, a.toolResultTokens.mean)} | ${fmtRatio(baseline.latencyMs.mean, a.latencyMs.mean)} | ${fmtRatio(baseline.toolCalls.mean, a.toolCalls.mean)} | ${fmtRatio(baseline.costUsd.mean, a.costUsd.mean)} |`,
      );
    }
  } else {
    lines.push("No baseline selected. Pass `--baseline <platform>` to include ratios between platforms.");
  }
  lines.push("");

  const hasErrors = aggregates.some((a) => a.errors > 0);
  if (hasErrors) {
    lines.push("## Error breakdown");
    lines.push("");
    lines.push("| Platform | rate_limit | api_error | tool_error | timeout | no_answer | unknown |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const a of aggregates) {
      const e = a.errorByType;
      lines.push(
        `| ${a.platform} | ${e.rate_limit ?? 0} | ${e.api_error ?? 0} | ${e.tool_error ?? 0} | ${e.timeout ?? 0} | ${e.no_answer ?? 0} | ${e.unknown ?? 0} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Per-query breakdown");
  lines.push("");
  lines.push("Averaged across runs (for `--runs > 1`). Score is the mean judge score; retrieval shows recall against the annotated gold docs.");
  lines.push("");
  for (const query of report.queries) {
    lines.push(`### ${query.id} — ${query.question}`);
    lines.push("");
    lines.push(`Relevant doc(s): ${query.relevantDocs.join(", ")}`);
    lines.push("");
    lines.push("| Platform | Score | Recall | Input | Tool-result | Latency (ms) | Tool calls | Cost | Sample answer |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const platform of report.platforms) {
      const rows = report.results.filter((r) => r.queryId === query.id && r.platform === platform);
      const verdicts = report.verdicts.filter((v) => v.queryId === query.id && v.platform === platform);
      if (rows.length === 0) {
        lines.push(`| ${platform} | — | — | — | — | — | — | — | (no run) |`);
        continue;
      }
      const valid = rows.filter((r) => !r.error);
      const inputSummary = summarize(valid.map((r) => r.totalInputTokens));
      const trSummary = summarize(valid.map((r) => r.toolResultTokens));
      const latSummary = summarize(valid.map((r) => r.totalLatencyMs));
      const callsSummary = summarize(valid.map((r) => r.toolCallCount));
      const recallSummary = summarize(valid.map((r) => r.retrieval.recall));
      const scoreSummary = summarize(verdicts.map((v) => v.score));
      const costSummary = summarize(valid.map((r) => r.cost.totalUsd));
      const firstAnswer = valid[0]?.answer ?? "(error)";
      const err = rows.find((r) => r.error);
      const sample = err
        ? `ERROR [${err.errorType ?? "unknown"}]: ${err.error}`
        : truncate(firstAnswer.replace(/\|/g, "\\|").replace(/\n/g, " "), 120);
      lines.push(
        `| ${platform} | ${fmt(scoreSummary.mean, 2)}/5 | ${fmt(recallSummary.mean, 2)} | ${fmt(inputSummary.mean, 0)} | ${fmt(trSummary.mean, 0)} | ${fmt(latSummary.mean, 0)} | ${fmt(callsSummary.mean, 2)} | ${fmtUsd(costSummary.mean)} | ${sample} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function fmtRatio(baseline: number, other: number): string {
  if (!baseline || !other) return "—";
  return `${(other / baseline).toFixed(2)}x`;
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function writeReport(jsonPath: string, mdPath: string, baseline?: string | null): void {
  const report = JSON.parse(readFileSync(jsonPath, "utf-8")) as BenchmarkReport;
  writeFileSync(mdPath, generateReport(report, { baseline }), "utf-8");
}

const ENTRYPOINT_URL = `file://${resolve(process.argv[1] ?? "")}`;
if (import.meta.url === ENTRYPOINT_URL) {
  const args = process.argv.slice(2);
  let jsonPath: string | undefined;
  let mdPath: string | undefined;
  let baseline: string | null = null;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--baseline" && args[i + 1]) {
      baseline = args[++i] ?? null;
    } else if (!jsonPath) {
      jsonPath = arg;
    } else if (!mdPath) {
      mdPath = arg;
    }
  }
  mdPath = mdPath ?? jsonPath?.replace(/\.json$/, ".md");
  if (!jsonPath || !mdPath) {
    console.error("Usage: tsx src/report.ts <results.json> [report.md] [--baseline <platform>]");
    process.exit(1);
  }
  writeReport(jsonPath, mdPath, baseline);
  console.log(`Wrote ${mdPath}`);
}
