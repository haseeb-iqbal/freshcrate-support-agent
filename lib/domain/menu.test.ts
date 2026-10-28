import { describe, expect, it } from "vitest";
import { ADDON_CATALOGUE, ADDON_PRICE_CENTS, MEAL_CATALOGUE } from "./menu";

describe("catalogue shape", () => {
  it("gives every item a unique code", () => {
    const codes = [...MEAL_CATALOGUE, ...ADDON_CATALOGUE].map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

});

describe("add-on pricing", () => {
  it("prices every add-on flat by its type", () => {
    for (const a of ADDON_CATALOGUE) {
      expect(a.priceCents).toBe(ADDON_PRICE_CENTS[a.type]);
    }
  });

});

describe("dietary tags", () => {

  it("never promotes a standard item into a specialist track", () => {
    const promoted = [...MEAL_CATALOGUE, ...ADDON_CATALOGUE]
      .filter((i) => i.track === "standard" && i.tags.length > 1)
      .map((i) => i.code);
    expect(promoted).toEqual([]);
  });

});

