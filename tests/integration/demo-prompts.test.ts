import { describe, expect, it } from "vitest";
import "dotenv/config";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { ALL_PROMPTS, TOUR_FEATURES, promptById } from "@/lib/demo-prompts";
import { normalize } from "@/lib/llm/mock-scripts";

/**
 * The things-to-try list sign viewers in as a named sample customer, so a typo
 * or a customer dropped from the seed would leave a prompt that silently runs as
 * whoever is already signed in. Duplicates would show the same idea twice and
 * share one tick.
 */
describe("demo prompts", () => {
  it("has no duplicate ids or texts", () => {
    const ids = ALL_PROMPTS.map((p) => p.id);
    const texts = ALL_PROMPTS.map((p) => normalize(p.text));
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("names a real seeded customer for every prompt", async () => {
    const names = new Set((await db.select({ name: customers.name }).from(customers)).map((c) => c.name));
    const unknown = ALL_PROMPTS.filter((p) => !names.has(p.customer)).map((p) => `${p.id}: ${p.customer}`);
    expect(unknown).toEqual([]);
  });

  it("points every tour feature at a prompt that exists", () => {
    expect(TOUR_FEATURES.filter((f) => !promptById(f.promptId)).map((f) => f.promptId)).toEqual([]);
  });
});
