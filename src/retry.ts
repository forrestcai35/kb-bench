import Anthropic from "@anthropic-ai/sdk";

export interface RetryOptions {
  retries: number;
  baseDelayMs: number;
  maxDelayMs: number;
  jitter: boolean;
}

export const DEFAULT_RETRY: RetryOptions = {
  retries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  jitter: true,
};

export async function withRetry<T>(
  label: string,
  fn: () => Promise<T>,
  options: Partial<RetryOptions> = {},
): Promise<T> {
  const opts = { ...DEFAULT_RETRY, ...options };
  let lastError: unknown;
  for (let attempt = 0; attempt <= opts.retries; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      if (!isRetryable(error) || attempt === opts.retries) {
        throw error;
      }
      const hinted = hintedDelayMs(error);
      const backoff = Math.min(opts.maxDelayMs, opts.baseDelayMs * 2 ** attempt);
      const jitter = opts.jitter ? Math.random() * backoff * 0.25 : 0;
      const delay = Math.max(hinted ?? 0, backoff + jitter);
      const reason = errorSummary(error);
      console.warn(`[retry] ${label}: ${reason} — sleeping ${Math.round(delay)}ms (attempt ${attempt + 1}/${opts.retries})`);
      await sleep(delay);
    }
  }
  throw lastError;
}

function isRetryable(error: unknown): boolean {
  if (error instanceof Anthropic.RateLimitError) return true;
  if (error instanceof Anthropic.APIConnectionError) return true;
  if (error instanceof Anthropic.APIError) {
    return error.status === 408 || error.status === 500 || error.status === 502 || error.status === 503 || error.status === 504 || error.status === 529;
  }
  const message = (error as Error | undefined)?.message?.toLowerCase() ?? "";
  if (/\b(429|500|502|503|504|etimedout|econnreset)\b/.test(message)) return true;
  return false;
}

function hintedDelayMs(error: unknown): number | null {
  if (error instanceof Anthropic.APIError) {
    const retryAfter = error.headers?.["retry-after"];
    if (typeof retryAfter === "string") {
      const seconds = Number(retryAfter);
      if (!Number.isNaN(seconds)) return seconds * 1000;
    }
  }
  return null;
}

function errorSummary(error: unknown): string {
  if (error instanceof Anthropic.RateLimitError) return `rate limit (${error.status})`;
  if (error instanceof Anthropic.APIError) return `API ${error.status}: ${error.message}`;
  return (error as Error)?.message ?? String(error);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
