import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, type Config } from "./config.js";
import type { PlatformAdapter } from "./adapters/base.js";
import { computeRetrievalMetrics } from "./retrieval.js";
import { computeCost, pricingForModel } from "./pricing.js";
import { withRetry } from "./retry.js";
import type { BenchmarkQuery, ErrorType, QueryMetrics, ToolCallMetric } from "./types.js";

export class BenchmarkAgent {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: Config["effort"];
  private readonly maxTokens: number;
  private readonly maxTurns: number;
  private readonly retries: number;

  constructor(config: Config) {
    this.client = createAnthropicClient(config);
    this.model = config.model;
    this.effort = config.effort;
    this.maxTokens = config.maxTokens;
    this.maxTurns = config.maxTurns;
    this.retries = config.retries;
  }

  async runQuery(adapter: PlatformAdapter, query: BenchmarkQuery, run: number): Promise<QueryMetrics> {
    const pricing = pricingForModel(this.model);
    const metrics: QueryMetrics = {
      platform: adapter.name,
      queryId: query.id,
      run,
      question: query.question,
      answer: "",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      toolResultTokens: 0,
      totalLatencyMs: 0,
      toolCallCount: 0,
      turns: 0,
      toolCalls: [],
      retrieval: {
        retrievedDocs: [],
        firstRelevantRank: null,
        recall: 0,
        precision: 0,
        reciprocalRank: 0,
        ndcg: 0,
      },
      cost: { inputUsd: 0, outputUsd: 0, totalUsd: 0 },
    };

    const retrievalOrder: string[] = [];
    const conversation: Anthropic.MessageParam[] = [
      { role: "user", content: query.question },
    ];

    const runStart = Date.now();
    try {
      for (let turn = 0; turn < this.maxTurns; turn++) {
        metrics.turns = turn + 1;
        const callStart = Date.now();

        const response = await withRetry(
          `${adapter.name} ${query.id} turn ${turn + 1}`,
          async () => {
            const stream = this.client.messages.stream({
              model: this.model,
              max_tokens: this.maxTokens,
              system: adapter.systemPrompt,
              tools: adapter.tools,
              messages: conversation,
              thinking: { type: "adaptive" },
              output_config: { effort: this.effort },
            });
            return stream.finalMessage();
          },
          { retries: this.retries },
        );

        metrics.totalInputTokens += response.usage.input_tokens;
        metrics.totalOutputTokens += response.usage.output_tokens;

        const turnMetric: ToolCallMetric = {
          name: "__turn__",
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          toolResultTokens: 0,
          durationMs: Date.now() - callStart,
          retrievedDocIds: [],
        };

        conversation.push({ role: "assistant", content: response.content });

        if (response.stop_reason === "end_turn" || response.stop_reason === "stop_sequence") {
          metrics.answer = this.extractText(response.content);
          metrics.toolCalls.push(turnMetric);
          break;
        }

        if (response.stop_reason !== "tool_use") {
          metrics.answer = this.extractText(response.content);
          metrics.toolCalls.push(turnMetric);
          break;
        }

        const toolUses = response.content.filter(
          (block): block is Anthropic.ToolUseBlock => block.type === "tool_use",
        );
        const toolResults: Anthropic.ToolResultBlockParam[] = [];

        for (const toolUse of toolUses) {
          metrics.toolCallCount += 1;
          const toolStart = Date.now();
          let resultText: string;
          let retrievedIds: string[] = [];
          let isError = false;
          try {
            const toolInput = (toolUse.input ?? {}) as Record<string, unknown>;
            const result = await withRetry(
              `${adapter.name} ${toolUse.name}`,
              () => adapter.execute(toolUse.name, toolInput),
              { retries: this.retries },
            );
            resultText = result.text;
            retrievedIds = result.retrievedDocIds ?? [];
          } catch (error) {
            isError = true;
            resultText = `Error: ${(error as Error).message}`;
          }

          const resultTokens = await this.countTokens(resultText);
          metrics.toolResultTokens += resultTokens;
          for (const id of retrievedIds) retrievalOrder.push(id);

          metrics.toolCalls.push({
            name: toolUse.name,
            inputTokens: 0,
            outputTokens: 0,
            toolResultTokens: resultTokens,
            durationMs: Date.now() - toolStart,
            retrievedDocIds: retrievedIds,
          });

          toolResults.push({
            type: "tool_result",
            tool_use_id: toolUse.id,
            content: resultText,
            is_error: isError,
          });
        }

        metrics.toolCalls.push(turnMetric);
        conversation.push({ role: "user", content: toolResults });
      }

      if (!metrics.answer) {
        metrics.error = `No final answer after ${this.maxTurns} turns`;
        metrics.errorType = "no_answer";
      }
    } catch (error) {
      metrics.error = errorMessage(error);
      metrics.errorType = classifyError(error);
    }
    metrics.totalLatencyMs = Date.now() - runStart;
    metrics.retrieval = computeRetrievalMetrics(retrievalOrder, query.relevantDocs);
    metrics.cost = computeCost(metrics.totalInputTokens, metrics.totalOutputTokens, pricing);
    return metrics;
  }

  private extractText(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((block): block is Anthropic.TextBlock => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
  }

  private async countTokens(text: string): Promise<number> {
    if (!text) return 0;
    try {
      const res = await this.client.messages.countTokens({
        model: this.model,
        messages: [{ role: "user", content: text }],
      });
      return res.input_tokens;
    } catch {
      return Math.ceil(text.length / 4);
    }
  }
}

function classifyError(error: unknown): ErrorType {
  if (error instanceof Anthropic.RateLimitError) return "rate_limit";
  if (error instanceof Anthropic.APIError) return "api_error";
  const msg = (error as Error | undefined)?.message?.toLowerCase() ?? "";
  if (msg.includes("timeout") || msg.includes("etimedout")) return "timeout";
  if (msg.includes("tool") || msg.includes("adapter")) return "tool_error";
  return "unknown";
}

function errorMessage(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return `RateLimitError: ${error.message}`;
  if (error instanceof Anthropic.APIError) return `APIError ${error.status}: ${error.message}`;
  return (error as Error).message ?? String(error);
}
