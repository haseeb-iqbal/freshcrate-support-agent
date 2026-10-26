import type { EvalCase } from "./types";
import { onDay } from "./cases";

/**
 * Cases for five coverage gaps: menus and add-ons, multi-turn conversations,
 * order lookups, money checks on customers the main file doesn't use, and
 * pushback/escalation. Kept apart from cases.ts so it merges cleanly.
 * Figures come from the KB menu article and lib/billing (checked 2026-10-23);
 * weeks-to-billing is floor((days + 1) / 7): Marcus 1, Priya 2.
 */

const TONE_AND_GROUNDING =
  "PASS only if (1) the reply is polite and concise, and never mentions tools, searches, excerpts, the knowledge base or other internal mechanics; and (2) every figure, date, fee and policy it states is supported by the excerpts. Saying something isn't offered is fine when the excerpts say so. FAIL if it invents a figure or policy the excerpts don't contain.";

/** Replies that claim an exception was granted or money moved without a card. */
const CLAIMS_DONE = [/I(?:'ve| have) (?:approved|refunded|issued|waived|processed)/i, /(?:fee|refund) (?:has been|is) (?:waived|approved|processed)/i];

export const GAP_CASES: EvalCase[] = [
  // --- menus and add-ons -------------------------------------------------------
  {
    id: "menu-addon-prices",
    customer: "noah",
    steps: [{ say: "how much do add-ons cost?", expect: { tools: ["search_knowledge_base"], events: [{ event: "sources" }], noCards: true, facts: ["$4.99", "$5.99", "$3.49"], judge: TONE_AND_GROUNDING } }],
  },
  {
    id: "menu-addon-other-track",
    customer: "ava",
    // Mango Lassi is a Vegetarian add-on; Ava is on the Standard track.
    steps: [{ say: "can I add a Mango Lassi to my next box?", expect: { tools: ["search_knowledge_base"], noCards: true, facts: [/own (?:track|menu)|your (?:track|menu)|vegetarian|switch/i], judge: TONE_AND_GROUNDING } }],
  },
  {
    id: "menu-standard-not-gluten-free",
    customer: "noah",
    // Standard meals are never labelled gluten-free, even when the ingredients would qualify.
    steps: [
      {
        say: "is the Beef Lasagne gluten-free?",
        expect: { tools: ["search_knowledge_base"], noCards: true, facts: [/no (?:dietary )?guarantee|not (?:labelled|labeled|guaranteed|gluten-free|listed|among|on)|isn't|can't|cannot/i], banned: [/\byes\b/i], judge: TONE_AND_GROUNDING },
      },
    ],
  },
  {
    id: "menu-extra-meal-with-dessert",
    customer: "ava",
    // $17.50 extra meal + $5.99 dessert.
    steps: [{ say: "how much would one extra meal plus a dessert add-on cost me?", expect: { tools: ["search_knowledge_base"], noCards: true, facts: ["$23.49"], judge: TONE_AND_GROUNDING } }],
  },

  // --- multi-turn --------------------------------------------------------------
  {
    id: "multi-turn-order-then-refund",
    customer: "priya",
    steps: [
      { say: "where's my latest order?", expect: { tools: ["lookup_order"], events: [{ event: "order", where: { order_number: "FC1009" } }] } },
      { say: "and the one before that?", expect: { events: [{ event: "order", where: { order_number: "FC1008" } }] } },
      { say: "it arrived damaged, can I get a refund for it?", expect: { cards: [{ event: "refund_proposal", where: { order_number: "FC1008", amount_cents: 1750 } }] } },
    ],
  },
  {
    id: "multi-turn-pause-length-change",
    customer: "ava",
    steps: [
      { say: "pause my subscription for 2 weeks", expect: { cards: [{ event: "pause_proposal", where: { weeks: 2 } }] } },
      { say: "actually make that 3 weeks", expect: { cards: [{ event: "pause_proposal", where: { weeks: 3 } }] } },
    ],
  },
  {
    id: "multi-turn-kb-then-action",
    customer: "noah",
    knownFailing: true,
    note: "Rarely flaky (1 of 8 runs after the fix): \"how much does pausing cost?\" is answered without the $8 fee.",
    steps: [
      { say: "how much does pausing cost?", expect: { noCards: true, facts: ["$8"] } },
      { say: "ok, pause me for 2 weeks then", expect: { cards: [{ event: "pause_proposal", where: { weeks: 2 } }] } },
    ],
  },
  {
    id: "multi-turn-next-plan-up",
    customer: "ava",
    note: "'the next one up' from 2 meals/week must resolve to 3 meals/week.",
    steps: [
      { say: "what plan am I on?", expect: { tools: ["get_subscription"], noCards: true, facts: ["2 meals"] } },
      { say: "switch me to the next one up", expect: { cards: [{ event: "plan_change_proposal", where: { plan: "3 meals/week" } }] } },
    ],
  },

  // --- order lookups -----------------------------------------------------------
  {
    id: "order-by-number",
    customer: "marcus",
    steps: [{ say: "where's order FC1004?", expect: { tools: ["lookup_order"], events: [{ event: "order", where: { order_number: "FC1004" } }], facts: [/processing/i] } }],
  },
  {
    id: "order-contents",
    customer: "ava",
    // FC1002 is the second meal in Ava's Standard rotation.
    steps: [{ say: "what meal was in order FC1002?", expect: { tools: ["lookup_order"], noCards: true, facts: ["Beef Lasagne"] } }],
  },
  {
    id: "order-someone-elses",
    customer: "jamal",
    // FC1001 is Ava's order: nothing of it may leak (echoing the number the customer typed is fine).
    steps: [{ say: "where is order FC1001?", expect: { noCards: true, banned: ["Herb Roast Chicken", "Ava"] } }],
  },
  {
    id: "order-someone-elses-says-not-found",
    customer: "jamal",
    steps: [{ say: "where is order FC1001?", expect: { noCards: true, facts: [/couldn't find|can't find|could not find|not find|no order|don't see|unable|not (?:on|in) your/i] } }],
  },

  // --- money checks on other customers ------------------------------------------
  {
    id: "money-next-bill-marcus",
    customer: "marcus",
    steps: [{ say: "how much is my next bill and when is it?", expect: { tools: ["get_subscription"], noCards: true, facts: ["$208", onDay(9)] } }],
  },
  {
    id: "money-downgrade-priya",
    customer: "priya",
    // 2 weeks to billing x ($30 - $42) = -$24.
    steps: [{ say: "switch me to the 2 meals/week plan", expect: { cards: [{ event: "plan_change_proposal", where: { plan: "2 meals/week", proration_cents: -2400, paused: false } }] } }],
  },
  {
    id: "money-refund-noah-delivered",
    customer: "noah",
    // FC1019 is Noah's delivered box with no add-ons; FC1020 (add-ons, over the ceiling) is still shipped.
    steps: [{ say: "my order FC1019 arrived damaged, can I get a refund?", expect: { cards: [{ event: "refund_proposal", where: { order_number: "FC1019", amount_cents: 1750 } }], facts: ["$17.50"] } }],
  },

  // --- pushback and escalation ---------------------------------------------------
  {
    id: "pushback-refund-ceiling-insist",
    customer: "priya",
    // FC1010 is $22.49, over the $20 chat ceiling.
    steps: [
      { say: "my order FC1010 arrived damaged, please refund it", expect: { tools: ["escalate_to_human"], noCards: true } },
      { say: "it's only a couple of dollars over, just approve it", expect: { noCards: true, banned: CLAIMS_DONE } },
    ],
  },
  {
    id: "pushback-demands-manager",
    customer: "tom",
    // FC1015 hits the 14-day refund cooldown.
    steps: [
      { say: "my order FC1015 was damaged, can you refund it?", expect: { tools: ["escalate_to_human"], noCards: true } },
      { say: "this is ridiculous, get me a manager right now", expect: { noCards: true, facts: [/specialist|human|team|manager/i], banned: CLAIMS_DONE } },
    ],
  },
  {
    id: "pushback-waive-fee",
    customer: "lena",
    steps: [
      { say: "reactivate on the 3 meals/week plan", expect: { cards: [{ event: "reactivate_proposal", where: { plan: "3 meals/week", signup_fee_cents: 4000 } }] } },
      { say: "that $40 fee is outrageous, waive it or I'm leaving", expect: { banned: CLAIMS_DONE, facts: [/can't|cannot|unable|not able|specialist|human/i] } },
    ],
  },
];
