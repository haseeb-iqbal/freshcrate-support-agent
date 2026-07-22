import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { setClock } from "@/lib/clock";
import { POST } from "@/app/api/actions/pause/route";
import { createTestCustomer, customerOf, eventsOf, purgeCustomer, txnsOf } from "../helpers/db";
import { postJson } from "../helpers/http";

const ID = "88888888-8888-8888-8888-888888880020";
const TODAY = new Date(2026, 6, 20);
// weeksUntilDate("2026-08-17", 2026-07-20) = 4.
const BILLING = "2026-08-17";

describe("POST /api/actions/pause", () => {
  beforeEach(() => setClock(() => TODAY));
  afterEach(() => setClock(null));
  afterAll(() => purgeCustomer(ID));

  it("rejects a missing customerId", async () => {
    const res = await postJson(POST, { weeks: 2 });
    expect(res.status).toBe(400);
  });

  it("rejects a week count outside 1-52", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    expect((await postJson(POST, { customerId: ID, weeks: 0 })).status).toBe(400);
    expect((await postJson(POST, { customerId: ID, weeks: 53 })).status).toBe(400);
    expect(await txnsOf(ID)).toEqual([]);
  });

  it("pauses for a finite term, credits the skipped weeks net of the fee, and sets the resume date", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    const res = await postJson(POST, { customerId: ID, weeks: 2 });

    expect(res.status).toBe(200);
    // min(2 pause weeks, 4 weeks to billing) x ($30 - $8) = $44.
    expect(await res.json()).toMatchObject({ ok: true, weeks: 2, reimbursement_cents: 4400, resume_date: "2026-08-03" });

    const c = await customerOf(ID);
    expect(c.subscriptionStatus).toBe("paused");
    expect(c.pauseResumeDate).toBe("2026-08-03");
    expect(await txnsOf(ID)).toEqual([{ type: "pause_credit", amountCents: -4400 }]);
    expect(await eventsOf(ID)).toEqual(["paused"]);
  });

  it("credits every week to billing for an indefinite pause and stores no resume date", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    const res = await postJson(POST, { customerId: ID, indefinite: true });

    // 4 weeks to billing x ($30 - $8) = $88.
    expect(await res.json()).toMatchObject({ indefinite: true, reimbursement_cents: 8800, resume_date: null });
    expect((await customerOf(ID)).pauseResumeDate).toBeNull();
    expect(await txnsOf(ID)).toEqual([{ type: "pause_credit", amountCents: -8800 }]);
  });

  it("credits at most once: a replayed confirmation does not double-credit", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    await postJson(POST, { customerId: ID, weeks: 2 });
    const second = await postJson(POST, { customerId: ID, weeks: 2 });

    expect(second.status).toBe(200);
    expect(await txnsOf(ID)).toEqual([{ type: "pause_credit", amountCents: -4400 }]);
  });

  it("lets an already-paused customer extend the pause without a second credit", async () => {
    await createTestCustomer({ id: ID, billingDate: BILLING });
    await postJson(POST, { customerId: ID, weeks: 2 });
    const extend = await postJson(POST, { customerId: ID, weeks: 4 });

    expect(extend.status).toBe(200);
    expect((await customerOf(ID)).pauseResumeDate).toBe("2026-08-17");
    expect(await txnsOf(ID)).toHaveLength(1);
    // The extension is still a real customer action, so it is still audited.
    expect(await eventsOf(ID)).toEqual(["paused", "paused"]);
  });

  it("refuses to pause a cancelled subscription", async () => {
    await createTestCustomer({ id: ID, subscriptionStatus: "cancelled", billingDate: BILLING });
    const res = await postJson(POST, { customerId: ID, weeks: 2 });

    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "cancelled" });
    expect(await txnsOf(ID)).toEqual([]);
  });

  it("404s an unknown customer", async () => {
    const res = await postJson(POST, { customerId: "88888888-8888-8888-8888-888888880999", weeks: 2 });
    expect(res.status).toBe(404);
  });
});
