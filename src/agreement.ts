import type { JudgeVerdict } from "./types.js";

export interface AgreementResult {
  judges: string[];
  krippendorffAlpha: number;
  pairwisePearson: number;
  observationCount: number;
}

export function computeJudgeAgreement(verdicts: JudgeVerdict[]): AgreementResult {
  const judgeIds = new Set<string>();
  for (const v of verdicts) for (const j of v.perJudge) if (!j.excluded && !j.error) judgeIds.add(j.judgeId);
  const judges = Array.from(judgeIds).sort();
  if (judges.length < 2) {
    return { judges, krippendorffAlpha: NaN, pairwisePearson: NaN, observationCount: 0 };
  }

  const units: Array<Map<string, number>> = [];
  for (const v of verdicts) {
    const unit = new Map<string, number>();
    for (const j of v.perJudge) {
      if (j.excluded || j.error) continue;
      unit.set(j.judgeId, j.score);
    }
    if (unit.size >= 2) units.push(unit);
  }

  return {
    judges,
    krippendorffAlpha: krippendorffAlphaInterval(units),
    pairwisePearson: meanPairwisePearson(units, judges),
    observationCount: units.length,
  };
}

function krippendorffAlphaInterval(units: Array<Map<string, number>>): number {
  if (units.length === 0) return NaN;
  const allValues: number[] = [];
  for (const u of units) for (const v of u.values()) allValues.push(v);
  if (allValues.length < 2) return NaN;

  const globalMean =
    allValues.reduce((a, b) => a + b, 0) / allValues.length;
  const expected =
    allValues.reduce((s, v) => s + (v - globalMean) ** 2, 0) / allValues.length;
  if (expected === 0) return 1;

  let observedSum = 0;
  let pairCount = 0;
  for (const unit of units) {
    const values = Array.from(unit.values());
    for (let i = 0; i < values.length; i++) {
      for (let j = i + 1; j < values.length; j++) {
        observedSum += (values[i]! - values[j]!) ** 2;
        pairCount++;
      }
    }
  }
  if (pairCount === 0) return NaN;
  const observed = observedSum / pairCount;
  return 1 - observed / (2 * expected);
}

function meanPairwisePearson(units: Array<Map<string, number>>, judges: string[]): number {
  const pairs: Array<[number, number][]> = [];
  for (let a = 0; a < judges.length; a++) {
    for (let b = a + 1; b < judges.length; b++) {
      const pair: [number, number][] = [];
      for (const unit of units) {
        const va = unit.get(judges[a]!);
        const vb = unit.get(judges[b]!);
        if (va !== undefined && vb !== undefined) pair.push([va, vb]);
      }
      if (pair.length >= 2) pairs.push(pair);
    }
  }
  if (pairs.length === 0) return NaN;
  const rs = pairs.map(pearson).filter((x) => Number.isFinite(x));
  if (rs.length === 0) return NaN;
  return rs.reduce((a, b) => a + b, 0) / rs.length;
}

function pearson(pairs: Array<[number, number]>): number {
  const n = pairs.length;
  if (n === 0) return NaN;
  const meanX = pairs.reduce((s, [x]) => s + x, 0) / n;
  const meanY = pairs.reduce((s, [, y]) => s + y, 0) / n;
  let num = 0;
  let sx = 0;
  let sy = 0;
  for (const [x, y] of pairs) {
    num += (x - meanX) * (y - meanY);
    sx += (x - meanX) ** 2;
    sy += (y - meanY) ** 2;
  }
  const denom = Math.sqrt(sx * sy);
  if (denom === 0) return NaN;
  return num / denom;
}
