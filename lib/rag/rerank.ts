import type { RetrievedChunk } from "./types";

export function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export interface Candidate {
  chunk: RetrievedChunk;
  embedding: number[];
}

/**
 * Maximal Marginal Relevance rerank.
 *
 * Vector search alone tends to return several near-duplicate chunks from the
 * same section. MMR re-scores the candidate pool to balance query relevance
 * against redundancy with already-selected chunks, so the final set is both
 * on-topic and diverse. `lambda` = 1 is pure relevance; lower values favour
 * diversity. The reranker is intentionally dependency-free so it can later be
 * swapped for a cross-encoder / LLM reranker behind the same call site.
 */
export function mmrRerank(
  queryEmbedding: number[],
  candidates: Candidate[],
  k: number,
  lambda = 0.7,
): RetrievedChunk[] {
  const pool = [...candidates];
  const selected: Candidate[] = [];

  while (selected.length < k && pool.length > 0) {
    let bestIdx = 0;
    let bestScore = -Infinity;
    for (let i = 0; i < pool.length; i++) {
      const relevance = cosineSim(queryEmbedding, pool[i].embedding);
      let redundancy = 0;
      for (const s of selected) {
        redundancy = Math.max(redundancy, cosineSim(pool[i].embedding, s.embedding));
      }
      const score = lambda * relevance - (1 - lambda) * redundancy;
      if (score > bestScore) {
        bestScore = score;
        bestIdx = i;
      }
    }
    selected.push(pool.splice(bestIdx, 1)[0]);
  }

  return selected.map((s) => s.chunk);
}
