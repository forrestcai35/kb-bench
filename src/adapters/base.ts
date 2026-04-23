import type Anthropic from "@anthropic-ai/sdk";

export interface ToolExecutionResult {
  text: string;
  retrievedDocIds?: string[];
}

export interface PlatformAdapter {
  readonly name: string;
  readonly systemPrompt: string;
  readonly tools: Anthropic.Tool[];
  readonly available: boolean;
  readonly unavailableReason?: string;
  execute(toolName: string, toolInput: Record<string, unknown>): Promise<ToolExecutionResult>;
}

export const SHARED_SYSTEM_TEMPLATE = `You are answering operational questions against a knowledge base that contains a fixed set of runbooks. You have the following tools available; use them to find the answer.

Rules:
1. Do not guess or answer from prior knowledge. Only state facts present in the tool results.
2. Prefer the search tool first. Only fetch a full document when a search snippet is insufficient.
3. Stop calling tools as soon as you have enough to answer — no speculative browsing.
4. Your final reply must answer the question directly. Cite the runbook you relied on by title. Do not name or mention the platform or search engine you used.`;

export function renderSystemPrompt(toolsDescription: string): string {
  return `${SHARED_SYSTEM_TEMPLATE}\n\nAvailable tools:\n${toolsDescription}`;
}
