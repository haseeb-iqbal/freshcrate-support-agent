# Menu Pricing & Dietary Tracks - Design

_2026-07-23. Source: the FreshCrate subscription meal catalogue (four dietary tracks, 32 meals, 20 add-ons), authored outside this repo._

Turns the meal catalogue into priced, queryable domain data: add-on prices, a real menu in `lib/domain`, dietary tags on orders, a dietary track on customers, a knowledge-base article, and a new propose-confirm flow that lets a customer switch track in chat.

## 1. Goals

1. Give every add-on a price. Meals are already $17.50 (`MEAL_LIST_PRICE_CENTS`); add-on prices are currently invented per order in the seed.
2. Publish a knowledge-base article covering the menu, add-on prices, the "plan meals are free" rule, and the halal position.
3. Seed the database from the real catalogue without breaking any price assertion in the test suite.
4. Let a customer change their dietary track through the chatbot.

## 2. Non-goals

- No `meals` / `add_ons` tables. The catalogue lives in code; orders keep denormalised `items` and `add_ons`.
- No allergen field. The catalogue flags DA3 / VA1 / G5 as needing one, and "does my box contain nuts?" is a real support question, but it is out of scope here.
- No change to plan prices, the refund ceiling, the pause fee, or any existing money rule.

## 3. Add-on pricing

Flat by type. One rule the agent can state without error, one number per type to test, and the same add-on now costs the same in every order.

| Type | Price | Count |
|---|---|---|
| Side | $4.99 (`499`) | 8 |
| Dessert | $5.99 (`599`) | 8 |
| Drink | $3.49 (`349`) | 4 |

Meals stay at $17.50: free on a plan, charged at list price as an extra, refunded at list price plus add-ons. Unchanged.

This replaces the ad-hoc `499` / `351` values in `db/seed.ts`, where "Garlic Bread" cost two different amounts in two different orders purely to make Noah's refund land above the $20 ceiling.

## 4. `lib/domain/menu.ts` (new)

Sits beside `terms.ts` as domain truth, not fixture data, so a future tool can name available meals without reaching into the seed.

```ts
export const DIETARY_TRACKS = ["standard", "gluten-free", "vegetarian", "dairy-free"] as const;
export type DietaryTrack = (typeof DIETARY_TRACKS)[number];

export const ADDON_PRICE_CENTS = { side: 499, dessert: 599, drink: 349 } as const;

export interface Meal  { code: string; name: string; description: string; track: DietaryTrack; tags: DietaryTrack[]; kcal: number; protein: number; carbs: number; fat: number }
export interface AddOn { code: string; name: string; type: keyof typeof ADDON_PRICE_CENTS; track: DietaryTrack; tags: DietaryTrack[]; priceCents: number; kcal: number }

export const MEAL_CATALOGUE: Meal[]   // 32
export const ADDON_CATALOGUE: AddOn[] // 20

export function mealsForTrack(track: DietaryTrack): Meal[];
export function addOnsForTrack(track: DietaryTrack): AddOn[];
```

`priceCents` is derived from `type` at module level, so the price table has exactly one home.

### 4.1 The tagging rule

A meal always carries its home track. It additionally carries a specialist tag only when its description contains nothing that track excludes.

**A Standard-track meal is never promoted into a specialist track**, even when it would technically qualify. Standard meals are not prepared under gluten-free or dairy-free controls, and an agent telling a coeliac customer that their Standard box is "gluten-free" is a claim this project should not be able to make. The knowledge-base article states this limit explicitly.

This follows the catalogue's own instruction to store flags as an array rather than assigning each item to one track, and reproduces both overlaps it names (G2 is also dairy-free, V5 is also gluten-free).

### 4.2 Meals

Exclusions applied: gluten = wheat, barley, rye, malt (pasta, bread, buns, rolls, couscous, farro, freekeh, soba, flatbread, bulgur, soy sauce). Dairy = milk, butter, cream, cheese, yoghurt, ghee. Vegetarian = no meat, poultry, fish or seafood.

**Standard** - all tagged `[standard]`:

