export interface CorpusDocument {
  id: string;
  title: string;
  body: string;
}

export interface BenchmarkQuery {
  id: string;
  question: string;
  goldAnswer: string;
  relevantDocs: string[];
  tags: string[];
  split: "public" | "holdout";
}

export interface ToolCallMetric {
  name: string;
  inputTokens: number;
  outputTokens: number;
  toolResultTokens: number;
  durationMs: number;
  retrievedDocIds: string[];
}

export interface RetrievalMetrics {
  retrievedDocs: string[];
  firstRelevantRank: number | null;
  recall: number;
  precision: number;
  reciprocalRank: number;
  ndcg: number;
}

export interface CostBreakdown {
  inputUsd: number;
  outputUsd: number;
  totalUsd: number;
}

export interface QueryMetrics {
  platform: string;
  queryId: string;
  run: number;
  question: string;
  answer: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolResultTokens: number;
  totalLatencyMs: number;
  toolCallCount: number;
  turns: number;
  toolCalls: ToolCallMetric[];
  retrieval: RetrievalMetrics;
  cost: CostBreakdown;
  errorType?: ErrorType;
  error?: string;
}

export type ErrorType =
  | "rate_limit"
  | "api_error"
  | "tool_error"
  | "timeout"
  | "no_answer"
  | "unknown";

export interface JudgeScore {
  judgeId: string;
  model: string;
  family: string;
  score: number;
  reasoning: string;
  excluded?: boolean;
  excludedReason?: string;
  error?: string;
}

export interface JudgeVerdict {
  queryId: string;
  platform: string;
  run: number;
  score: number;
  meanScore: number;
  medianScore: number;
  stddev: number;
  reasoning: string;
  perJudge: JudgeScore[];
}

export interface RunEnvironment {
  model: string;
  judgeModels: string[];
  excludeSameFamilyJudge: boolean;
  effort: string;
  maxTurns: number;
  maxTokens: number;
  runsPerQuery: number;
  retries: number;
  topK: number;
  pricePerMillion: { input: number; output: number };
  sdkVersion: string;
  nodeVersion: string;
  corpusHash: string;
  queriesHash: string;
  benchVersion: string;
}

export interface BenchmarkReport {
  runStartedAt: string;
  runCompletedAt: string;
  environment: RunEnvironment;
  queries: BenchmarkQuery[];
  platforms: string[];
  results: QueryMetrics[];
  verdicts: JudgeVerdict[];
}
