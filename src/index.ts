import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { getConfig } from "./config.js";
import { QUERIES } from "./queries.js";
import { BenchmarkAgent } from "./agent.js";
import { Judge } from "./judge.js";
import { LoreAdapter } from "./adapters/lore.js";
import { NotionAdapter } from "./adapters/notion.js";
import { ConfluenceAdapter } from "./adapters/confluence.js";
import { ObsidianAdapter } from "./adapters/obsidian.js";
import { generateReport } from "./report.js";
import type { PlatformAdapter } from "./adapters/base.js";
import type { BenchmarkReport, QueryMetrics, JudgeVerdict } from "./types.js";

function parseArgs(): { platforms: string[] | null; queryIds: string[] | null; outDir: string } {
  const args = process.argv.slice(2);
  let platforms: string[] | null = null;
  let queryIds: string[] | null = null;
  let outDir = resolve("results");
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--platforms" && args[i + 1]) {
      platforms = args[++i]!.split(",").map((p) => p.trim());
    } else if (arg === "--queries" && args[i + 1]) {
      queryIds = args[++i]!.split(",").map((q) => q.trim());
    } else if (arg === "--out" && args[i + 1]) {
      outDir = resolve(args[++i]!);
    }
  }
  return { platforms, queryIds, outDir };
}

async function main(): Promise<void> {
  const { platforms: platformFilter, queryIds, outDir } = parseArgs();
  const config = getConfig();

  const allAdapters: PlatformAdapter[] = [
    new LoreAdapter(config),
    new NotionAdapter(config),
    new ConfluenceAdapter(config),
    new ObsidianAdapter(config),
  ];

  const adapters = allAdapters
    .filter((a) => (platformFilter ? platformFilter.includes(a.name) : true))
    .filter((a) => {
      if (!a.available) {
        console.warn(`[skip] ${a.name}: ${a.unavailableReason}`);
        return false;
      }
      return true;
    });

  if (adapters.length === 0) {
    console.error("No adapters available. Set the required env vars and retry.");
    process.exit(1);
  }

  const queries = queryIds ? QUERIES.filter((q) => queryIds.includes(q.id)) : QUERIES;
  if (queries.length === 0) {
    console.error("No queries to run.");
    process.exit(1);
  }

  const agent = new BenchmarkAgent(config);
  const judge = new Judge(config);

  const runStartedAt = new Date().toISOString();
  const results: QueryMetrics[] = [];
  const verdicts: JudgeVerdict[] = [];

  for (const adapter of adapters) {
    console.log(`\n=== ${adapter.name} ===`);
    for (const query of queries) {
      process.stdout.write(`  ${query.id} … `);
      const result = await agent.runQuery(adapter, query);
      results.push(result);
      const verdict = await judge.score(query, result);
      verdicts.push(verdict);
      const status = result.error ? `ERR ${result.error}` : `score=${verdict.score}/5`;
      console.log(
        `${status} | in=${result.totalInputTokens} tr=${result.toolResultTokens} t=${result.totalLatencyMs}ms calls=${result.toolCallCount}`,
      );
    }
  }

  const runCompletedAt = new Date().toISOString();
  const report: BenchmarkReport = {
    runStartedAt,
    runCompletedAt,
    queries,
    platforms: adapters.map((a) => a.name),
    results,
    verdicts,
  };

  mkdirSync(outDir, { recursive: true });
  const stamp = runCompletedAt.replace(/[:.]/g, "-");
  const jsonPath = resolve(outDir, `bench-${stamp}.json`);
  const mdPath = resolve(outDir, `bench-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  writeFileSync(mdPath, generateReport(report), "utf-8");
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
