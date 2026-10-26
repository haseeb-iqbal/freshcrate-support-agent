import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ADDON_PRICE_CENTS } from "../domain/menu";
import { REFUND_COOLDOWN_DAYS, refundCeilingCents } from "../guardrails/refund-policy";
import { MEAL_LIST_PRICE_CENTS, PAUSE_FEE_CENTS, PLAN_RATES, SIGNUP_FEE_CENTS, pausedWeekReductionCents, weeklySavingsCents } from "./pricing";

/**
 * The agent quotes prices from the KB articles, while billing charges from these
 * constants. When the two drift, the bot states one price and the card charges
 * another. This test pulls every figure from the code and checks the articles
 * agree: each must state the current figures where they belong, and no article
 * may quote a dollar amount the code doesn't produce.
 */

const DIR = path.join(process.cwd(), "kb", "articles");
const ARTICLES = new Map(readdirSync(DIR).filter((f) => f.endsWith(".md")).map((f) => [f, readFileSync(path.join(DIR, f), "utf8")]));

/** $30, $17.50 - how the articles write money. */
const usd = (cents: number) => `$${cents % 100 === 0 ? cents / 100 : (cents / 100).toFixed(2)}`;
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

const [p2] = PLAN_RATES;

/** Every amount an article may quote, each traced to the code it comes from. */
const KNOWN: Map<string, string> = new Map<string, string>([
  ...PLAN_RATES.flatMap((p): [string, string][] => [
    [usd(p.weeklyCents), `${p.plan} weekly price`],
    [usd(p.monthlyCents), `${p.plan} monthly price`],
    [usd(MEAL_LIST_PRICE_CENTS * p.mealsPerWeek), `${p.plan} a-la-carte equivalent`],
    [usd(weeklySavingsCents(p.mealsPerWeek, p.weeklyCents)), `${p.plan} weekly saving`],
  ]),
  [usd(MEAL_LIST_PRICE_CENTS), "meal list price"],
  [usd(PAUSE_FEE_CENTS), "weekly pause fee"],
  [usd(PAUSE_FEE_CENTS * 4), "a fully paused month (4 x pause fee)"],
  [usd(pausedWeekReductionCents(p2.weeklyCents) * 2), "pause credit example: 2 weeks on the 2-meal plan"],
  [usd(SIGNUP_FEE_CENTS), "sign-up fee"],
  [usd(refundCeilingCents()), "chat refund ceiling"],
  ...Object.entries(ADDON_PRICE_CENTS).map(([type, cents]): [string, string] => [usd(cents), `${type} add-on price`]),
]);

/** Statements that must be in a given article, built from the constants. */
const REQUIRED: { article: string; what: string; pattern: RegExp }[] = [
  ...PLAN_RATES.map((p) => ({
    article: "pricing-and-plans.md",
    what: `${p.plan} at ${usd(p.weeklyCents)}/week (${usd(p.monthlyCents)}/month)`,
    pattern: new RegExp(`${escape(p.plan)}[^\\n]*${escape(usd(p.weeklyCents))}/week \\(${escape(usd(p.monthlyCents))}/month\\)`),
  })),
  ...["pricing-and-plans.md", "refunds-and-damaged-boxes.md", "menu-and-dietary-tracks.md"].map((article) => ({
    article,
    what: `the ${usd(MEAL_LIST_PRICE_CENTS)} meal list price`,
    pattern: new RegExp(escape(usd(MEAL_LIST_PRICE_CENTS))),
  })),
  ...["pricing-and-plans.md", "pause-resume.md", "account-and-billing.md", "delivery-areas-and-fees.md"].map((article) => ({
    article,
    what: `the ${usd(PAUSE_FEE_CENTS)}/week pause fee`,
    pattern: new RegExp(`${escape(usd(PAUSE_FEE_CENTS))}/week`),
  })),
  ...["pricing-and-plans.md", "cancellation-policy.md", "getting-started.md"].map((article) => ({
    article,
    what: `the ${usd(SIGNUP_FEE_CENTS)} sign-up fee`,
    pattern: new RegExp(`${escape(usd(SIGNUP_FEE_CENTS))} sign-up fee`),
  })),
  ...["pricing-and-plans.md", "refunds-and-damaged-boxes.md"].flatMap((article) => [
    { article, what: `the ${usd(refundCeilingCents())} chat refund ceiling`, pattern: new RegExp(`${escape(usd(refundCeilingCents()))} or less`) },
    { article, what: `the ${REFUND_COOLDOWN_DAYS}-day refund window`, pattern: new RegExp(`${REFUND_COOLDOWN_DAYS} days`) },
  ]),
  {
    article: "pricing-and-plans.md",
    what: "add-on prices by type",
    pattern: new RegExp(
      `sides ${escape(usd(ADDON_PRICE_CENTS.side))}, desserts ${escape(usd(ADDON_PRICE_CENTS.dessert))}, drinks ${escape(usd(ADDON_PRICE_CENTS.drink))}`,
    ),
  },
  ...Object.entries(ADDON_PRICE_CENTS).map(([type, cents]) => ({
    article: "menu-and-dietary-tracks.md",
    what: `the ${type} add-on price`,
    pattern: new RegExp(`\\| ${type[0].toUpperCase()}${type.slice(1)} \\| ${escape(usd(cents))} \\|`),
  })),
];

describe("KB figures match the billing code", () => {
  it("states each current price where readers look for it", () => {
    const missing = REQUIRED.filter((r) => !r.pattern.test(ARTICLES.get(r.article) ?? "")).map(
      (r) => `${r.article} no longer states ${r.what}`,
    );
    expect(missing).toEqual([]);
  });

  it("quotes no dollar amount the billing code doesn't produce", () => {
    const stale: string[] = [];
    for (const [article, md] of ARTICLES) {
      for (const amount of new Set(md.match(/\$\d[\d,]*(?:\.\d{2})?/g) ?? [])) {
        if (!KNOWN.has(amount)) stale.push(`${article} quotes ${amount}, which matches no current price`);
      }
    }
    expect(stale).toEqual([]);
  });
});
