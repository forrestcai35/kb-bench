export interface BenchmarkQuery {
  id: string;
  question: string;
  goldAnswer: string;
}

export interface ToolCallMetric {
  name: string;
  inputTokens: number;
  outputTokens: number;
  toolResultTokens: number;
  durationMs: number;
}

export interface QueryMetrics {
  platform: string;
  queryId: string;
  question: string;
  answer: string;
  totalInputTokens: number;
  totalOutputTokens: number;
  toolResultTokens: number;
  totalLatencyMs: number;
  toolCallCount: number;
  turns: number;
  toolCalls: ToolCallMetric[];
  error?: string;
}

export interface JudgeVerdict {
  queryId: string;
  platform: string;
  score: number;
  reasoning: string;
}

export interface BenchmarkReport {
  runStartedAt: string;
  runCompletedAt: string;
  queries: BenchmarkQuery[];
  platforms: string[];
  results: QueryMetrics[];
  verdicts: JudgeVerdict[];
}
