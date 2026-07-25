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