| Code | Meal | Cal/P/C/F |
|---|---|---|
| S1 | Herb Roast Chicken & Garlic Mash | 620/48/42/28 |
| S2 | Beef Lasagne | 710/38/58/36 |
| S3 | Teriyaki Salmon Rice Bowl | 580/40/55/20 |
| S4 | Chicken Tikka Masala & Basmati | 660/42/62/26 |
| S5 | Beef Smash Burger & Fries | 890/44/68/48 |
| S6 | Creamy Mushroom Chicken Pasta | 750/45/70/30 |
| S7 | Lamb Kofta & Couscous | 690/40/52/34 |
| S8 | Turkey Meatball Marinara Sub | 640/38/60/26 |

**Gluten-Free**:

| Code | Meal | Tags | Cal/P/C/F |
|---|---|---|---|
| G1 | Lemon Herb Grilled Chicken & Quinoa | gluten-free, dairy-free | 540/46/40/20 |
| G2 | Thai Green Curry with Jasmine Rice | gluten-free, dairy-free | 610/34/58/27 |
| G3 | Grilled Salmon & Sweet Potato Mash | gluten-free | 590/38/44/26 |
| G4 | Beef Chilli & Rice Bowl | gluten-free, dairy-free | 640/42/56/24 |
| G5 | Chicken Shawarma Rice Plate | gluten-free, dairy-free | 680/44/54/30 |
| G6 | Prawn & Chorizo-Free Paella | gluten-free, dairy-free | 570/36/62/16 |
| G7 | Turkey & Vegetable Frittata | gluten-free | 460/40/14/27 |
| G8 | Corn Tortilla Beef Tacos (3) | gluten-free, dairy-free | 620/36/50/30 |

G3 and G7 stay dairy-ambiguous on purpose: a "mash" and a "frittata" both commonly carry butter or milk, and the catalogue does not say otherwise.

Note: the catalogue names G4 "Beef Chilli & Cornbread-Free Rice Bowl" and G6 "Prawn & Chorizo-Free Paella". "Cornbread-Free" reads as a production note rather than a customer-facing dish name, so G4 ships as "Beef Chilli & Rice Bowl". G6 keeps its name, since chorizo-free is the pork-free point the halal section makes.

**Vegetarian**:

| Code | Meal | Tags | Cal/P/C/F |
|---|---|---|---|
| V1 | Paneer Butter Masala & Basmati | vegetarian, gluten-free | 680/26/66/34 |
| V2 | Wild Mushroom Risotto | vegetarian, gluten-free | 610/18/74/25 |
| V3 | Halloumi & Roast Vegetable Grain Bowl | vegetarian | 640/27/58/33 |
| V4 | Spinach & Ricotta Cannelloni | vegetarian | 660/28/62/32 |
| V5 | Chickpea & Spinach Curry | vegetarian, gluten-free, dairy-free | 560/20/78/18 |
| V6 | Falafel Mezze Plate | vegetarian, dairy-free | 620/22/70/27 |
| V7 | Margherita Flatbread & Rocket | vegetarian | 590/24/66/24 |
| V8 | Black Bean & Sweet Corn Burrito Bowl | vegetarian, gluten-free | 630/23/80/22 |

**Dairy-Free**:

| Code | Meal | Tags | Cal/P/C/F |
|---|---|---|---|
| D1 | Moroccan Chicken Tagine & Couscous | dairy-free | 620/44/58/22 |
| D2 | Coconut Chicken Curry & Rice | dairy-free, gluten-free | 650/40/60/27 |
| D3 | Grilled Sea Bass & Herb Potatoes | dairy-free, gluten-free | 520/40/38/22 |
| D4 | Beef Stir-Fry with Rice Noodles | dairy-free | 590/38/62/20 |
| D5 | Lentil & Vegetable Shepherd's Pie | dairy-free, vegetarian, gluten-free | 480/19/68/14 |
| D6 | Harissa Roast Chicken & Freekeh | dairy-free | 580/46/52/19 |
| D7 | Teriyaki Tofu & Soba Noodles | dairy-free, vegetarian | 540/26/70/17 |
| D8 | Cajun Prawn & Dirty Rice | dairy-free, gluten-free | 560/38/64/15 |

