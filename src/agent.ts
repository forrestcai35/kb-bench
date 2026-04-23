import Anthropic from "@anthropic-ai/sdk";
import { createAnthropicClient, type Config } from "./config.js";
import type { PlatformAdapter } from "./adapters/base.js";
import type { BenchmarkQuery, QueryMetrics, ToolCallMetric } from "./types.js";

export class BenchmarkAgent {
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly effort: Config["effort"];
  private readonly maxTokens: number;
  private readonly maxTurns: number;

  constructor(config: Config) {
    this.client = createAnthropicClient(config);
    this.model = config.model;
    this.effort = config.effort;
    this.maxTokens = config.maxTokens;
    this.maxTurns = config.maxTurns;
  }

  async runQuery(adapter: PlatformAdapter, query: BenchmarkQuery): Promise<QueryMetrics> {
    const metrics: QueryMetrics = {
      platform: adapter.name,
      queryId: query.id,
      question: query.question,
      answer: "",
      totalInputTokens: 0,
      totalOutputTokens: 0,
      toolResultTokens: 0,
      totalLatencyMs: 0,
      toolCallCount: 0,
      turns: 0,
      toolCalls: [],
    };

    const conversation: Anthropic.MessageParam[] = [
      { role: "user", content: query.question },
    ];

    const runStart = Date.now();
    try {
      for (let turn = 0; turn < this.maxTurns; turn++) {
        metrics.turns = turn + 1;
        const callStart = Date.now();

        const stream = this.client.messages.stream({
          model: this.model,
          max_tokens: this.maxTokens,
          system: adapter.systemPrompt,
          tools: adapter.tools,
          messages: conversation,
          thinking: { type: "adaptive" },
          output_config: { effort: this.effort },
        });
        const response = await stream.finalMessage();

        metrics.totalInputTokens += response.usage.input_tokens;
        metrics.totalOutputTokens += response.usage.output_tokens;

        const turnMetric: ToolCallMetric = {
          name: "__turn__",
          inputTokens: response.usage.input_tokens,
          outputTokens: response.usage.output_tokens,
          toolResultTokens: 0,
          durationMs: Date.now() - callStart,
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
          let isError = false;
          try {
            const toolInput = (toolUse.input ?? {}) as Record<string, unknown>;
            resultText = await adapter.execute(toolUse.name, toolInput);
          } catch (error) {
            isError = true;
            resultText = `Error: ${(error as Error).message}`;
          }

          const resultTokens = await this.countTokens(resultText);
          metrics.toolResultTokens += resultTokens;

          metrics.toolCalls.push({
            name: toolUse.name,
            inputTokens: 0,
            outputTokens: 0,
            toolResultTokens: resultTokens,
            durationMs: Date.now() - toolStart,
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
      }
    } catch (error) {
      if (error instanceof Anthropic.RateLimitError) {
        metrics.error = `RateLimitError: ${error.message}`;
      } else if (error instanceof Anthropic.APIError) {
        metrics.error = `APIError ${error.status}: ${error.message}`;
      } else {
        metrics.error = (error as Error).message;
      }
    }
    metrics.totalLatencyMs = Date.now() - runStart;
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
