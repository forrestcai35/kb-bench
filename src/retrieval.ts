import type { RetrievalMetrics } from "./types.js";

export function computeRetrievalMetrics(
  retrievedInOrder: string[],
  relevantDocs: string[],
  idResolver?: (platformId: string) => string | undefined,
): RetrievalMetrics {
  const dedupedInOrder: string[] = [];
  const seen = new Set<string>();
  for (const raw of retrievedInOrder) {
    const canonical = idResolver ? idResolver(raw) ?? raw : raw;
    if (!seen.has(canonical)) {
      seen.add(canonical);
      dedupedInOrder.push(canonical);
    }
  }

  const relevantSet = new Set(relevantDocs);
  let firstRelevantRank: number | null = null;
  let hits = 0;
  for (let i = 0; i < dedupedInOrder.length; i++) {
    const id = dedupedInOrder[i]!;
    if (relevantSet.has(id)) {
      if (firstRelevantRank === null) firstRelevantRank = i + 1;
      hits++;
    }
  }

  const recall = relevantDocs.length === 0 ? 0 : hits / relevantDocs.length;
  const precision = dedupedInOrder.length === 0 ? 0 : hits / dedupedInOrder.length;
  const reciprocalRank = firstRelevantRank ? 1 / firstRelevantRank : 0;

  const dcg = dedupedInOrder.reduce((sum, id, i) => {
    if (!relevantSet.has(id)) return sum;
    return sum + 1 / Math.log2(i + 2);
  }, 0);
  const idealHits = Math.min(relevantDocs.length, dedupedInOrder.length);
  const idcg = Array.from({ length: idealHits }).reduce<number>(
    (sum, _, i) => sum + 1 / Math.log2(i + 2),
    0,
  );
  const ndcg = idcg === 0 ? 0 : dcg / idcg;

  return {
    retrievedDocs: dedupedInOrder,
    firstRelevantRank,
    recall,
    precision,
    reciprocalRank,
    ndcg,
  };
}

export function buildPlatformIdResolver(mapping: Record<string, string>): (id: string) => string | undefined {
  return (platformId: string): string | undefined => mapping[platformId];
}