### 4.3 Add-ons

| Code | Add-on | Type | Price | Tags |
|---|---|---|---|---|
| SA1 | Garlic Parmesan Bread | side | $4.99 | standard |
| SA2 | Caesar Side Salad | side | $4.99 | standard |
| SA3 | Chocolate Fudge Brownie | dessert | $5.99 | standard |
| SA4 | Sparkling Lemonade (330 ml) | drink | $3.49 | standard |
| SA5 | Mango Cheesecake Slice | dessert | $5.99 | standard |
| GA1 | Rosemary Sweet Potato Fries | side | $4.99 | gluten-free, dairy-free, vegetarian |
| GA2 | Greek Salad with Feta | side | $4.99 | gluten-free, vegetarian |
| GA3 | Flourless Chocolate Torte | dessert | $5.99 | gluten-free, vegetarian |
| GA4 | Cold-Pressed Green Juice (330 ml) | drink | $3.49 | gluten-free, dairy-free, vegetarian |
| GA5 | Coconut Rice Pudding | dessert | $5.99 | gluten-free, dairy-free, vegetarian |
| VA1 | Truffle Mac & Cheese Cup | side | $4.99 | vegetarian |
| VA2 | Roasted Beet & Goat Cheese Salad | side | $4.99 | vegetarian, gluten-free |
| VA3 | Tiramisu-Style Coffee Cream Pot | dessert | $5.99 | vegetarian |
| VA4 | Mango Lassi (300 ml) | drink | $3.49 | vegetarian, gluten-free |
| VA5 | Warm Apple Crumble & Custard | dessert | $5.99 | vegetarian |
| DA1 | Rosemary Sea Salt Potato Wedges | side | $4.99 | dairy-free, vegetarian, gluten-free |
| DA2 | Miso Glazed Aubergine | side | $4.99 | dairy-free, vegetarian |
| DA3 | Dark Chocolate & Almond Bark | dessert | $5.99 | dairy-free, vegetarian, gluten-free |
| DA4 | Iced Oat Matcha Latte (350 ml) | drink | $3.49 | dairy-free, vegetarian |
| DA5 | Coconut Sorbet with Passionfruit | dessert | $5.99 | dairy-free, vegetarian, gluten-free |

VA3 drops the catalogue's "(alcohol-free)" suffix from its customer-facing name. Nothing on the menu contains alcohol, so singling out one dessert implies the others might; the halal section carries that guarantee for the whole menu instead.

## 5. Schema

Two columns, matching the existing `jsonb`-for-arrays convention already used by `items` and `add_ons`.

```ts
// customers
dietaryTrack: text("dietary_track").notNull().default("standard"),

// orders
dietaryTags: jsonb("dietary_tags").$type<string[]>(),
```

`orders.dietary_tags` is a snapshot of the meal's tags at the time the box was packed, not a live lookup. A customer who switches track must still be able to ask what was in a box they already received.

Requires `npm run db:reset`.

## 6. Seed

### 6.1 Track per demo customer

| Track | Customers |
|---|---|
| standard | Ava, Marcus, Lena, Noah |
| vegetarian | Priya, Sara |
| gluten-free | Diego, Mia |
| dairy-free | Tom, Jamal |

Each customer's meals and add-ons are drawn from their own track, cycling `mealsForTrack(track)` by that customer's order ordinal. A vegetarian never gets a beef box, which is what the new seed-coherence test asserts.

### 6.2 Prices, and the demos that depend on them

`orderPricing(i)` keeps its shape; only the add-on values change, and they now come from `ADDON_CATALOGUE` rather than being written inline.

