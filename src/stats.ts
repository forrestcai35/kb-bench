export interface Summary {
  n: number;
  mean: number;
  stddev: number;
  ci95: number;
  min: number;
  max: number;
}

export function summarize(nums: number[]): Summary {
  const n = nums.length;
  if (n === 0) return { n: 0, mean: 0, stddev: 0, ci95: 0, min: 0, max: 0 };
  const mean = nums.reduce((a, b) => a + b, 0) / n;
  const variance = n <= 1 ? 0 : nums.reduce((s, v) => s + (v - mean) ** 2, 0) / (n - 1);
  const stddev = Math.sqrt(variance);
  const ci95 = n <= 1 ? 0 : 1.96 * (stddev / Math.sqrt(n));
  return {
    n,
    mean,
    stddev,
    ci95,
    min: Math.min(...nums),
    max: Math.max(...nums),
  };
}
