# Menu Pricing & Dietary Tracks Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Price the 20 catalogue add-ons, move the 32-meal catalogue into code, tag orders and customers with dietary tracks, publish a menu/halal knowledge-base article, and let a customer switch track through the chatbot.

**Architecture:** A pure `lib/domain/menu.ts` becomes the single source for meals, add-ons, prices and dietary tags. The seed draws each customer's meals and add-ons from that customer's track. Two new columns (`customers.dietary_track`, `orders.dietary_tags`) surface through the existing `orderView` and `get_subscription` read paths. Switching track follows the established propose-confirm pattern exactly: a tool proposes, an SSE event renders a card, and only `/api/actions/dietary-track` writes.

**Tech Stack:** Next.js 14 App Router · TypeScript · Drizzle ORM over PostgreSQL + pgvector · Vitest (unit / api / integration) · Cypress (E2E against `MOCK_LLM=1`) · OpenAI `text-embedding-3-small` for KB ingest.

**Spec:** `docs/superpowers/specs/2026-07-23-menu-pricing-and-dietary-tracks-design.md`

## Global Constraints

- **Never use the em dash `—` in anything you write.** Use a plain dash `-`. Existing files contain em dashes; leave those alone, but do not add new ones.
- Add-on prices are flat by type and defined once: **side `499`, dessert `599`, drink `349`**.
- A meal's list price is **`1750`** and comes from `MEAL_LIST_PRICE_CENTS` in `lib/billing/pricing.ts`. Do not hard-code `1750` in new code.
- The four dietary tracks are exactly: **`standard`, `gluten-free`, `vegetarian`, `dairy-free`**.
- **A `standard`-track meal or add-on never carries a specialist tag** (`gluten-free`, `vegetarian`, `dairy-free`). This is a safety rule, not a style preference.
- These three seeded refund demos must keep working and are asserted by tests: **FC1008 refunds at exactly `1750`**, **FC1020 refunds above the `2000` ceiling**, **FC1015 is refundable so Tom's 14-day cooldown fires**.
- The model never writes. Every mutation goes through a route under `app/api/actions/`.
- Match existing file style: Drizzle `jsonb(...).$type<T>()` for array columns, `Tool` objects with a `definition` + `handler`, route handlers calling `reconcile(customerId, now())` first.
- Tests run with `TZ=UTC`. Unit tests must not touch the DB or the network.
- Commit after every task.

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `lib/domain/menu.ts` (create) | The catalogue: 32 meals, 20 add-ons, prices, tags, track lookups | 1 |
| `lib/domain/menu.test.ts` (create) | Pure assertions over the catalogue's invariants | 1 |
| `db/schema.ts` (modify) | `customers.dietary_track`, `orders.dietary_tags` | 2 |
| `db/seed.ts` (modify) | Draw meals and add-ons from each customer's track | 2 |
| `tests/integration/seed-coherence.test.ts` (modify) | Track and tag coherence of the seeded data | 2 |
| `lib/tools/order-view.ts` (modify) | Expose `dietary_tags` on the shared order view | 3 |
| `lib/tools/order-view.test.ts` (modify) | Cover the new field | 3 |
| `lib/tools/subscription.ts` (modify) | `get_subscription` returns `dietary_track` | 3 |
| `app/api/account/route.ts` (modify) | Account payload carries `dietaryTrack` | 3 |
| `tests/helpers/db.ts` (modify) | Test customers can set a track | 4 |
| `app/api/actions/dietary-track/route.ts` (create) | The only writer of `dietary_track` | 4 |
| `tests/api/dietary-track.test.ts` (create) | Route contract: writes, guards, audit row | 4 |
| `lib/tools/dietary.ts` (create) | `change_dietary_track`, propose-only | 5 |
| `lib/tools/index.ts` (modify) | Register the 12th tool | 5 |
| `lib/agent/dispatch.ts` (modify) | Map the tool to `diet_change_proposal` | 5 |
| `lib/domain/terms.ts` (modify) | `RULES.dietary` for the system prompt | 5 |
| `app/chat.tsx` (modify) | `DietCard` + confirm wiring + account row | 6 |
| `lib/llm/mock-scripts.ts` (modify) | Script for the new E2E question | 7 |
| `cypress/e2e/agent.cy.ts` (modify) | Card renders, nothing written | 7 |
| `cypress/e2e/confirm.cy.ts` (modify) | Confirm applies the switch | 7 |
| `kb/articles/menu-and-dietary-tracks.md` (create) | Menu, add-on prices, halal position | 8 |
| `kb/articles/dietary-options.md` (rewrite) | The four real tracks | 8 |
| `kb/articles/pricing-and-plans.md` (modify) | Point at the add-on price table | 8 |
| `kb/articles/plan-changes.md`, `kb/articles/getting-started.md` (modify) | Drop the dead "low-carb" preferences | 8 |
| `scripts/test-retrieval.ts` (modify) | Retrieval case matches the rewritten article | 8 |
| `kb/README.md`, `docs/DOMAIN.md`, `docs/PROJECT_STATE.md` (modify) | Documentation | 9 |
| `meal-catalogue.md` in the Obsidian vault (modify) | Price column on all eight tables | 9 |

---

### Task 1: The menu catalogue module

Pure data and pure functions. No database, no network. Everything downstream reads prices and tags from here.