| Demo | Order | Before | After | Requirement |
|---|---|---|---|---|
| Priya, confirmable refund | FC1008 | $17.50 | **$17.50** | exactly $17.50, no add-ons |
| Noah, over-ceiling escalation | FC1020 | $26.00 | **$28.48** | above the $20 ceiling |
| Tom, 14-day cooldown | FC1015 | $17.50 | **$17.50** | any refundable amount |
| Marcus, extra meal | FC1005 | $22.49 | **$22.49** | none |
| Priya, extra meal | FC1010 | $22.49 | **$22.49** | none |

Noah is on the standard track, so FC1020 carries SA3 Chocolate Fudge Brownie ($5.99) plus SA1 Garlic Parmesan Bread ($4.99): $17.50 + $10.98 = **$28.48**. No test asserts the old $26.00 figure; `cypress/e2e/agent.cy.ts` only asserts that the reply contains "escalated" and that no refund card renders.

Marcus takes SA1 ($4.99); Priya, on the vegetarian track, takes VA1 Truffle Mac & Cheese Cup ($4.99). Both extras stay at $22.49.

### 6.3 Dead values to remove

The literal `totalCents` in `orderRows` (`3800`, `6400`, `850`, ...) are dead. `orderPricing(i)` spreads after them in `db/seed.ts:234` and overwrites every one. They are wrong about what a seeded order costs, which is the subject of this change, so they go. `totalCents` will be supplied only by `orderPricing`.

## 7. Surfacing the new data

- `lib/tools/order-view.ts` - `OrderView` gains `dietary_tags: string[]`, defaulting to `[]` like `add_ons` and `items`. Answers "was my last box dairy-free?" through the existing `lookup_order` and `list_orders`.
- `lib/tools/subscription.ts` - `get_subscription` returns `dietary_track`. Answers "what diet am I on?" through the tool the prompt already forces for account questions.
- `lib/domain/terms.ts` - a new `RULES.dietary` entry stating the four tracks, that plan meals are free on every track, that Standard meals carry no specialist guarantee, and the halal position. `buildSystemPrompt()` picks it up automatically.
- `app/api/account/route.ts` - the `customer` payload gains `dietaryTrack`, so the account panel does not keep showing the old track after a switch. Its `orders` already map through `orderView`, so `dietary_tags` flows there for free.

## 8. Changing dietary track in chat

Follows `change_plan` exactly. The model proposes; only the confirm button writes.

**`lib/tools/dietary.ts`** - `change_dietary_track`

- Argument: `track`, one of the four. Unknown value returns `ok: false` with a message naming the valid tracks.
- Reads the customer, returns `status: "needs_confirmation"` with `proposal: { current_track, new_track, effective_from, meals_preview }`, where `meals_preview` is three meal names from the new track so the card can show what changes.
- Same track requested: returns `ok: true` with a plain "already on that track" message and **no** proposal, so no card renders.
- Never writes.

**`lib/agent/dispatch.ts`** - `PROPOSAL_EVENTS["change_dietary_track"] = "diet_change_proposal"`. Dedupe is inherited for free.

**`app/chat.tsx`** - `DietCard`, `data-testid="diet-card"`, buttons "Yes, switch my meals" and "Not now", matching the existing card pattern.

**`app/api/actions/dietary-track/route.ts`**

- 400 on missing `customerId` or `track`, or a `track` outside the four (`unknown_track`).
- `reconcile(customerId, now())` first, like every other action route.
- 404 unknown customer. 409 `same_track` - and no event row, mirroring the `same_plan` guard that stops a replayed confirmation writing a phantom change.
- Writes `customers.dietary_track` and one `subscription_events` row, `event_type: "diet_changed"`, `metadata: { from, to }`.
- No `transactions` row. Switching track is free.

**Effective date.** The change applies from next week's menu. Orders already `processing` or `shipped` keep their meals and their `dietary_tags`; they are packed. The card and the tool message both say this, so nobody expects the box already on a van to change.

**Status.** Allowed while active, paused or cancelled. It costs nothing and moves no money. For a cancelled customer it simply takes effect on reactivation, and the tool message says so.

## 9. Knowledge base

**New: `kb/articles/menu-and-dietary-tracks.md`**

