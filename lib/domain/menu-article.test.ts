import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ADDON_CATALOGUE,
  DIETARY_TRACKS,
  MEAL_CATALOGUE,
  type DietaryTrack,
} from "./menu";

/**
 * The knowledge-base menu article restates the catalogue as markdown tables, and
 * the agent answers dietary questions from those tables rather than from
 * `menu.ts`. Two copies of the same data drift, and a drifted allergen label is
 * the worst kind: it reads as authoritative and is wrong. This test is the
 * thing that keeps them in step.
 */

const ARTICLE = path.join(process.cwd(), "kb", "articles", "menu-and-dietary-tracks.md");
const markdown = readFileSync(ARTICLE, "utf8");

/** The `## Heading` sections of the article, keyed by heading. */
function sections(md: string): Map<string, string> {
  const out = new Map<string, string>();
  let heading: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (heading) out.set(heading, buffer.join("\n"));
    buffer = [];
  };
  for (const line of md.split(/\r?\n/)) {
    const h2 = line.match(/^##\s+(.+)$/);
    if (h2) {
      flush();
      heading = h2[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return out;
}

/** Body rows of every markdown table in a section, as trimmed cell arrays. */
function tableRows(body: string): string[][] {
  return body
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.startsWith("|"))
    .map((l) => l.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim()))
    .filter((cells) => !cells.every((c) => /^-+$/.test(c))) // drop separator rows
    .filter((cells) => cells[0] !== "Meal" && cells[0] !== "Add-on" && cells[0] !== "Type"); // drop headers
}

const SECTIONS = sections(markdown);

/** How a track's other diets are written in the "Also suits" column. */
const alsoSuits = (tags: readonly DietaryTrack[], home: DietaryTrack): string => {
  const others = tags.filter((t) => t !== home);
  if (others.length === 0) return "-";
  // First letter capitalised, the rest lower case: "Gluten-free, dairy-free".
  const [first, ...rest] = others;
  return [first.charAt(0).toUpperCase() + first.slice(1), ...rest].join(", ");
};

const MENU_SECTION: Record<DietaryTrack, string> = {
  standard: "Standard menu",
  "gluten-free": "Gluten-Free menu",
  vegetarian: "Vegetarian menu",
  "dairy-free": "Dairy-Free menu",
};

const PRICE = (cents: number) => `$${(cents / 100).toFixed(2)}`;

describe("the menu article matches the catalogue", () => {
  it("has a menu section for every track", () => {
    for (const track of DIETARY_TRACKS) {
      expect(SECTIONS.has(MENU_SECTION[track])).toBe(true);
    }
  });

  for (const track of DIETARY_TRACKS) {
    describe(`${track} section`, () => {
      const rows = () => tableRows(SECTIONS.get(MENU_SECTION[track]) ?? "");
      const mealRows = () => rows().filter((r) => r.length === 3);
      const addOnRows = () => rows().filter((r) => r.length === 4);

      it("lists exactly the catalogue's 8 meals, in order, with their descriptions", () => {
        const expected = MEAL_CATALOGUE.filter((m) => m.track === track).map((m) => [
          m.name,
          m.description,
          alsoSuits(m.tags, track),
        ]);
        expect(mealRows()).toEqual(expected);
      });

      it("lists exactly the catalogue's 5 add-ons, in order, with type and price", () => {
        const expected = ADDON_CATALOGUE.filter((a) => a.track === track).map((a) => [
          a.name,
          a.type.charAt(0).toUpperCase() + a.type.slice(1),
          PRICE(a.priceCents),
          alsoSuits(a.tags, track),
        ]);
        expect(addOnRows()).toEqual(expected);
      });
    });
  }

  it("never labels a standard-track item with a specialist diet", () => {
    const rows = tableRows(SECTIONS.get(MENU_SECTION.standard) ?? "");
    const labelled = rows.filter((r) => r[r.length - 1] !== "-").map((r) => r[0]);
    expect(labelled).toEqual([]);
  });

  // The per-diet sections exist because per-track tables alone do not answer
  // "is <meal> gluten-free?": retrieval keys on the diet word and lands on that
  // diet's track section, which by construction does not list a meal whose home
  // is another track. These sections put every qualifying meal next to the diet
  // word - and being a second copy of the tags, they need guarding too.
  const DIET_SECTION: Record<string, DietaryTrack> = {
    "Every gluten-free meal": "gluten-free",
    "Every dairy-free meal": "dairy-free",
    "Every vegetarian meal": "vegetarian",
  };
  const TRACK_LABEL: Record<DietaryTrack, string> = {
    standard: "Standard",
    "gluten-free": "Gluten-Free",
    vegetarian: "Vegetarian",
    "dairy-free": "Dairy-Free",
  };

  for (const [heading, diet] of Object.entries(DIET_SECTION)) {
    it(`"${heading}" lists exactly the catalogue's ${diet} meals`, () => {
      const listed = tableRows(SECTIONS.get(heading) ?? "").filter((r) => r.length === 2);
      const expected = MEAL_CATALOGUE.filter((m) => m.tags.includes(diet)).map((m) => [
        m.name,
        TRACK_LABEL[m.track],
      ]);
      // Sorted, because the article groups by menu while the catalogue is in
      // code order - the SET of meals is what must match, not the ordering.
      const key = (r: string[]) => r.join("|");
      expect([...listed].sort((a, b) => key(a).localeCompare(key(b)))).toEqual(
        [...expected].sort((a, b) => key(a).localeCompare(key(b))),
      );
    });
  }

  it("states a count in each per-diet section that matches the rows below it", () => {
    for (const [heading, diet] of Object.entries(DIET_SECTION)) {
      const body = SECTIONS.get(heading) ?? "";
      const stated = Number(body.match(/These (\d+) meals/)?.[1]);
      const actual = MEAL_CATALOGUE.filter((m) => m.tags.includes(diet)).length;
      expect(stated, `${heading} states the wrong count`).toBe(actual);
    }
  });

  it("prices add-ons in the price table exactly as the catalogue does", () => {
    const rows = tableRows(SECTIONS.get("Add-on prices") ?? "");
    const stated = new Map(rows.map((r) => [r[0].toLowerCase(), r[1]]));
    for (const addOn of ADDON_CATALOGUE) {
      expect(stated.get(addOn.type)).toBe(PRICE(addOn.priceCents));
    }
  });
});
