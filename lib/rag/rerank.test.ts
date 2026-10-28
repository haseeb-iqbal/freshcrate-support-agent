import { describe, expect, it } from "vitest";
import { mmrRerank, type Candidate } from "./rerank";

const chunk = (id: string) => ({ id, articleSlug: "a", heading: id, content: id, score: 0 });
const cand = (id: string, embedding: number[]): Candidate => ({ chunk: chunk(id), embedding });


describe("mmrRerank", () => {
  const query = [1, 0];
  // A and B are near-duplicates; C is orthogonal and adds diversity.
  const A = cand("A", [1, 0]);
  const B = cand("B", [0.99, 0.14]);
  const C = cand("C", [0, 1]);

  it("returns the most relevant candidate first", () => {
    expect(mmrRerank(query, [C, B, A], 3)[0].id).toBe("A");
  });

  it("takes the least redundant candidate second when lambda favours diversity", () => {
    // The whole point of MMR: same pool, same query, opposite second pick.
    expect(mmrRerank(query, [A, B, C], 2, 0).map((c) => c.id)).toEqual(["A", "C"]);
  });

  it("never returns the same chunk twice", () => {
    const ids = mmrRerank(query, [A, B, C], 3).map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

});
