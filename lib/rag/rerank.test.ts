import { describe, expect, it } from "vitest";
import { cosineSim, mmrRerank, type Candidate } from "./rerank";

const chunk = (id: string) => ({ id, articleSlug: "a", heading: id, content: id, score: 0 });
const cand = (id: string, embedding: number[]): Candidate => ({ chunk: chunk(id), embedding });

describe("cosineSim", () => {
  it("is 1 for identical vectors", () => {
    expect(cosineSim([1, 0, 0], [1, 0, 0])).toBeCloseTo(1);
  });

  it("is 0 for orthogonal vectors", () => {
    expect(cosineSim([1, 0], [0, 1])).toBeCloseTo(0);
  });

  it("ignores magnitude", () => {
    expect(cosineSim([1, 1], [10, 10])).toBeCloseTo(1);
  });

  it("returns 0 rather than NaN for a zero vector", () => {
    expect(cosineSim([0, 0], [1, 1])).toBe(0);
    expect(cosineSim([1, 1], [0, 0])).toBe(0);
  });
});

describe("mmrRerank", () => {
  const query = [1, 0];
  // A and B are near-duplicates; C is orthogonal and adds diversity.
  const A = cand("A", [1, 0]);
  const B = cand("B", [0.99, 0.14]);
  const C = cand("C", [0, 1]);

  it("returns the most relevant candidate first", () => {
    expect(mmrRerank(query, [C, B, A], 3)[0].id).toBe("A");
  });

  it("takes the near-duplicate second when lambda is pure relevance", () => {
    expect(mmrRerank(query, [A, B, C], 2, 1).map((c) => c.id)).toEqual(["A", "B"]);
  });

  it("takes the least redundant candidate second when lambda favours diversity", () => {
    // The whole point of MMR: same pool, same query, opposite second pick.
    expect(mmrRerank(query, [A, B, C], 2, 0).map((c) => c.id)).toEqual(["A", "C"]);
  });

  it("keeps the near-duplicate at the default lambda, which leans on relevance", () => {
    // lambda 0.7 weights relevance over diversity, and C is orthogonal to the
    // query, so B's redundancy penalty is not enough to drop it. Pinned so a
    // change to the default is a deliberate decision, not a silent one.
    expect(mmrRerank(query, [A, B, C], 2).map((c) => c.id)).toEqual(["A", "B"]);
  });

  it("returns at most k results", () => {
    expect(mmrRerank(query, [A, B, C], 2)).toHaveLength(2);
  });

  it("returns everything when k exceeds the pool", () => {
    expect(mmrRerank(query, [A, B], 10)).toHaveLength(2);
  });

  it("returns nothing for an empty pool", () => {
    expect(mmrRerank(query, [], 3)).toEqual([]);
  });

  it("never returns the same chunk twice", () => {
    const ids = mmrRerank(query, [A, B, C], 3).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("does not consume the candidate array it is given", () => {
    const pool = [A, B, C];
    mmrRerank(query, pool, 3);
    expect(pool).toHaveLength(3);
  });
});
