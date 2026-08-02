import { afterAll, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { pauseSubscription } from "@/lib/tools/subscription";
import { createTestCustomer, purgeCustomer } from "../helpers/db";

const ID = "88888888-8888-8888-8888-888888880032";

interface PauseData {
  status: string;
  proposal?: unknown;
  message?: string;
}

describe("pause_subscription tool (integration, seeded DB)", () => {
  beforeEach(() => {
    if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL required; run `npm run db:reset` first");
  });
  afterAll(() => purgeCustomer(ID));

  it("proposes a pause (confirmation card) for an ACTIVE subscription", async () => {
    await createTestCustomer({ id: ID, plan: "2 meals/week", subscriptionStatus: "active", billingDate: "2026-08-17" });
    const r = await pauseSubscription.handler({ customerId: ID, now: new Date(2026, 7, 2) }, { weeks: 2 });
    expect(r.ok).toBe(true);
    const d = r.data as PauseData;
    expect(d.status).toBe("needs_confirmation"); // a card is shown
    expect(d.proposal).toBeTruthy();
  });

  it("does NOT surface a pause card when the subscription is ALREADY paused", async () => {
    // The screenshot bug: a paused customer asked a billing question and got a
    // fresh pause prompt. A paused sub has nothing to pause — no card.
    await createTestCustomer({
      id: ID,
      plan: "2 meals/week",
      subscriptionStatus: "paused",
      pauseResumeDate: "2026-08-16",
      billingAdjustmentCents: -3000,
    });
    const r = await pauseSubscription.handler({ customerId: ID, now: new Date(2026, 7, 2) }, { weeks: 1 });
    expect(r.ok).toBe(true);
    const d = r.data as PauseData;
    expect(d.status).not.toBe("needs_confirmation"); // no confirmation card
    expect(d.proposal).toBeUndefined();
    expect(d.status).toBe("already_paused");
    expect(d.message).toMatch(/already paused/i);
  });
});
