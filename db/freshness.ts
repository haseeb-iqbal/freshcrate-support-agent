import { client } from "./index";

/**
 * Read-only freshness check for the demo DB — answers "is this out of date?"
 * without eyeballing rows.
 *
 * The seed stamps every customer's `last_reconciled_at` with the seed moment
 * and guarantees open orders (processing/shipped) have a delivery date still in
 * the future. Once enough time passes those dates slip into the past and the
 * agent starts misreading in-flight boxes as delivered — that's the signal to
 * reseed. This never writes; point DATABASE_URL at any DB and run.
 */
async function main() {
  const [{ last_seeded }] = await client<{ last_seeded: Date | string | null }[]>`
    select max(last_reconciled_at) as last_seeded from customers
  `;
  const [{ stale_open }] = await client<{ stale_open: number }[]>`
    select count(*)::int as stale_open
    from orders
    where status in ('processing', 'shipped') and delivery_date < current_date
  `;
  const [{ kb }] = await client<{ kb: number }[]>`
    select count(*)::int as kb from kb_chunks
  `;

  if (!last_seeded) {
    console.log("⚠ Never seeded — no customers found. Run: npm run db:reset:remote");
    return;
  }

  const seededAt = new Date(last_seeded);
  const ageDays = Math.floor((Date.now() - seededAt.getTime()) / 86_400_000);
  console.log(`Last seeded:       ${seededAt.toISOString()} (${ageDays} day(s) ago)`);
  console.log(`Stale open orders: ${stale_open} (in-flight boxes with a past delivery date)`);
  console.log(`KB chunks:         ${kb}${kb === 0 ? " (empty — run kb:ingest)" : ""}`);
  console.log("");

  if (stale_open > 0) {
    console.log("✗ STALE — reseed with: npm run db:seed:remote");
  } else {
    console.log("✓ Fresh — open orders still have future delivery dates.");
  }
}

main()
  .catch((err) => {
    console.error("Freshness check failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