- The four tracks and what each excludes.
- All 32 meals, grouped by track.
- The add-on price table, by type.
- "Every meal is $17.50, and the meals in your plan are included at no extra cost. Add-ons are charged on top."
- How to switch track, and that it takes effect from next week's menu.
- Halal: *all meals are halal-certified; no pork, pork derivatives or alcohol is used anywhere in our kitchens, so our meals suit many kosher-observant customers, though we are not kosher-certified.*
- That a Standard-track meal containing no gluten is not the same as a Gluten-Free-track meal, which is the only one prepared under those controls.

**Rewrite: `kb/articles/dietary-options.md`** - replaces "vegetarian, pescatarian, low-carb, calorie-smart, family-friendly" with the four real tracks. Keeps its allergen and weekly-recipe-choice sections. Without this, two KB articles disagree about which diets exist and the agent can cite either.

**Knock-on edits** caused by that rewrite:

- `kb/articles/plan-changes.md:13` - "such as vegetarian or low-carb".
- `kb/articles/getting-started.md:7` - "set any dietary preferences".
- `scripts/test-retrieval.ts:24` - the case `"Do you have vegetarian or low-carb options?"` expecting `dietary-options`.
- `kb/articles/pricing-and-plans.md` - add one line pointing at the add-on price table, so the pricing article is not silently incomplete.

Requires `npm run kb:ingest`, which spends OpenAI credit.

## 10. Verification

**New `lib/domain/menu.test.ts`** (pure, no DB):
- every add-on's `priceCents` equals `ADDON_PRICE_CENTS[type]`;
- every meal and add-on carries its home track in `tags`;
- no `standard`-track item carries a specialist tag;
- 32 meals, 20 add-ons, codes unique;
- `mealsForTrack` / `addOnsForTrack` return only matching items.

**Extend `tests/integration/seed-coherence.test.ts`**:
- every order's meal belongs to its customer's track;
- every order's add-ons belong to its customer's track;
- every order's `dietary_tags` equal the catalogue tags for its meal;
- every customer's `dietary_track` is one of the four.

**Extend `lib/tools/order-view.test.ts`** - `dietary_tags` surfaced, absent tags default to `[]`.

**New `tests/api/dietary-track.test.ts`** - happy path writes the column and one `diet_changed` event and no ledger row; `same_track` 409 with no event written; `unknown_track` 400; unknown customer 404; another customer's id cannot be targeted.

**E2E** - one new spec plus one mock script. `lib/llm/mock-scripts.test.ts` enforces the binding in both directions, so a script without a spec fails the build:
- `agent.cy.ts`: asking to switch track renders exactly one `diet-card` and writes nothing;
- `confirm.cy.ts`: confirming reports the new track on the card and hides the buttons.

**Gate**, in order:

```
npm run db:reset
npm run kb:ingest
npm run test:all
npm run kb:test
npm run test:e2e
```

`kb:test` is a 12-case retrieval gate and a new article can shift it. Any case that moves gets fixed rather than loosened.

## 11. Source document

`meal-catalogue.md` in the Obsidian vault gets a Price column added to all eight tables: $17.50 on every meal row, and the type price on every add-on row. Edited in place.

## 12. Docs to update

- `docs/DOMAIN.md` - a Menu & dietary tracks section, and `diet_changed` added to the subscription-events list.
- `docs/PROJECT_STATE.md` - the new tool (12 total), the two columns, the new article, the new SSE event, the new action route.
- `kb/README.md` - the article count moves to 15. It currently claims 12 and there are already 14, so this corrects a stale number as well as adding the new article.

## 13. Risks

| Risk | Handling |
|---|---|
| A dietary claim is a safety claim | Standard meals are never tagged into a specialist track; the KB states the difference between "contains no gluten" and "prepared gluten-free" |
| New article shifts the retrieval gate | Run `kb:test` and fix any case that moves |
| Two KB articles disagree on diets | `dietary-options.md` is rewritten in the same change, not left behind |
| Reseed changes refund amounts | The three refund demos are pinned in section 6.2 and asserted by tests |
| A replayed diet confirmation | `same_track` 409 with no event written, mirroring `same_plan` |
