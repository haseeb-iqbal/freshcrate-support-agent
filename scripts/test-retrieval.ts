import "dotenv/config";
import { existsSync } from "node:fs";
import path from "node:path";
import { client } from "../db";
import { retrieve } from "../lib/rag/retrieve";

/**
 * Phase 1 acceptance check: for a set of sample questions, does retrieval return
 * the expected source article, and do the citations (slug + heading) resolve to
 * real KB content? Run with `npm run kb:test` (requires an ingested DB).
 */

interface Case {
  q: string;
  expect: string; // expected article_slug
  /** Expected `## heading`. Set on the dietary cases: since the menu article
   *  answers nearly all of them, asserting only the slug would prove almost
   *  nothing - the section is what decides whether the answer is right. */
  heading?: string;
}

const CASES: Case[] = [
  { q: "How do I change my delivery day?", expect: "delivery-schedule" },
  { q: "Can I pause my subscription while I'm on vacation?", expect: "pause-resume" },
  { q: "What is your cancellation policy and are there any fees?", expect: "cancellation-policy" },
  { q: "My box arrived damaged — can I get a refund?", expect: "refunds-and-damaged-boxes" },
  { q: "How do I switch from 2 meals to 4 meals a week?", expect: "plan-changes" },
  { q: "How do I update the credit card on my account?", expect: "account-and-billing" },
  { q: "How does the referral program work and what do I earn?", expect: "referral-program" },
  { q: "When will my box be delivered and what's the time window?", expect: "delivery-schedule" },
  { q: "How long do ingredients stay fresh in the fridge?", expect: "food-safety-and-freshness" },
  { q: "Do you deliver to my area and what does shipping cost?", expect: "delivery-areas-and-fees" },
  { q: "How do I apply a promo code?", expect: "promotions-and-discounts" },

  // The 15 dietary-track questions a subscription meal service actually gets.
  { q: "What dietary options do you have?", expect: "menu-and-dietary-tracks", heading: "Our four dietary tracks" },
  { q: "Does the gluten-free track cost more?", expect: "menu-and-dietary-tracks", heading: "Our four dietary tracks" },
  { q: "What meals are on the vegetarian menu?", expect: "menu-and-dietary-tracks", heading: "Vegetarian menu" },
  { q: "Show me the gluten-free meals", expect: "menu-and-dietary-tracks", heading: "Gluten-Free menu" },
  { q: "What dairy-free meals can I get?", expect: "menu-and-dietary-tracks", heading: "Dairy-Free menu" },
  { q: "What is on the standard menu?", expect: "menu-and-dietary-tracks", heading: "Standard menu" },
  { q: "What add-ons can I get on the dairy-free menu?", expect: "menu-and-dietary-tracks", heading: "Dairy-Free menu" },
  { q: "How much do add-ons cost?", expect: "menu-and-dietary-tracks", heading: "Add-on prices" },
  // Per-meal diet lookups are the weak spot: the question's salient word is the
  // diet, but the meal's row lives in its OWN track's table. Both of these
  // retrieved the wrong section until the per-diet sections were added.
  { q: "Is the Wild Mushroom Risotto gluten-free?", expect: "menu-and-dietary-tracks", heading: "Every gluten-free meal" },
  { q: "Is Paneer Butter Masala gluten-free?", expect: "menu-and-dietary-tracks", heading: "Every gluten-free meal" },
  { q: "Do you have vegan options?", expect: "menu-and-dietary-tracks", heading: "Vegan and other diets" },
  { q: "Are your meals halal?", expect: "menu-and-dietary-tracks", heading: "Halal and kosher" },
  { q: "Do you cater for nut allergies?", expect: "menu-and-dietary-tracks", heading: "Allergens and ingredient information" },
  { q: "Can I choose my own meals each week?", expect: "menu-and-dietary-tracks", heading: "Choosing your weekly recipes" },
  { q: "How do I switch to the gluten-free menu?", expect: "menu-and-dietary-tracks", heading: "Changing your dietary track" },
];

const ARTICLES_DIR = path.join(process.cwd(), "kb", "articles");

async function main() {
  let passTop1 = 0;
  let passTop3 = 0;
  let citationsOk = 0;
  let headingsChecked = 0;
  let headingsOk = 0;

  for (const c of CASES) {
    const hits = await retrieve(c.q, { topK: 3, fetchK: 12 });
    const slugs = hits.map((h) => h.articleSlug);
    const inTop3 = slugs.includes(c.expect);
    const top1 = slugs[0] === c.expect;
    if (inTop3) passTop3++;
    if (top1) passTop1++;

    // Section check: the expected `## heading` must be among the top 3 hits for
    // the expected article. Only the dietary cases set one.
    let headingOk = true;
    if (c.heading) {
      headingsChecked++;
      headingOk = hits.some((h) => h.articleSlug === c.expect && h.heading === c.heading);
      if (headingOk) headingsOk++;
    }

    // Citation resolves: the cited article file exists on disk.
    const top = hits[0];
    const citeResolves = top ? existsSync(path.join(ARTICLES_DIR, `${top.articleSlug}.md`)) : false;
    if (citeResolves) citationsOk++;

    const mark = !headingOk ? "✗" : top1 ? "✓" : inTop3 ? "≈" : "✗";
    console.log(`${mark} "${c.q}"`);
    console.log(`    expected ${c.expect}${c.heading ? ` › ${c.heading}` : ""} | top3: ${slugs.join(", ")}`);
    if (c.heading && !headingOk) {
      console.log(`    [WRONG SECTION] got: ${hits.map((h) => h.heading).join(" | ")}`);
    }
    if (top) {
      console.log(
        `    cite: ${top.articleSlug} › ${top.heading} (sim ${top.score.toFixed(3)})` +
          `${citeResolves ? "" : "  [UNRESOLVED CITATION]"}`,
      );
    }
  }

  const n = CASES.length;
  console.log("\n──────── summary ────────");
  console.log(`top-1 correct:        ${passTop1}/${n}`);
  console.log(`expected in top-3:    ${passTop3}/${n}`);
  console.log(`citations resolve:    ${citationsOk}/${n}`);
  console.log(`correct section:      ${headingsOk}/${headingsChecked}`);

  // Gate: every sample question must surface its article in the top 3, every top
  // citation must resolve to a real article file, and every question that names a
  // section must retrieve that section.
  const ok = passTop3 === n && citationsOk === n && headingsOk === headingsChecked;
  console.log(ok ? "\nPASS — retrieval gate met." : "\nFAIL — retrieval gate not met.");
  if (!ok) process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error("Retrieval test failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