**Files:**
- Create: `lib/domain/menu.ts`
- Test: `lib/domain/menu.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `DIETARY_TRACKS: readonly ["standard","gluten-free","vegetarian","dairy-free"]`
  - `type DietaryTrack`
  - `ADDON_PRICE_CENTS: Record<AddOnType, number>` where `type AddOnType = "side" | "dessert" | "drink"`
  - `interface Meal { code: string; name: string; description: string; track: DietaryTrack; tags: DietaryTrack[]; kcal: number; protein: number; carbs: number; fat: number }`
  - `interface AddOn { code: string; name: string; type: AddOnType; track: DietaryTrack; tags: DietaryTrack[]; priceCents: number; kcal: number }`
  - `MEAL_CATALOGUE: Meal[]` (32), `ADDON_CATALOGUE: AddOn[]` (20)
  - `mealsForTrack(track: DietaryTrack): Meal[]`
  - `addOnsForTrack(track: DietaryTrack): AddOn[]`
  - `mealByName(name: string): Meal | undefined`
  - `isDietaryTrack(value: unknown): value is DietaryTrack`

- [ ] **Step 1: Write the failing test**

Create `lib/domain/menu.test.ts`:

```ts
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
  it("holds 32 meals and 20 add-ons", () => {
    expect(MEAL_CATALOGUE).toHaveLength(32);
    expect(ADDON_CATALOGUE).toHaveLength(20);
  });

  it("gives every item a unique code", () => {
    const codes = [...MEAL_CATALOGUE, ...ADDON_CATALOGUE].map((i) => i.code);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("puts eight meals and five add-ons on each of the four tracks", () => {
    for (const track of DIETARY_TRACKS) {
      expect(mealsForTrack(track)).toHaveLength(8);
      expect(addOnsForTrack(track)).toHaveLength(5);
    }
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
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/domain/menu.test.ts`
Expected: FAIL - `Failed to resolve import "./menu"`.

- [ ] **Step 3: Write the implementation**

Create `lib/domain/menu.ts`:

```ts
/**
 * The FreshCrate menu: four dietary tracks, eight meals and five add-ons each.
 *
 * Add-on prices are flat by type, so one add-on costs the same wherever it
 * appears. Meals are all MEAL_LIST_PRICE_CENTS ($17.50) and are free as part of
 * a plan, so their price lives in lib/billing/pricing.ts, not here.
 *
 * TAGGING RULE: an item always carries its own track, and carries another track
 * only when nothing in it is excluded by that track. A `standard` item is NEVER
 * tagged into a specialist track, even when it would qualify on ingredients:
 * standard meals are not prepared under gluten-free or dairy-free controls, and
 * telling a coeliac customer otherwise is a claim we cannot stand behind.
 */

export const DIETARY_TRACKS = ["standard", "gluten-free", "vegetarian", "dairy-free"] as const;
export type DietaryTrack = (typeof DIETARY_TRACKS)[number];

export const ADDON_TYPES = ["side", "dessert", "drink"] as const;
export type AddOnType = (typeof ADDON_TYPES)[number];

/** Flat add-on pricing, by type. The only place these numbers live. */
export const ADDON_PRICE_CENTS: Record<AddOnType, number> = {
  side: 499,
  dessert: 599,
  drink: 349,
};

export interface Meal {
  code: string;
  name: string;
  description: string;
  /** The track this meal is offered on. */
  track: DietaryTrack;
  /** Every track this meal satisfies, its own first. */
  tags: DietaryTrack[];
  kcal: number;
  protein: number;
  carbs: number;
  fat: number;
}

export interface AddOn {
  code: string;
  name: string;
  type: AddOnType;
  track: DietaryTrack;
  tags: DietaryTrack[];
  priceCents: number;
  kcal: number;
}

/** Tags are given home-track-first, so tags[0] is the track. */
type Tags = [DietaryTrack, ...DietaryTrack[]];

const M = (
  code: string,
  name: string,
  description: string,
  tags: Tags,
  macros: [number, number, number, number],
): Meal => ({
  code,
  name,
  description,
  track: tags[0],
  tags: [...tags],
  kcal: macros[0],
  protein: macros[1],
  carbs: macros[2],
  fat: macros[3],
});

const A = (code: string, name: string, type: AddOnType, tags: Tags, kcal: number): AddOn => ({
  code,
  name,
  type,
  track: tags[0],
  tags: [...tags],
  priceCents: ADDON_PRICE_CENTS[type],
  kcal,
});

export const MEAL_CATALOGUE: Meal[] = [
  // Standard - no restrictions, and no specialist guarantee.
  M("S1", "Herb Roast Chicken & Garlic Mash", "Half chicken breast, buttery mashed potato, green beans", ["standard"], [620, 48, 42, 28]),
  M("S2", "Beef Lasagne", "Layered pasta, beef ragu, bechamel, mozzarella", ["standard"], [710, 38, 58, 36]),
  M("S3", "Teriyaki Salmon Rice Bowl", "Glazed salmon fillet, jasmine rice, edamame, sesame", ["standard"], [580, 40, 55, 20]),
  M("S4", "Chicken Tikka Masala & Basmati", "Yoghurt-marinated chicken, tomato cream sauce, rice", ["standard"], [660, 42, 62, 26]),
  M("S5", "Beef Smash Burger & Fries", "Two beef patties, cheddar, brioche bun, seasoned fries", ["standard"], [890, 44, 68, 48]),
  M("S6", "Creamy Mushroom Chicken Pasta", "Penne, chicken thigh, cremini mushrooms, parmesan cream", ["standard"], [750, 45, 70, 30]),
  M("S7", "Lamb Kofta & Couscous", "Spiced lamb skewers, herbed couscous, tzatziki", ["standard"], [690, 40, 52, 34]),
  M("S8", "Turkey Meatball Marinara Sub", "Turkey meatballs, marinara, provolone, toasted roll", ["standard"], [640, 38, 60, 26]),

  // Gluten-free. G3 (mash) and G7 (frittata) stay dairy-ambiguous on purpose:
  // both commonly carry butter or milk and the catalogue does not say otherwise.
  M("G1", "Lemon Herb Grilled Chicken & Quinoa", "Chicken breast, quinoa pilaf, roast courgette", ["gluten-free", "dairy-free"], [540, 46, 40, 20]),
  M("G2", "Thai Green Curry with Jasmine Rice", "Chicken, coconut curry, bamboo shoots, basil", ["gluten-free", "dairy-free"], [610, 34, 58, 27]),
  M("G3", "Grilled Salmon & Sweet Potato Mash", "Salmon fillet, sweet potato, tenderstem broccoli", ["gluten-free"], [590, 38, 44, 26]),
  M("G4", "Beef Chilli & Rice Bowl", "Ground beef, kidney beans, tomato, brown rice", ["gluten-free", "dairy-free"], [640, 42, 56, 24]),
  M("G5", "Chicken Shawarma Rice Plate", "Spiced chicken thigh, turmeric rice, tahini, pickles", ["gluten-free", "dairy-free"], [680, 44, 54, 30]),
  M("G6", "Prawn & Chorizo-Free Paella", "Prawns, chicken, saffron rice, peas, peppers", ["gluten-free", "dairy-free"], [570, 36, 62, 16]),
  M("G7", "Turkey & Vegetable Frittata", "Egg bake with turkey, spinach, peppers, side salad", ["gluten-free"], [460, 40, 14, 27]),
  M("G8", "Corn Tortilla Beef Tacos (3)", "Seasoned beef, corn tortillas, salsa, avocado, lime", ["gluten-free", "dairy-free"], [620, 36, 50, 30]),

  // Vegetarian - contains dairy and eggs unless tagged dairy-free.
  M("V1", "Paneer Butter Masala & Basmati", "Paneer, tomato cream sauce, rice, coriander", ["vegetarian", "gluten-free"], [680, 26, 66, 34]),
  M("V2", "Wild Mushroom Risotto", "Arborio rice, mixed mushrooms, parmesan, thyme", ["vegetarian", "gluten-free"], [610, 18, 74, 25]),
  M("V3", "Halloumi & Roast Vegetable Grain Bowl", "Halloumi, farro, peppers, aubergine, pesto", ["vegetarian"], [640, 27, 58, 33]),
  M("V4", "Spinach & Ricotta Cannelloni", "Pasta tubes, ricotta, spinach, napoli sauce, mozzarella", ["vegetarian"], [660, 28, 62, 32]),
  M("V5", "Chickpea & Spinach Curry", "Chana masala, coconut yoghurt, basmati rice", ["vegetarian", "gluten-free", "dairy-free"], [560, 20, 78, 18]),
  M("V6", "Falafel Mezze Plate", "Falafel, hummus, tabbouleh, flatbread, pickled turnip", ["vegetarian", "dairy-free"], [620, 22, 70, 27]),
  M("V7", "Margherita Flatbread & Rocket", "Tomato, buffalo mozzarella, basil, rocket, balsamic", ["vegetarian"], [590, 24, 66, 24]),
  M("V8", "Black Bean & Sweet Corn Burrito Bowl", "Black beans, corn, rice, cheddar, salsa, sour cream", ["vegetarian", "gluten-free"], [630, 23, 80, 22]),

  // Dairy-free. D1/D6 use couscous and freekeh, D4/D7 use soy-based sauces and
  // soba, so none of those carry a gluten-free tag.
  M("D1", "Moroccan Chicken Tagine & Couscous", "Chicken thigh, apricot, chickpeas, warm spices", ["dairy-free"], [620, 44, 58, 22]),
  M("D2", "Coconut Chicken Curry & Rice", "Chicken, coconut milk, lemongrass, jasmine rice", ["dairy-free", "gluten-free"], [650, 40, 60, 27]),
  M("D3", "Grilled Sea Bass & Herb Potatoes", "Sea bass, olive oil potatoes, asparagus, lemon", ["dairy-free", "gluten-free"], [520, 40, 38, 22]),
  M("D4", "Beef Stir-Fry with Rice Noodles", "Beef strips, peppers, broccoli, soy-ginger sauce", ["dairy-free"], [590, 38, 62, 20]),
  M("D5", "Lentil & Vegetable Shepherd's Pie", "Green lentils, root veg, olive oil potato topping", ["dairy-free", "vegetarian", "gluten-free"], [480, 19, 68, 14]),
  M("D6", "Harissa Roast Chicken & Freekeh", "Chicken breast, freekeh, roast carrot, herb oil", ["dairy-free"], [580, 46, 52, 19]),
  M("D7", "Teriyaki Tofu & Soba Noodles", "Firm tofu, soba, pak choi, sesame, spring onion", ["dairy-free", "vegetarian"], [540, 26, 70, 17]),
  M("D8", "Cajun Prawn & Dirty Rice", "Prawns, cajun spice, rice, celery, peppers", ["dairy-free", "gluten-free"], [560, 38, 64, 15]),
];

export const ADDON_CATALOGUE: AddOn[] = [
  A("SA1", "Garlic Parmesan Bread", "side", ["standard"], 280),
  A("SA2", "Caesar Side Salad", "side", ["standard"], 220),
  A("SA3", "Chocolate Fudge Brownie", "dessert", ["standard"], 380),
  A("SA4", "Sparkling Lemonade (330 ml)", "drink", ["standard"], 120),
  A("SA5", "Mango Cheesecake Slice", "dessert", ["standard"], 420),

  A("GA1", "Rosemary Sweet Potato Fries", "side", ["gluten-free", "dairy-free", "vegetarian"], 300),
  A("GA2", "Greek Salad with Feta", "side", ["gluten-free", "vegetarian"], 250),
  A("GA3", "Flourless Chocolate Torte", "dessert", ["gluten-free", "vegetarian"], 350),
  A("GA4", "Cold-Pressed Green Juice (330 ml)", "drink", ["gluten-free", "dairy-free", "vegetarian"], 110),
  A("GA5", "Coconut Rice Pudding", "dessert", ["gluten-free", "dairy-free", "vegetarian"], 320),

  A("VA1", "Truffle Mac & Cheese Cup", "side", ["vegetarian"], 400),
  A("VA2", "Roasted Beet & Goat Cheese Salad", "side", ["vegetarian", "gluten-free"], 260),
  A("VA3", "Tiramisu-Style Coffee Cream Pot", "dessert", ["vegetarian"], 360),
  A("VA4", "Mango Lassi (300 ml)", "drink", ["vegetarian", "gluten-free"], 220),
  A("VA5", "Warm Apple Crumble & Custard", "dessert", ["vegetarian"], 420),

  A("DA1", "Rosemary Sea Salt Potato Wedges", "side", ["dairy-free", "vegetarian", "gluten-free"], 290),
  A("DA2", "Miso Glazed Aubergine", "side", ["dairy-free", "vegetarian"], 210),
  A("DA3", "Dark Chocolate & Almond Bark", "dessert", ["dairy-free", "vegetarian", "gluten-free"], 300),
  A("DA4", "Iced Oat Matcha Latte (350 ml)", "drink", ["dairy-free", "vegetarian"], 180),
  A("DA5", "Coconut Sorbet with Passionfruit", "dessert", ["dairy-free", "vegetarian", "gluten-free"], 240),
];

export function mealsForTrack(track: DietaryTrack): Meal[] {
  return MEAL_CATALOGUE.filter((m) => m.track === track);
}

export function addOnsForTrack(track: DietaryTrack): AddOn[] {
  return ADDON_CATALOGUE.filter((a) => a.track === track);
}

/** Look a meal up by the exact name stored on an order's `items`. */
export function mealByName(name: string): Meal | undefined {
  return MEAL_CATALOGUE.find((m) => m.name === name);
}

export function isDietaryTrack(value: unknown): value is DietaryTrack {
  return typeof value === "string" && (DIETARY_TRACKS as readonly string[]).includes(value);
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/domain/menu.test.ts`
Expected: PASS, 15 tests.

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 6: Commit**

```bash
git add lib/domain/menu.ts lib/domain/menu.test.ts && git commit -m "feat: add the menu catalogue with flat add-on pricing and dietary tags"
```

---

### Task 2: Schema columns and a track-aware seed

**Files:**
- Modify: `db/schema.ts`
- Modify: `db/seed.ts`
- Test: `tests/integration/seed-coherence.test.ts`

**Interfaces:**
- Consumes: `DietaryTrack`, `mealsForTrack`, `mealByName`, `ADDON_CATALOGUE` from Task 1.
- Produces: `customers.dietaryTrack` (`text`, not null, default `"standard"`) and `orders.dietaryTags` (`jsonb`, `string[] | null`) on the Drizzle schema. Seeded demo customers carry the tracks listed below.

- [ ] **Step 1: Add the two columns**

In `db/schema.ts`, inside the `customers` table, after the `plan` line:

```ts
  dietaryTrack: text("dietary_track").notNull().default("standard"), // standard | gluten-free | vegetarian | dairy-free
```

Inside the `orders` table, after the `items` line:

```ts
  dietaryTags: jsonb("dietary_tags").$type<string[]>(), // the meal's dietary tags, snapshotted when the box was packed
```

- [ ] **Step 2: Write the failing coherence tests**

In `tests/integration/seed-coherence.test.ts`, replace the import block at the top:

```ts
import { beforeAll, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { customers, orders } from "@/db/schema";
import { OPEN_STATUSES } from "@/lib/domain/terms";
import { addOnsForTrack, isDietaryTrack, mealByName, type DietaryTrack } from "@/lib/domain/menu";
```

Then append this block at the end of the file, after the existing `describe("seed temporal coherence", ...)` block:

```ts
/**
 * A customer's box must match the diet they are on. A vegetarian receiving a
 * beef meal is not a cosmetic seeding slip: it is the exact contradiction the
 * agent would then have to explain to them.
 */
describe("seed dietary coherence", () => {
  const rows = () =>
    db
      .select({
        orderNumber: orders.orderNumber,
        items: orders.items,
        addOns: orders.addOns,
        dietaryTags: orders.dietaryTags,
        track: customers.dietaryTrack,
      })
      .from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id));

  it("puts every customer on one of the four tracks", async () => {
    const all = await db.select({ id: customers.id, track: customers.dietaryTrack }).from(customers);
    const unknown = all.filter((c) => !isDietaryTrack(c.track)).map((c) => `${c.id} (${c.track})`);
    expect(unknown).toEqual([]);
  });

  it("gives every order a meal from its customer's track", async () => {
    const wrong = (await rows())
      .filter((r) => mealByName((r.items ?? [])[0] ?? "")?.track !== r.track)
      .map((r) => `${r.orderNumber}: "${(r.items ?? [])[0]}" is not on the ${r.track} menu`);
    expect(wrong).toEqual([]);
  });

  it("gives every order add-ons from its customer's track", async () => {
    const wrong: string[] = [];
    for (const r of await rows()) {
      const allowed = new Set(addOnsForTrack(r.track as DietaryTrack).map((a) => a.name));
      for (const a of r.addOns ?? []) {
        if (!allowed.has(a.name)) wrong.push(`${r.orderNumber}: "${a.name}" is not on the ${r.track} menu`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it("tags every order with its meal's catalogue tags", async () => {
    const wrong = (await rows())
      .filter((r) => {
        const meal = mealByName((r.items ?? [])[0] ?? "");
        return !meal || JSON.stringify(r.dietaryTags ?? []) !== JSON.stringify(meal.tags);
      })
      .map((r) => `${r.orderNumber}: tags ${JSON.stringify(r.dietaryTags)}`);
    expect(wrong).toEqual([]);
  });

  it("keeps the three seeded refund demos at their required amounts", async () => {
    const demos = await db
      .select({ orderNumber: orders.orderNumber, listPriceCents: orders.listPriceCents, addOns: orders.addOns })
      .from(orders)
      .where(inArray(orders.orderNumber, ["FC1008", "FC1015", "FC1020"]));
    const refund = (n: string) => {
      const o = demos.find((d) => d.orderNumber === n)!;
      return o.listPriceCents + (o.addOns ?? []).reduce((s, a) => s + a.priceCents, 0);
    };
    expect(refund("FC1008")).toBe(1750); // confirmable, and the E2E spec asserts "$17.50"
    expect(refund("FC1015")).toBe(1750); // refundable, so Tom's 14-day cooldown fires
    expect(refund("FC1020")).toBeGreaterThan(2000); // must escalate past the ceiling
  });
});
```

- [ ] **Step 3: Rewrite the seed's menu and pricing**

In `db/seed.ts`, replace the `MEALS` and `ADDONS` constants (lines 61-78) and the pricing block (lines 86-111) as follows.

Add to the imports at the top:

```ts
import { ADDON_CATALOGUE, mealsForTrack, type DietaryTrack } from "../lib/domain/menu";
```

Delete the `MEALS` array, the `ADDONS` array, the `clean` helper and the `ORDER_ADDONS` map. In their place:

```ts
/** Which diet each demo customer is on. Their meals and add-ons are drawn from
 *  this track, so nobody is seeded a box their own diet rules out. */
const TRACK_BY_CUSTOMER: Record<string, DietaryTrack> = {
  [C.ava]: "standard",
  [C.marcus]: "standard",
  [C.priya]: "vegetarian",
  [C.diego]: "gluten-free",
  [C.lena]: "standard",
  [C.tom]: "dairy-free",
  [C.sara]: "vegetarian",
  [C.noah]: "standard",
  [C.mia]: "gluten-free",
  [C.jamal]: "dairy-free",
};

// Add-ons by order index, chosen so the refund demos land predictably rather
// than by procedural guessing. Every meal lists at $17.50 and a refund is list
// price + add-ons, so a plain box ($17.50) sits under the $20 ceiling and is
// confirmable, while Noah's two add-ons push FC1020 to $28.48 and over it.
const EXTRA_ORDER_INDICES = new Set([4, 9]); // charged a-la-carte meals (realism)
const ORDER_ADDON_CODES: Record<number, string[]> = {
  4: ["SA1"], // Marcus extra meal (standard) - $4.99
  9: ["VA1"], // Priya extra meal (vegetarian) - $4.99
  19: ["SA3", "SA1"], // Noah FC1020 (standard) - $5.99 + $4.99 → $28.48 refund
};

const addOnByCode = (code: string) => {
  const found = ADDON_CATALOGUE.find((a) => a.code === code);
  if (!found) throw new Error(`Unknown add-on code ${code}`);
  return found;
};

/** Pricing for order i: subscription meals are free (only add-ons cost); extra
 *  meals are charged their list price + add-ons. Refund = list price + add-ons.
 *  Throws if an add-on is not on the customer's own track, so a mismatch fails
 *  the seed rather than shipping a box the customer's diet rules out. */
function orderPricing(i: number, track: DietaryTrack) {
  const picked = (ORDER_ADDON_CODES[i] ?? []).map(addOnByCode);
  for (const a of picked) {
    if (a.track !== track) throw new Error(`Add-on ${a.code} is ${a.track}, not ${track} (order index ${i})`);
  }
  const addOns = picked.map((a) => ({ name: a.name, priceCents: a.priceCents }));
  const kind = EXTRA_ORDER_INDICES.has(i) ? "extra" : "subscription";
  const addSum = addOns.reduce((s, a) => s + a.priceCents, 0);
  const totalCents = kind === "extra" ? MEAL_LIST_PRICE_CENTS + addSum : addSum;
  return { kind, listPriceCents: MEAL_LIST_PRICE_CENTS, addOns, totalCents };
}
```

- [ ] **Step 4: Drop the dead `totalCents` literals from the order rows**

`orderPricing(i)` is spread after these values and overwrites every one, so they are dead and wrong. Change the `orderRows` declaration to:

```ts
/** Order identity, status and dates only. Kind, prices, add-ons, meal and
 *  dietary tags are all computed at insert time from the customer's track. */
type SeedOrder = Omit<
  typeof orders.$inferInsert,
  "orderNumber" | "totalCents" | "kind" | "listPriceCents" | "addOns" | "items" | "dietaryTags"
>;

const orderRows: SeedOrder[] = [
```

Then delete the `totalCents: NNNN,` property from **all 24 order literals**. For example the first two become:

```ts
  { id: O(1), customerId: C.ava, status: "shipped", placedAt: daysAgo(2), deliveryDate: daysFromNow(2) },
  { id: O(2), customerId: C.ava, status: "delivered", placedAt: daysAgo(16), deliveryDate: daysAgoDate(12) },
```

Leave every other property and every comment on those rows untouched.

- [ ] **Step 5: Assign the track to each customer and build the orders from it**

In `main()`, inside the existing `for (const c of customerRows)` loop, add one line after `c.lastReconciledAt = seededAt;`:

```ts
    c.dietaryTrack = TRACK_BY_CUSTOMER[c.id!];
```

Then replace the `pricedOrders` block:

```ts
  // Each order is one meal (FC1001…): subscription meals are free (list price
  // shown struck through), extra meals are charged; both can carry paid add-ons.
  // The meal comes from the CUSTOMER'S track, cycling that track's menu by the
  // customer's own order ordinal.
  const ordinal = new Map<string, number>();
  const pricedOrders = orderRows.map((o, i) => {
    const track = TRACK_BY_CUSTOMER[o.customerId];
    const n = ordinal.get(o.customerId) ?? 0;
    ordinal.set(o.customerId, n + 1);
    const menu = mealsForTrack(track);
    const meal = menu[n % menu.length];
    return {
      ...o,
      orderNumber: `FC${1001 + i}`,
      items: [meal.name],
      dietaryTags: meal.tags,
      ...orderPricing(i, track),
    };
  });
```

- [ ] **Step 6: Reset the database and reseed**

Run: `npm run db:reset`
Expected: the schema pushes, then `✓ 10 customers`, `✓ 24 orders`, `✓ 12 transactions`, `✓ 17 subscription events`, `Done.` No `Unknown add-on code` or `is not <track>` error.

- [ ] **Step 7: Run the coherence tests**

Run: `npx vitest run --config vitest.integration.config.ts tests/integration/seed-coherence.test.ts`
Expected: PASS, 9 tests.

If the config filename differs, check the `test:integration` script in `package.json` and use the config it names.

- [ ] **Step 8: Run the full local gate**

Run: `npm run test:all`
Expected: typecheck, unit, api and integration all pass.

- [ ] **Step 9: Commit**

```bash
git add db/schema.ts db/seed.ts tests/integration/seed-coherence.test.ts && git commit -m "feat: seed meals and add-ons from each customer's dietary track"
```

---

### Task 3: Surface track and tags on the read paths

**Files:**
- Modify: `lib/tools/order-view.ts`
- Modify: `lib/tools/order-view.test.ts`
- Modify: `lib/tools/subscription.ts:38-48`
- Modify: `app/api/account/route.ts:28-39`

**Interfaces:**
- Consumes: `orders.dietaryTags`, `customers.dietaryTrack` from Task 2.
- Produces: `OrderView.dietary_tags: string[]`; `get_subscription` result gains `data.dietary_track`; the account payload's `customer` object gains `dietaryTrack`.

- [ ] **Step 1: Write the failing tests**

In `lib/tools/order-view.test.ts`, add `dietaryTags: ["standard"],` to the `row()` fixture object, just after the `items: ["Beef Tacos"],` line. Then add these two tests inside the existing `describe("orderView", ...)` block:

```ts
  it("surfaces the meal's dietary tags", () => {
    const v = orderView(row({ dietaryTags: ["vegetarian", "gluten-free"] }));
    expect(v.dietary_tags).toEqual(["vegetarian", "gluten-free"]);
  });

  it("treats absent dietary tags as none", () => {
    expect(orderView(row({ dietaryTags: null })).dietary_tags).toEqual([]);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/tools/order-view.test.ts`
Expected: FAIL - `Property 'dietary_tags' does not exist on type 'OrderView'`.

- [ ] **Step 3: Add the field to the order view**

In `lib/tools/order-view.ts`, add to the `OrderView` interface after `items: string[];`:

```ts
  /** Dietary tracks this meal satisfies, as packed. */
  dietary_tags: string[];
```

And in the object returned by `orderView`, after `items: o.items ?? [],`:

```ts
    dietary_tags: o.dietaryTags ?? [],
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/tools/order-view.test.ts`
Expected: PASS.

- [ ] **Step 5: Return the track from `get_subscription`**

In `lib/tools/subscription.ts`, in the `getSubscription` handler's return, add to `data` after `plan: customer.plan,`:

```ts
        dietary_track: customer.dietaryTrack,
```

And update the tool's `description` string to end with:

```
... ALWAYS call this to answer any question about the customer's current status, plan, dietary track, billing date, or pause length; never answer those from earlier conversation.
```

- [ ] **Step 6: Return the track from the account route**

In `app/api/account/route.ts`, add to the `customer` object in the JSON response, after `plan: customer.plan,`:

```ts
      dietaryTrack: customer.dietaryTrack,
```

- [ ] **Step 7: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: no type errors, all unit tests pass.

- [ ] **Step 8: Commit**

```bash
git add lib/tools/order-view.ts lib/tools/order-view.test.ts lib/tools/subscription.ts app/api/account/route.ts && git commit -m "feat: surface dietary track and per-order tags on the read paths"
```

---

### Task 4: The action route that writes the track

Built before the tool, because it is the only thing that writes and it can be tested end to end on its own.

**Files:**
- Modify: `tests/helpers/db.ts`
- Create: `app/api/actions/dietary-track/route.ts`
- Test: `tests/api/dietary-track.test.ts`

**Interfaces:**
- Consumes: `isDietaryTrack` from Task 1, `customers.dietaryTrack` from Task 2.
- Produces: `POST /api/actions/dietary-track` accepting `{ customerId: string, track: string }` and returning `{ ok: true, dietary_track: string, previous_track: string }` on success. `TestCustomerInput` gains an optional `dietaryTrack`.

- [ ] **Step 1: Let test customers set a track**

In `tests/helpers/db.ts`, add to the `TestCustomerInput` interface:

```ts
  dietaryTrack?: string;
```

And to the `db.insert(customers).values({...})` call in `createTestCustomer`, after the `plan:` line:

```ts
    dietaryTrack: input.dietaryTrack ?? "standard",
```

- [ ] **Step 2: Write the failing test**

Create `tests/api/dietary-track.test.ts`:

```ts
import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { setClock } from "@/lib/clock";
import { POST } from "@/app/api/actions/dietary-track/route";
import { createTestCustomer, customerOf, eventsOf, purgeCustomer, txnsOf } from "../helpers/db";
import { postJson } from "../helpers/http";

const OWNER = "88888888-8888-8888-8888-888888880020";
const TODAY = new Date(2026, 6, 20); // 20 July 2026, local midnight

describe("POST /api/actions/dietary-track", () => {
  beforeEach(async () => {
    setClock(() => TODAY);
    await createTestCustomer({ id: OWNER, billingDate: "2026-08-17", dietaryTrack: "standard" });
  });
  afterEach(() => setClock(null));
  afterAll(async () => {
    await purgeCustomer(OWNER);
  });

  it("rejects a request with no track", async () => {
    const res = await postJson(POST, { customerId: OWNER });
    expect(res.status).toBe(400);
  });

  it("rejects a track that is not one of ours", async () => {
    const res = await postJson(POST, { customerId: OWNER, track: "pescatarian" });

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: "unknown_track" });
    expect((await customerOf(OWNER)).dietaryTrack).toBe("standard");
  });

  it("switches the track and logs one audit event", async () => {
    const res = await postJson(POST, { customerId: OWNER, track: "vegetarian" });

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, dietary_track: "vegetarian", previous_track: "standard" });
    expect((await customerOf(OWNER)).dietaryTrack).toBe("vegetarian");
    expect(await eventsOf(OWNER)).toEqual(["diet_changed"]);
  });

  it("moves no money", async () => {
    await postJson(POST, { customerId: OWNER, track: "dairy-free" });
    expect(await txnsOf(OWNER)).toEqual([]);
  });

  it("is idempotent: a replayed confirmation writes no second event", async () => {
    const first = await postJson(POST, { customerId: OWNER, track: "gluten-free" });
    const second = await postJson(POST, { customerId: OWNER, track: "gluten-free" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "same_track" });
    expect(await eventsOf(OWNER)).toEqual(["diet_changed"]);
  });

  it("404s an unknown customer", async () => {
    const res = await postJson(POST, { customerId: "88888888-8888-8888-8888-888888889999", track: "vegetarian" });
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npx vitest run --config vitest.api.config.ts tests/api/dietary-track.test.ts`
Expected: FAIL - cannot resolve `@/app/api/actions/dietary-track/route`.

- [ ] **Step 4: Write the route**

Create `app/api/actions/dietary-track/route.ts`:

```ts
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers, subscriptionEvents } from "@/db/schema";
import { isDietaryTrack } from "@/lib/domain/menu";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface DietaryTrackBody {
  customerId?: string;
  track?: string;
}

/**
 * Applies a dietary-track switch and logs it. Called by the confirmation
 * prompt, never the model. Switching track is free, so no ledger row is
 * written - the audit event is the whole record.
 */
export async function POST(req: NextRequest) {
  let body: DietaryTrackBody;
  try {
    body = (await req.json()) as DietaryTrackBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const { customerId, track } = body;
  if (!customerId || !track) return new Response("Missing customerId or track", { status: 400 });
  if (!isDietaryTrack(track)) return Response.json({ ok: false, error: "unknown_track" }, { status: 400 });

  await reconcile(customerId, now());
  const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
  if (!customer) return new Response("Unknown customer", { status: 404 });
  if (customer.dietaryTrack === track) {
    // Nothing to change - do not log a diet_changed event for a non-change.
    return Response.json({ ok: false, error: "same_track" }, { status: 409 });
  }

  await db.update(customers).set({ dietaryTrack: track }).where(eq(customers.id, customerId));
  await db.insert(subscriptionEvents).values({
    customerId,
    eventType: "diet_changed",
    metadata: { from: customer.dietaryTrack, to: track },
  });

  return Response.json({ ok: true, dietary_track: track, previous_track: customer.dietaryTrack });
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run --config vitest.api.config.ts tests/api/dietary-track.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 6: Run the whole api layer**

Run: `npm run test:api`
Expected: all route tests pass.

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/db.ts app/api/actions/dietary-track/route.ts tests/api/dietary-track.test.ts && git commit -m "feat: add the dietary-track action route"
```

---

### Task 5: The `change_dietary_track` tool

**Files:**
- Create: `lib/tools/dietary.ts`
- Modify: `lib/tools/index.ts`
- Modify: `lib/agent/dispatch.ts:5-12`
- Modify: `lib/domain/terms.ts`
- Test: `lib/agent/dispatch.test.ts` (create if absent - check first)

**Interfaces:**
- Consumes: `DIETARY_TRACKS`, `isDietaryTrack`, `mealsForTrack` from Task 1; `customers.dietaryTrack` from Task 2.
- Produces: the `changeDietaryTrack` tool, registered as the 12th entry of `tools`. Its `needs_confirmation` payload is `proposal: { current_track: string, new_track: string, effective_from: string, meals_preview: string[] }`, mapped to the SSE event `diet_change_proposal`.

- [ ] **Step 1: Write the failing dispatch test**

`lib/agent/dispatch.test.ts` already exists and defines its own `call(name, id, args)` and `freshState()` helpers, where `args` is a JSON **string**. Add this test inside the existing `describe("dispatchTool", ...)` block, reusing those helpers - do not redefine them:

```ts
  it("raises a diet_change_proposal card for change_dietary_track", () => {
    const proposal = {
      current_track: "standard",
      new_track: "vegetarian",
      effective_from: "2026-07-30",
      meals_preview: ["Paneer Butter Masala & Basmati"],
    };
    const result: ToolResult = {
      ok: true,
      summary: "Proposed switch to vegetarian",
      data: { status: "needs_confirmation", proposal },
    };
    const out = dispatchTool(call("change_dietary_track", "c1", '{"track":"vegetarian"}'), result, freshState());
    expect(out.events.find((e) => e.event === "diet_change_proposal")?.data).toEqual(proposal);
  });
```

Dedupe does not need its own test here: the existing "emits a proposal event once and suppresses the duplicate" test already covers that path generically, and the new tool inherits it by being in `PROPOSAL_EVENTS`.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run lib/agent/dispatch.test.ts`
Expected: FAIL - the `diet_change_proposal` event is `undefined`.

- [ ] **Step 3: Register the SSE event**

In `lib/agent/dispatch.ts`, add to `PROPOSAL_EVENTS` after the `cancel_subscription` line:

```ts
  change_dietary_track: "diet_change_proposal",
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run lib/agent/dispatch.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the tool**

Create `lib/tools/dietary.ts`:

```ts
import { eq } from "drizzle-orm";
import { db } from "../../db";
import { customers } from "../../db/schema";
import { DIETARY_TRACKS, isDietaryTrack, mealsForTrack } from "../domain/menu";
import { addWeeksIso } from "../date";
import type { Tool } from "./types";

/**
 * Switching dietary track costs nothing and moves no money, but it still goes
 * through propose→confirm like every other account change: the model proposes,
 * the customer confirms, and only /api/actions/dietary-track writes. A misread
 * request ("my sister is vegetarian") must not be able to move a coeliac
 * customer off the gluten-free track on its own.
 */
export const changeDietaryTrack: Tool = {
  definition: {
    name: "change_dietary_track",
    description:
      "Switch the current customer's dietary track. Valid tracks: standard, gluten-free, vegetarian, dairy-free. Calling this shows a confirmation prompt with the new track and a few of its meals; it does NOT change anything until they confirm. Don't ask them to confirm before calling.",
    parameters: {
      type: "object",
      properties: {
        track: {
          type: "string",
          enum: [...DIETARY_TRACKS],
          description: "The dietary track to switch to.",
        },
      },
      required: ["track"],
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const requested = typeof args.track === "string" ? args.track.trim().toLowerCase() : "";
    if (!isDietaryTrack(requested)) {
      return {
        ok: false,
        summary: `Unknown track "${String(args.track)}"`,
        data: { message: `That isn't one of our dietary tracks. Offer them: ${DIETARY_TRACKS.join(", ")}.` },
      };
    }

    const [customer] = await db.select().from(customers).where(eq(customers.id, ctx.customerId)).limit(1);
    if (!customer) return { ok: false, summary: "Customer not found." };

    if (customer.dietaryTrack === requested) {
      return {
        ok: true,
        summary: `Already on ${requested}`,
        data: {
          status: "no_change",
          dietary_track: requested,
          message: "They are already on that track. Tell them so; there is nothing to confirm.",
        },
      };
    }

    return {
      ok: true,
      summary: `Proposed switch to ${requested}`,
      data: {
        status: "needs_confirmation",
        proposal: {
          current_track: customer.dietaryTrack,
          new_track: requested,
          effective_from: addWeeksIso(1, ctx.now),
          meals_preview: mealsForTrack(requested).slice(0, 3).map((m) => m.name),
        },
        message:
          "A confirmation prompt shows the new track and a few of its meals. The switch applies from next week's menu; boxes already processing or shipped are packed and keep their meals. Ask them to confirm; do NOT say it's changed until they confirm.",
      },
    };
  },
};
```

- [ ] **Step 6: Register the tool**

In `lib/tools/index.ts`, add the import after the `escalate` import:

```ts
import { changeDietaryTrack } from "./dietary";
```

and add `changeDietaryTrack,` to the `tools` array, after `changePlan,`.

- [ ] **Step 7: Add the domain rule the prompt reads**

In `lib/domain/terms.ts`, add to the `RULES` object after the `subscriptionFree` entry:

```ts
  dietary:
    "Meals come on one of four dietary tracks: standard, gluten-free, vegetarian, dairy-free. Every track costs the same - plan meals are free on all of them. Call get_subscription to find out which track the customer is on; never assume. To switch track, call change_dietary_track (propose→confirm); the switch applies from next week's menu and boxes already processing or shipped keep their meals. All meals are halal-certified and contain no pork, pork derivatives or alcohol. A standard-track meal that happens to contain no gluten or dairy is NOT prepared under gluten-free or dairy-free controls - never describe one as gluten-free or dairy-free.",
```

- [ ] **Step 8: Typecheck and run the suite**

Run: `npm run typecheck && npm test`
Expected: no type errors; all unit tests pass.

- [ ] **Step 9: Commit**

```bash
git add lib/tools/dietary.ts lib/tools/index.ts lib/agent/dispatch.ts lib/agent/dispatch.test.ts lib/domain/terms.ts && git commit -m "feat: add the change_dietary_track tool and its proposal event"
```

---

### Task 6: The confirmation card

**Files:**
- Modify: `app/chat.tsx`

**Interfaces:**
- Consumes: the `diet_change_proposal` SSE event from Task 5 and `POST /api/actions/dietary-track` from Task 4.
- Produces: a card with `data-testid="diet-card"`, a confirm button labelled `Yes, switch my meals` and a decline button labelled `Not now`. Task 7's Cypress specs depend on those three strings exactly.

- [ ] **Step 1: Add the proposal type and message fields**

After the `CancelProposal` interface (around line 119), add:

```tsx
interface DietChangeProposal {
  current_track: string;
  new_track: string;
  effective_from: string;
  meals_preview: string[];
}
```

In the `Message` interface, after `cancelState?: ProposalState;`:

```tsx
  dietProposal?: DietChangeProposal;
  dietState?: ProposalState;
```

In `AccountData["customer"]`, after `plan: string;`:

```tsx
    dietaryTrack?: string | null;
```

In the `OrderView` interface, after `items: string[];` (or wherever `items` sits):

```tsx
  dietary_tags?: string[];
```

In `TOOL_LABELS`, after the `change_plan` entry:

```tsx
  change_dietary_track: "Preparing a dietary change",
```

- [ ] **Step 2: Add the state setter and the confirm handler**

After the `setPlanState` function (around line 268):

```tsx
  function setDietState(index: number, state: ProposalState) {
    setMessages((prev) => prev.map((m, i) => (i === index ? { ...m, dietState: state } : m)));
  }
```

After the `confirmPlanChange` function (around line 297):

```tsx
  async function confirmDietChange(index: number, proposal: DietChangeProposal) {
    const ok = await postAction("/api/actions/dietary-track", { customerId, track: proposal.new_track });
    setDietState(index, ok ? "approved" : "error");
    if (ok) refreshCustomers();
  }
```

- [ ] **Step 3: Handle the SSE event**

In `handleEvent`, after the `cancel_proposal` branch:

```tsx
    } else if (event === "diet_change_proposal") {
      patchLast({ dietProposal: data as DietChangeProposal, dietState: "pending" });
```

- [ ] **Step 4: Pass the handlers down**

In the `<MessageBubble ... />` call, after the `onDeclineCancel` prop:

```tsx
                onConfirmDiet={() => m.dietProposal && confirmDietChange(i, m.dietProposal)}
                onDeclineDiet={() => setDietState(i, "declined")}
```

In `MessageBubble`'s destructured parameters, after `onDeclineCancel,`:

```tsx
  onConfirmDiet,
  onDeclineDiet,
```

and in its props type, after `onDeclineCancel: () => void;`:

```tsx
  onConfirmDiet: () => void;
  onDeclineDiet: () => void;
```

In the `showThinking` expression, add a final clause so a card-only turn stops showing the spinner:

```tsx
    !message.planProposal &&
    !message.dietProposal;
```

- [ ] **Step 5: Render the card**

After the `CancelCard` block in `MessageBubble`'s JSX:

```tsx
        {!isUser && showResults && message.dietProposal && (
          <DietCard
            proposal={message.dietProposal}
            state={message.dietState ?? "pending"}
            onConfirm={onConfirmDiet}
            onDecline={onDeclineDiet}
          />
        )}
```

- [ ] **Step 6: Write the card component**

After the `CancelCard` function definition:

```tsx
function DietCard({
  proposal,
  state,
  onConfirm,
  onDecline,
}: {
  proposal: DietChangeProposal;
  state: ProposalState;
  onConfirm: () => void;
  onDecline: () => void;
}) {
  return (
    <div data-testid="diet-card" className="mt-3 rounded-lg border border-lime-200 bg-lime-50 p-3">
      <p className="text-[10px] font-semibold uppercase tracking-wide text-lime-700">Dietary track</p>
      <p className="mt-1 text-sm text-slate-800">
        Switch from <span className="font-semibold">{proposal.current_track}</span> to{" "}
        <span className="font-semibold">{proposal.new_track}</span> meals?
      </p>
      {proposal.meals_preview.length > 0 && (
        <p className="mt-1 text-xs text-slate-600">For example: {proposal.meals_preview.join(", ")}.</p>
      )}
      <p className="mt-1 text-xs text-slate-500">
        Free to switch. It applies from next week&apos;s menu ({fmtDate(proposal.effective_from)}); boxes already on
        their way keep the meals they were packed with.
      </p>

      {state === "pending" && (
        <div className="mt-2 flex gap-2">
          <button onClick={onConfirm} className="rounded-md bg-brand px-3 py-1.5 text-xs font-medium text-white transition hover:bg-brand-dark">
            Yes, switch my meals
          </button>
          <button onClick={onDecline} className="rounded-md border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-600 transition hover:bg-slate-50">
            Not now
          </button>
        </div>
      )}
      {state === "approved" && <p className="mt-2 text-xs font-medium text-emerald-700">✓ Switched to {proposal.new_track} meals from next week.</p>}
      {state === "declined" && <p className="mt-2 text-xs font-medium text-slate-500">No problem - your meals are unchanged.</p>}
      {state === "error" && <p className="mt-2 text-xs font-medium text-red-600">Couldn&apos;t switch your meals - please try again.</p>}
    </div>
  );
}
```

- [ ] **Step 7: Show the track in the account panel**

In `AccountPanel`, add a row to the `rows` array between `["Plan", c.plan]` and `["Subscription", c.subscriptionStatus]`:

```tsx
    ["Dietary track", c.dietaryTrack],
```

- [ ] **Step 8: Typecheck and lint**

Run: `npm run typecheck && npm run lint`
Expected: no errors. If `lint` is not a script in `package.json`, run `npx next lint` instead.

- [ ] **Step 9: Verify the app still compiles**

Run: `npm run build`
Expected: compiles with no type or lint errors.

Do not try to exercise the card by hand yet. The mock provider has no script for a dietary question until Task 7, so asking for one now answers "(mock) No script for this input". Task 7 adds the script and the E2E specs that actually drive the card.

- [ ] **Step 10: Commit**

```bash
git add app/chat.tsx && git commit -m "feat: add the dietary-track confirmation card"
```

---

### Task 7: End-to-end coverage

`lib/llm/mock-scripts.test.ts` binds scripts to specs in both directions: a script with no spec fails, and a spec question with no script fails. Both files change together.

**Files:**
- Modify: `lib/llm/mock-scripts.ts`
- Modify: `cypress/e2e/agent.cy.ts`
- Modify: `cypress/e2e/confirm.cy.ts`

**Interfaces:**
- Consumes: the card from Task 6, the tool from Task 5, the route from Task 4.
- Produces: two new E2E specs. Ava Chen is on the `standard` track per Task 2, so switching her to vegetarian is a real change and the route will not answer `same_track`.

- [ ] **Step 1: Add the mock script**

In `lib/llm/mock-scripts.ts`, add to `MOCK_SCRIPTS` before the `"what's the capital of france?"` entry:

```ts
  "switch me to vegetarian meals": {
    pre_tool: [call("change_dietary_track", { track: "vegetarian" })],
    post_tool: [t("I can move you onto our vegetarian menu - confirm below and it starts with next week's box.")],
  },
```

- [ ] **Step 2: Add the read-only spec**

In `cypress/e2e/agent.cy.ts`, add inside the existing top-level `describe`:

```ts
  it("a dietary-track switch shows a single confirmation card", () => {
    signInAs("Ava Chen");
    ask("switch me to vegetarian meals");
    cy.get('[data-testid="diet-card"]').should("have.length", 1);
    cy.get('[data-testid="diet-card"]').should("contain.text", "vegetarian");
    cy.contains("button", "Yes, switch my meals").should("exist");
  });
```

If `agent.cy.ts` imports its helpers differently from `confirm.cy.ts`, match the file's existing import line rather than adding a new one.

- [ ] **Step 3: Add the mutating spec**

In `cypress/e2e/confirm.cy.ts`, add inside the existing `describe`:

```ts
  it("confirming a dietary switch applies it and reports it on the card", () => {
    signInAs("Ava Chen");
    ask("switch me to vegetarian meals");
    cy.get('[data-testid="diet-card"]').should("have.length", 1);

    cy.contains("button", "Yes, switch my meals").click();

    cy.get('[data-testid="diet-card"]').should("contain.text", "Switched to vegetarian");
    cy.contains("button", "Yes, switch my meals").should("not.exist");
  });
```

Note the comment at the top of `confirm.cy.ts`: these specs mutate the database, so `npm run test:e2e` reseeds first. Running Cypress twice without a reseed will fail this spec with `same_track` on the second run. That is the same constraint the refund spec already has.

- [ ] **Step 4: Verify the script-to-spec binding**

Run: `npx vitest run lib/llm/mock-scripts.test.ts`
Expected: PASS. If it fails with "script has no spec" or "spec has no script", the question text in the spec and the key in `MOCK_SCRIPTS` differ - they must match exactly after lowercasing and whitespace collapsing.

- [ ] **Step 5: Run the full E2E suite**

Run: `npm run test:e2e`
Expected: all specs pass, including the two new ones. This reseeds the database first.

- [ ] **Step 6: Commit**

```bash
git add lib/llm/mock-scripts.ts cypress/e2e/agent.cy.ts cypress/e2e/confirm.cy.ts && git commit -m "test: cover the dietary-track switch end to end"
```

---

### Task 8: Knowledge base

**Files:**
- Create: `kb/articles/menu-and-dietary-tracks.md`
- Rewrite: `kb/articles/dietary-options.md`
- Modify: `kb/articles/pricing-and-plans.md`
- Modify: `kb/articles/plan-changes.md:12-13`
- Modify: `kb/articles/getting-started.md:7`
- Modify: `scripts/test-retrieval.ts:24`

**Interfaces:**
- Consumes: the prices and tracks from Task 1.
- Produces: a new citation slug `menu-and-dietary-tracks`. Each `##` section becomes one `kb_chunks` row, so headings must be specific enough to cite.

- [ ] **Step 1: Write the new article**

Create `kb/articles/menu-and-dietary-tracks.md`:

```markdown
# Menu, Dietary Tracks & Add-on Prices

## Our four dietary tracks
Every FreshCrate menu is built on one of four dietary tracks, and you pick the one that suits you:

- **Standard** - no restrictions.
- **Gluten-Free** - excludes wheat, barley, rye and malt.
- **Vegetarian** - no meat, poultry, fish or seafood. Contains dairy and eggs.
- **Dairy-Free** - no milk, butter, cream, cheese, yoghurt, ghee, whey or casein. We use olive oil or a plant spread instead of butter.

Each track offers 8 meals and 5 add-ons each week. Every track costs exactly the same: there is no surcharge for choosing a specialist track.

## What every meal costs
Every meal on every track lists at **$17.50**. The meals included in your weekly plan are **free** as part of your subscription - you will see the $17.50 list price struck through with "Free" next to it in your orders. That is true on all four tracks.

Extra meals ordered beyond your plan are charged at the $17.50 list price. Add-ons are always charged on top, whether they come with a plan meal or an extra one.

## Add-on prices
Add-ons are priced by type, so the price is the same wherever an item appears on the menu:

| Type | Price |
|---|---|
| Sides | $4.99 |
| Desserts | $5.99 |
| Drinks | $3.49 |

For example, Garlic Parmesan Bread and Rosemary Sweet Potato Fries are both sides at $4.99; a Chocolate Fudge Brownie or a Flourless Chocolate Torte is $5.99; a Mango Lassi or a Cold-Pressed Green Juice is $3.49.

## Standard menu
Herb Roast Chicken & Garlic Mash · Beef Lasagne · Teriyaki Salmon Rice Bowl · Chicken Tikka Masala & Basmati · Beef Smash Burger & Fries · Creamy Mushroom Chicken Pasta · Lamb Kofta & Couscous · Turkey Meatball Marinara Sub.

Add-ons: Garlic Parmesan Bread, Caesar Side Salad, Chocolate Fudge Brownie, Sparkling Lemonade, Mango Cheesecake Slice.

## Gluten-Free menu
Lemon Herb Grilled Chicken & Quinoa · Thai Green Curry with Jasmine Rice · Grilled Salmon & Sweet Potato Mash · Beef Chilli & Rice Bowl · Chicken Shawarma Rice Plate · Prawn & Chorizo-Free Paella · Turkey & Vegetable Frittata · Corn Tortilla Beef Tacos.

Add-ons: Rosemary Sweet Potato Fries, Greek Salad with Feta, Flourless Chocolate Torte, Cold-Pressed Green Juice, Coconut Rice Pudding.

## Vegetarian menu
Paneer Butter Masala & Basmati · Wild Mushroom Risotto · Halloumi & Roast Vegetable Grain Bowl · Spinach & Ricotta Cannelloni · Chickpea & Spinach Curry · Falafel Mezze Plate · Margherita Flatbread & Rocket · Black Bean & Sweet Corn Burrito Bowl.

Add-ons: Truffle Mac & Cheese Cup, Roasted Beet & Goat Cheese Salad, Tiramisu-Style Coffee Cream Pot, Mango Lassi, Warm Apple Crumble & Custard.

## Dairy-Free menu
Moroccan Chicken Tagine & Couscous · Coconut Chicken Curry & Rice · Grilled Sea Bass & Herb Potatoes · Beef Stir-Fry with Rice Noodles · Lentil & Vegetable Shepherd's Pie · Harissa Roast Chicken & Freekeh · Teriyaki Tofu & Soba Noodles · Cajun Prawn & Dirty Rice.

Add-ons: Rosemary Sea Salt Potato Wedges, Miso Glazed Aubergine, Dark Chocolate & Almond Bark, Iced Oat Matcha Latte, Coconut Sorbet with Passionfruit.

## Meals that suit more than one diet
Some meals qualify for more than one track. Thai Green Curry is gluten-free and dairy-free; Chickpea & Spinach Curry is vegetarian, gluten-free and dairy-free; Lentil & Vegetable Shepherd's Pie is dairy-free, vegetarian and gluten-free. Each meal in your order history is labelled with every diet it suits.

Meals on the **Standard** track carry no dietary guarantee, even where they contain no gluten or no dairy. Only meals on the Gluten-Free and Dairy-Free tracks are prepared under those controls, so if you need to avoid an ingredient, choose the matching track rather than picking a Standard meal that looks safe.

## Halal and kosher
All FreshCrate meals are **halal-certified**. No pork, pork derivatives or alcohol is used anywhere in our kitchens, on any track, in any meal or add-on. That also makes our meals suitable for many kosher-observant customers, though we are not kosher-certified.

## Changing your dietary track
You can switch tracks any time, on any plan, and it is free. Ask in chat and we will show you the new menu to confirm. The switch applies from **next week's menu**, so a box that is already processing or shipped keeps the meals it was packed with. Switching track does not change how many meals you get each week or what you pay - to change that, change your plan.
```

- [ ] **Step 2: Rewrite the dietary options article**

Replace the whole of `kb/articles/dietary-options.md` with:

```markdown
# Dietary Options & Recipe Preferences

## Available dietary tracks
FreshCrate offers four dietary tracks: **Standard**, **Gluten-Free**, **Vegetarian** and **Dairy-Free**. Your track decides which weekly menu you are offered - 8 meals and 5 add-ons per track. Every track costs the same, and the meals in your plan are free on all of them. You can set or change your track from **Account → Preferences**, or just ask in chat. See the menu article for what is on each track.

## Allergens and ingredient information
Every recipe lists its ingredients and major allergens (such as nuts, dairy, gluten, soy and shellfish) on the recipe card and in the app. FreshCrate prepares ingredients in facilities that handle common allergens, so we can't guarantee a recipe is fully free of cross-contact.

A meal on the Standard track that happens to contain no gluten or no dairy is not the same as a Gluten-Free or Dairy-Free track meal: only the specialist tracks are prepared under those controls. If you need to avoid an ingredient, pick the matching track.

## Choosing your weekly recipes
Even with a track set, you can hand-pick each week's recipes from that track's menu before the Wednesday cutoff. If you don't choose, we auto-select recipes from your track. There's no extra charge for any track.

## Customizing or swapping proteins
Some recipes let you swap the default protein (for example, chicken for tofu) for a small surcharge shown at checkout. Protein swaps are set per recipe, per week, and don't change your track or your plan.
```

- [ ] **Step 3: Fix the two articles that reference the old preferences**

In `kb/articles/plan-changes.md`, replace the "Dietary preference vs. plan" section body with:

```markdown
Changing your dietary track (Standard, Gluten-Free, Vegetarian or Dairy-Free) is separate from changing your plan size. You can switch track without changing how many meals you get, and it's free - see the dietary options article.
```

In `kb/articles/getting-started.md`, in the sign-up paragraph, replace `set any dietary preferences` with:

```
choose your dietary track (Standard, Gluten-Free, Vegetarian or Dairy-Free)
```

- [ ] **Step 4: Point the pricing article at the add-on prices**

In `kb/articles/pricing-and-plans.md`, in the "How meals are priced" section, after the sentence ending "whether the meal is a plan meal or an extra one.", add:

```markdown
Add-ons are priced by type: **sides $4.99, desserts $5.99, drinks $3.49**. The menu article lists what is on each dietary track.
```

- [ ] **Step 5: Update the retrieval gate case**

In `scripts/test-retrieval.ts`, replace the case on line 24 with two cases:

```ts
  { q: "What dietary options do you have?", expect: "dietary-options" },
  { q: "How much do add-ons cost?", expect: "menu-and-dietary-tracks" },
```

- [ ] **Step 6: Re-embed the knowledge base**

Run: `npm run kb:ingest`
Expected: it reports the chunk count and finishes. This calls the OpenAI embeddings API and costs a small amount.

- [ ] **Step 7: Run the retrieval gate**

Run: `npm run kb:test`
Expected: all cases pass.

If a case now fails because the new article outranks an older one, fix it rather than loosening it. Judge by what a customer asking that question actually wants: if the new article is the better answer, update that case's `expect`; if not, make the older article's heading more specific so it wins on its own topic.

- [ ] **Step 8: Commit**

```bash
git add kb/articles scripts/test-retrieval.ts && git commit -m "docs: add the menu article and align the KB on four dietary tracks"
```

---

### Task 9: Documentation and the source catalogue

**Files:**
- Modify: `C:\Users\ahase\Documents\Obsidian Vault\Work\Personal Work Projects\FreshCrate AI Chatbot\meal-catalogue.md`
- Modify: `kb/README.md`
- Modify: `docs/DOMAIN.md`
- Modify: `docs/PROJECT_STATE.md`

**Interfaces:**
- Consumes: everything above. Produces no code.

- [ ] **Step 1: Add prices to the source catalogue**

In the Obsidian vault file, add a `Price` column to all eight tables, immediately after the `Description` column on meal tables and after the `Type` column on add-on tables.

Every meal row gets `$17.50`. Add-on rows get `$4.99` for a Side, `$5.99` for a Dessert, `$3.49` for a Drink.

Also update the intro line under the title to read:

```markdown
Reference data for the chatbot knowledge base. Four dietary tracks, each with 8 meals and 5 add-ons. Every meal is $17.50 and is included free as part of any meal plan; add-ons are charged on top, priced by type (Side $4.99, Dessert $5.99, Drink $3.49).
```

Leave the nutrition columns, the notes and the implementation section as they are.

- [ ] **Step 2: Correct the KB article count**

In `kb/README.md`, change `12 help articles` to `15 help articles`. There were already 14 before this change, so this fixes a stale number as well as counting the new one.

- [ ] **Step 3: Update the domain doc**

In `docs/DOMAIN.md`, add a section after the "Orders" section:

```markdown
## Menu & dietary tracks
- Four tracks: `standard`, `gluten-free`, `vegetarian`, `dairy-free`. Each has 8 meals
  and 5 add-ons. `lib/domain/menu.ts` is the source; `MEAL_CATALOGUE` / `ADDON_CATALOGUE`.
- **Add-on prices are flat by type**: side $4.99, dessert $5.99, drink $3.49. Meals are
  all $17.50 (`MEAL_LIST_PRICE_CENTS`) and free on a plan, on every track.
- **Tagging rule:** an item always carries its own track, and another track only when
  nothing in it is excluded by that track. A `standard` item is NEVER tagged into a
  specialist track - standard meals are not prepared under gluten-free or dairy-free
  controls. `orders.dietary_tags` snapshots the meal's tags when the box was packed.
- **Halal:** every meal is halal-certified; no pork, pork derivatives or alcohol
  anywhere. Kosher-friendly, not kosher-certified.
- **Changing track** (propose→confirm): `change_dietary_track` proposes,
  `/api/actions/dietary-track` writes. Free, allowed in any subscription status,
  effective from next week's menu; in-flight orders keep their meals. Writes a
  `diet_changed` subscription event and no ledger row.
```

In the same file, add `diet_changed` to the `subscription_events` event-type list.

- [ ] **Step 4: Update the project state doc**

In `docs/PROJECT_STATE.md`:

- Section 5: add `diet_change_proposal` to the list of SSE events.
- Section 5, "The 11 tools" heading: change to "The 12 tools" and add `change_dietary_track` to the list.
- Section 6: add `dietaryTrack` to the **customers** bullet and `dietaryTags` to the **orders** bullet.
- Section 7: add a bullet:
  `**Dietary tracks:** four tracks (standard / gluten-free / vegetarian / dairy-free), same price on all. Add-ons flat by type: side $4.99, dessert $5.99, drink $3.49. Switching track is free, propose→confirm, effective next week.`
- Section 9: update the demo-customer line to name each customer's track, and note that meals and add-ons are drawn from it.
- Update the `_Last updated:_` line to `2026-07-23`.

- [ ] **Step 5: Run the full gate one last time**

Run each in order:

```bash
npm run test:all
```

```bash
npm run kb:test
```

```bash
npm run test:e2e
```

Expected: all three pass.

- [ ] **Step 6: Commit**

```bash
git add kb/README.md docs/DOMAIN.md docs/PROJECT_STATE.md && git commit -m "docs: document the menu catalogue, dietary tracks and track switching"
```

The Obsidian vault file is outside this repository and is not committed.

---

## Verification Summary

| Gate | Command | Covers |
|---|---|---|
| Unit | `npm test` | menu catalogue, order view, dispatch event |
| Types | `npm run typecheck` | every touched file |
| Route | `npm run test:api` | the dietary-track route's writes and guards |
| Integration | `npm run test:integration` | seed track/tag coherence, refund demo amounts |
| Retrieval | `npm run kb:test` | the new article does not break citation quality |
| E2E | `npm run test:e2e` | card renders, confirm applies, nothing else regresses |
| Build | `npm run build` | the app compiles with the new card |
