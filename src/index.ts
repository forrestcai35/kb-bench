import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { resolve } from "node:path";
import { getConfig } from "./config.js";
import { loadDataset } from "./dataset.js";
import { BenchmarkAgent } from "./agent.js";
import { Judge } from "./judge.js";
import { LoreAdapter } from "./adapters/lore.js";
import { NotionAdapter } from "./adapters/notion.js";
import { ConfluenceAdapter } from "./adapters/confluence.js";
import { ObsidianAdapter } from "./adapters/obsidian.js";
import { generateReport } from "./report.js";
import { pricingForModel } from "./pricing.js";
import type { PlatformAdapter } from "./adapters/base.js";
import type { BenchmarkReport, JudgeVerdict, QueryMetrics, RunEnvironment } from "./types.js";

interface CliArgs {
  platforms: string[] | null;
  queryIds: string[] | null;
  outDir: string;
  runs: number | null;
  baseline: string | null;
  split: "public" | "holdout" | "all";
}

function parseArgs(): CliArgs {
  const args = process.argv.slice(2);
  const parsed: CliArgs = {
    platforms: null,
    queryIds: null,
    outDir: resolve("results"),
    runs: null,
    baseline: null,
    split: "public",
  };
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--platforms" && args[i + 1]) {
      parsed.platforms = args[++i]!.split(",").map((p) => p.trim());
    } else if (arg === "--queries" && args[i + 1]) {
      parsed.queryIds = args[++i]!.split(",").map((q) => q.trim());
    } else if (arg === "--out" && args[i + 1]) {
      parsed.outDir = resolve(args[++i]!);
    } else if (arg === "--runs" && args[i + 1]) {
      parsed.runs = Number(args[++i]);
    } else if (arg === "--baseline" && args[i + 1]) {
      parsed.baseline = args[++i]!;
    } else if (arg === "--split" && args[i + 1]) {
      const value = args[++i]!;
      if (value !== "public" && value !== "holdout" && value !== "all") {
        console.error(`Unknown split: ${value}`);
        process.exit(1);
      }
      parsed.split = value;
    } else if (arg === "--help" || arg === "-h") {
      printHelp();
      process.exit(0);
    }
  }
  return parsed;
}

function printHelp(): void {
  console.log(`kb-bench — knowledge-base agent retrieval benchmark

Usage:
  npm run bench -- [options]

Options:
  --platforms <list>    Comma-separated platform names (default: all available).
  --queries <list>      Comma-separated query ids (default: all).
  --split <name>        Dataset split to run: public | holdout | all (default: public).
  --runs <N>            Runs per query (overrides BENCH_RUNS). Default: 1.
  --out <dir>           Output directory (default: ./results).
  --baseline <platform> Platform used as the denominator in the relative comparison table.
  -h, --help            Show this help.
`);
}

function benchVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require(resolve("package.json")) as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

function sdkVersion(): string {
  try {
    const require = createRequire(import.meta.url);
    const pkg = require("@anthropic-ai/sdk/package.json") as { version?: string };
    return pkg.version ?? "unknown";
  } catch {
    return "unknown";
  }
}

async function main(): Promise<void> {
  const cli = parseArgs();
  const config = getConfig();
  const runsPerQuery = cli.runs ?? config.runsPerQuery;

  const dataset = loadDataset({ split: cli.split });
  const queries = cli.queryIds
    ? dataset.queries.filter((q) => cli.queryIds!.includes(q.id))
    : dataset.queries;
  if (queries.length === 0) {
    console.error("No queries to run. Check --queries or --split filters.");
    process.exit(1);
  }

  const allAdapters: PlatformAdapter[] = [
    new LoreAdapter(config),
    new NotionAdapter(config),
    new ConfluenceAdapter(config),
    new ObsidianAdapter(config),
  ];

  const adapters = allAdapters
    .filter((a) => (cli.platforms ? cli.platforms.includes(a.name) : true))
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

  const agent = new BenchmarkAgent(config);
  const judge = new Judge(config);

  const pricing = pricingForModel(config.model);
  const environment: RunEnvironment = {
    model: config.model,
    judgeModel: config.judgeModel,
    effort: config.effort,
    maxTurns: config.maxTurns,
    maxTokens: config.maxTokens,
    runsPerQuery,
    retries: config.retries,
    topK: config.topK,
    pricePerMillion: { input: pricing.inputPerMillion, output: pricing.outputPerMillion },
    sdkVersion: sdkVersion(),
    nodeVersion: process.version,
    corpusHash: dataset.corpusHash,
    queriesHash: dataset.queriesHash,
    benchVersion: benchVersion(),
  };

  const runStartedAt = new Date().toISOString();
  const results: QueryMetrics[] = [];
  const verdicts: JudgeVerdict[] = [];

  for (const adapter of adapters) {
    console.log(`\n=== ${adapter.name} ===`);
    for (const query of queries) {
      for (let run = 1; run <= runsPerQuery; run++) {
        const tag = runsPerQuery > 1 ? `${query.id} [${run}/${runsPerQuery}]` : query.id;
        process.stdout.write(`  ${tag} … `);
        const result = await agent.runQuery(adapter, query, run);
        results.push(result);
        const verdict = await judge.score(query, result);
        verdicts.push(verdict);
        const status = result.error
          ? `ERR [${result.errorType}] ${result.error}`
          : `score=${verdict.score}/5 recall=${result.retrieval.recall.toFixed(2)}`;
        console.log(
          `${status} | in=${result.totalInputTokens} tr=${result.toolResultTokens} t=${result.totalLatencyMs}ms calls=${result.toolCallCount} cost=$${result.cost.totalUsd.toFixed(4)}`,
        );
      }
    }
  }

  const runCompletedAt = new Date().toISOString();
  const report: BenchmarkReport = {
    runStartedAt,
    runCompletedAt,
    environment,
    queries,
    platforms: adapters.map((a) => a.name),
    results,
    verdicts,
  };

  mkdirSync(cli.outDir, { recursive: true });
  const stamp = runCompletedAt.replace(/[:.]/g, "-");
  const jsonPath = resolve(cli.outDir, `bench-${stamp}.json`);
  const mdPath = resolve(cli.outDir, `bench-${stamp}.md`);
  writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf-8");
  writeFileSync(mdPath, generateReport(report, { baseline: cli.baseline }), "utf-8");
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);
}

main().catch((error) => {
  console.error("Fatal:", error);
  process.exit(1);
});
