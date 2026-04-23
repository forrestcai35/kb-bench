import type Anthropic from "@anthropic-ai/sdk";

export interface PlatformAdapter {
  readonly name: string;
  readonly systemPrompt: string;
  readonly tools: Anthropic.Tool[];
  readonly available: boolean;
  readonly unavailableReason?: string;
  execute(toolName: string, toolInput: Record<string, unknown>): Promise<string>;
}
