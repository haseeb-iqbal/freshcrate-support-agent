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
}

const CASES: Case[] = [
  { q: "How do I change my delivery day?", expect: "delivery-schedule" },
  { q: "Can I pause my subscription while I'm on vacation?", expect: "pause-resume" },
  { q: "What is your cancellation policy and are there any fees?", expect: "cancellation-policy" },
  { q: "My box arrived damaged — can I get a refund?", expect: "refunds-and-damaged-boxes" },
  { q: "How do I switch from 2 meals to 4 meals a week?", expect: "plan-changes" },
  { q: "Do you have vegetarian or low-carb options?", expect: "dietary-options" },
  { q: "How do I update the credit card on my account?", expect: "account-and-billing" },
  { q: "How does the referral program work and what do I earn?", expect: "referral-program" },
  { q: "When will my box be delivered and what's the time window?", expect: "delivery-schedule" },
  { q: "How long do ingredients stay fresh in the fridge?", expect: "food-safety-and-freshness" },
  { q: "Do you deliver to my area and what does shipping cost?", expect: "delivery-areas-and-fees" },
  { q: "How do I apply a promo code?", expect: "promotions-and-discounts" },
];

const ARTICLES_DIR = path.join(process.cwd(), "kb", "articles");

async function main() {
  let passTop1 = 0;
  let passTop3 = 0;
  let citationsOk = 0;

  for (const c of CASES) {
    const hits = await retrieve(c.q, { topK: 3, fetchK: 12 });
    const slugs = hits.map((h) => h.articleSlug);
    const inTop3 = slugs.includes(c.expect);
    const top1 = slugs[0] === c.expect;
    if (inTop3) passTop3++;
    if (top1) passTop1++;

    // Citation resolves: the cited article file exists on disk.
    const top = hits[0];
    const citeResolves = top ? existsSync(path.join(ARTICLES_DIR, `${top.articleSlug}.md`)) : false;
    if (citeResolves) citationsOk++;

    const mark = top1 ? "✓" : inTop3 ? "≈" : "✗";
    console.log(`${mark} "${c.q}"`);
    console.log(`    expected ${c.expect} | top3: ${slugs.join(", ")}`);
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

  // Gate: every sample question must surface its article in the top 3, and every
  // top citation must resolve to a real article file.
  const ok = passTop3 === n && citationsOk === n;
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
