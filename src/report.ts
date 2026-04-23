import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { BenchmarkReport, JudgeVerdict, QueryMetrics } from "./types.js";

interface PlatformAggregate {
  platform: string;
  queries: number;
  avgInputTokens: number;
  avgOutputTokens: number;
  avgToolResultTokens: number;
  avgLatencyMs: number;
  avgToolCalls: number;
  avgTurns: number;
  avgScore: number;
  errors: number;
}

function mean(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((a, b) => a + b, 0) / nums.length;
}

function round(num: number, digits = 1): number {
  const mult = 10 ** digits;
  return Math.round(num * mult) / mult;
}

function aggregate(report: BenchmarkReport): PlatformAggregate[] {
  return report.platforms.map((platform) => {
    const rows = report.results.filter((r) => r.platform === platform);
    const verdicts = report.verdicts.filter((v) => v.platform === platform);
    const valid = rows.filter((r) => !r.error);
    return {
      platform,
      queries: rows.length,
      avgInputTokens: round(mean(valid.map((r) => r.totalInputTokens))),
      avgOutputTokens: round(mean(valid.map((r) => r.totalOutputTokens))),
      avgToolResultTokens: round(mean(valid.map((r) => r.toolResultTokens))),
      avgLatencyMs: round(mean(valid.map((r) => r.totalLatencyMs))),
      avgToolCalls: round(mean(valid.map((r) => r.toolCallCount)), 2),
      avgTurns: round(mean(valid.map((r) => r.turns)), 2),
      avgScore: round(mean(verdicts.map((v) => v.score)), 2),
      errors: rows.length - valid.length,
    };
  });
}

function fmtRatio(baseline: number, other: number): string {
  if (baseline === 0 || other === 0) return "—";
  const ratio = other / baseline;
  return `${ratio.toFixed(2)}x`;
}

export function generateReport(report: BenchmarkReport): string {
  const aggregates = aggregate(report);
  const lore = aggregates.find((a) => a.platform === "lore");

  const lines: string[] = [];
  lines.push("# Lore Knowledge Base Benchmark");
  lines.push("");
  lines.push(`**Started:** ${report.runStartedAt}  `);
  lines.push(`**Completed:** ${report.runCompletedAt}  `);
  lines.push(`**Queries:** ${report.queries.length}  `);
  lines.push(`**Platforms:** ${report.platforms.join(", ")}  `);
  lines.push("");

  lines.push("## Platform Summary");
  lines.push("");
  lines.push(
    "| Platform | Score | Input tokens | Output tokens | Tool-result tokens | Latency (ms) | Tool calls | Turns | Errors |",
  );
  lines.push("| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |");
  for (const a of aggregates) {
    lines.push(
      `| ${a.platform} | ${a.avgScore}/5 | ${a.avgInputTokens} | ${a.avgOutputTokens} | ${a.avgToolResultTokens} | ${a.avgLatencyMs} | ${a.avgToolCalls} | ${a.avgTurns} | ${a.errors} |`,
    );
  }
  lines.push("");

  if (lore) {
    lines.push("## Ratios vs Lore");
    lines.push("");
    lines.push("| Platform | Input tokens | Tool-result tokens | Latency | Tool calls |");
    lines.push("| --- | ---: | ---: | ---: | ---: |");
    for (const a of aggregates) {
      if (a.platform === "lore") continue;
      lines.push(
        `| ${a.platform} | ${fmtRatio(lore.avgInputTokens, a.avgInputTokens)} | ${fmtRatio(lore.avgToolResultTokens, a.avgToolResultTokens)} | ${fmtRatio(lore.avgLatencyMs, a.avgLatencyMs)} | ${fmtRatio(lore.avgToolCalls, a.avgToolCalls)} |`,
      );
    }
    lines.push("");
    lines.push("_Ratios > 1.0 mean the competitor uses more than Lore; < 1.0 means it uses less._");
    lines.push("");
  }

  lines.push("## Per-Query Breakdown");
  lines.push("");
  for (const query of report.queries) {
    lines.push(`### ${query.id} — ${query.question}`);
    lines.push("");
    lines.push("| Platform | Score | Input | Tool-result | Latency | Tool calls | Answer |");
    lines.push("| --- | ---: | ---: | ---: | ---: | ---: | --- |");
    for (const platform of report.platforms) {
      const result = report.results.find((r) => r.queryId === query.id && r.platform === platform);
      const verdict = report.verdicts.find((v) => v.queryId === query.id && v.platform === platform);
      if (!result) {
        lines.push(`| ${platform} | — | — | — | — | — | (no run) |`);
        continue;
      }
      const answer = result.error
        ? `ERROR: ${result.error}`
        : truncate(result.answer.replace(/\|/g, "\\|").replace(/\n/g, " "), 120);
      lines.push(
        `| ${platform} | ${verdict?.score ?? "—"}/5 | ${result.totalInputTokens} | ${result.toolResultTokens} | ${result.totalLatencyMs}ms | ${result.toolCallCount} | ${answer} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return `${s.slice(0, max - 1)}…`;
}

export function writeReport(jsonPath: string, mdPath: string): void {
  const report = JSON.parse(readFileSync(jsonPath, "utf-8")) as BenchmarkReport;
  writeFileSync(mdPath, generateReport(report), "utf-8");
}

const ENTRYPOINT_URL = `file://${resolve(process.argv[1] ?? "")}`;
if (import.meta.url === ENTRYPOINT_URL) {
  const jsonPath = process.argv[2];
  const mdPath = process.argv[3] ?? jsonPath?.replace(/\.json$/, ".md");
  if (!jsonPath || !mdPath) {
    console.error("Usage: tsx src/report.ts <results.json> [report.md]");
    process.exit(1);
  }
  writeReport(jsonPath, mdPath);
  console.log(`Wrote ${mdPath}`);
}
