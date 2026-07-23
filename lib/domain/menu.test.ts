import { describe, expect, it } from "vitest";
import {
  ADDON_CATALOGUE,
  ADDON_PRICE_CENTS,
  DIETARY_TRACKS,
  MEAL_CATALOGUE,
  addOnsForTrack,
  isDietaryTrack,
  mealByName,
  mealsForTrack,
} from "./menu";

describe("catalogue shape", () => {
  it("gives every item a unique code", () => {
    const codes = [...MEAL_CATALOGUE, ...ADDON_CATALOGUE].map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("puts eight meals and five add-ons on each of the four tracks, and nothing outside them", () => {
    for (const track of DIETARY_TRACKS) {
      expect(mealsForTrack(track)).toHaveLength(8);
      expect(addOnsForTrack(track)).toHaveLength(5);
    }
    // The totals are the cross-check: if an item carried a track outside the
    // four it would be stranded here rather than counted above.
    expect(MEAL_CATALOGUE).toHaveLength(32);
    expect(ADDON_CATALOGUE).toHaveLength(20);
  });
});

describe("add-on pricing", () => {
  it("prices every add-on flat by its type", () => {
    for (const a of ADDON_CATALOGUE) {
      expect(a.priceCents).toBe(ADDON_PRICE_CENTS[a.type]);
    }
  });

  it("prices sides at $4.99, desserts at $5.99 and drinks at $3.49", () => {
    expect(ADDON_PRICE_CENTS).toEqual({ side: 499, dessert: 599, drink: 349 });
  });

  it("charges the same for one add-on wherever it appears", () => {
    const byName = new Map<string, number>();
    for (const a of ADDON_CATALOGUE) {
      const seen = byName.get(a.name);
      if (seen !== undefined) expect(a.priceCents).toBe(seen);
      byName.set(a.name, a.priceCents);
    }
  });
});

describe("dietary tags", () => {
  it("always tags an item with its own track", () => {
    for (const item of [...MEAL_CATALOGUE, ...ADDON_CATALOGUE]) {
      expect(item.tags).toContain(item.track);
    }
  });

  it("never promotes a standard item into a specialist track", () => {
    const promoted = [...MEAL_CATALOGUE, ...ADDON_CATALOGUE]
      .filter((i) => i.track === "standard" && i.tags.length > 1)
      .map((i) => i.code);
    expect(promoted).toEqual([]);
  });

  it("only ever tags with a known track", () => {
    for (const item of [...MEAL_CATALOGUE, ...ADDON_CATALOGUE]) {
      for (const tag of item.tags) expect(DIETARY_TRACKS).toContain(tag);
    }
  });

  it("never repeats a tag on one item", () => {
    for (const item of [...MEAL_CATALOGUE, ...ADDON_CATALOGUE]) {
      expect(new Set(item.tags).size).toBe(item.tags.length);
    }
  });

  it("carries the cross-track overlaps the catalogue calls out", () => {
    // G2 is also dairy-free; V5 is also gluten-free.
    expect(MEAL_CATALOGUE.find((m) => m.code === "G2")!.tags).toContain("dairy-free");
    expect(MEAL_CATALOGUE.find((m) => m.code === "V5")!.tags).toContain("gluten-free");
  });
});

describe("lookups", () => {
  it("returns only meals on the requested track", () => {
    for (const m of mealsForTrack("vegetarian")) expect(m.track).toBe("vegetarian");
  });

  it("returns only add-ons on the requested track", () => {
    for (const a of addOnsForTrack("dairy-free")) expect(a.track).toBe("dairy-free");
  });

  it("finds a meal by its exact name", () => {
    expect(mealByName("Wild Mushroom Risotto")?.code).toBe("V2");
    expect(mealByName("Not A Meal")).toBeUndefined();
  });

  it("recognises exactly the four tracks", () => {
    for (const t of DIETARY_TRACKS) expect(isDietaryTrack(t)).toBe(true);
    expect(isDietaryTrack("pescatarian")).toBe(false);
    expect(isDietaryTrack(null)).toBe(false);
    expect(isDietaryTrack(3)).toBe(false);
  });
});
