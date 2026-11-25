import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { db } from "@/db";
import { chatRateEvents } from "@/db/schema";
import { setClock } from "@/lib/clock";
import { takeChatTurn, visitorId } from "@/lib/http/rate-limit";
import { POST as chatPOST } from "@/app/api/chat/route";
import { POST as pausePOST } from "@/app/api/actions/pause/route";
import { createTestCustomer, purgeCustomer } from "../helpers/db";
import { postJson } from "../helpers/http";

const ID = "88888888-8888-8888-8888-888888880070";
const TODAY = new Date(2026, 6, 20, 12);
const IP = "203.0.113.7";

const SECRET = "test-secret";

const chat = () =>
  chatPOST(
    new Request("http://test.local", {
      method: "POST",
      headers: { "content-type": "application/json", "x-real-ip": IP },
      body: JSON.stringify({ customerId: ID, messages: [{ role: "user", content: "where's my latest order?" }] }),
    }) as never,
  );

/**
 * The limit is off under MOCK_LLM, which this suite sets, so these tests switch
 * it on by clearing MOCK_LLM. Every request here is refused before the model is
 * reached, so no real model call can happen.
 */
describe("chat rate limit on the routes", () => {
  const saved = {
    mock: process.env.MOCK_LLM,
    hour: process.env.RATE_LIMIT_PER_HOUR,
    day: process.env.RATE_LIMIT_PER_DAY,
    secret: process.env.RATE_LIMIT_SECRET,
  };

  beforeAll(() => createTestCustomer({ id: ID, billingDate: "2026-08-17" }));
  beforeEach(async () => {
    setClock(() => TODAY);
    await db.delete(chatRateEvents);
    process.env.MOCK_LLM = "";
    process.env.RATE_LIMIT_PER_HOUR = "2";
    process.env.RATE_LIMIT_PER_DAY = "4";
    process.env.RATE_LIMIT_SECRET = SECRET;
  });
  // Assigning undefined to process.env stores the string "undefined", so unset.
  const restore = (key: string, value: string | undefined) => {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  };
  afterEach(() => {
    setClock(null);
    restore("MOCK_LLM", saved.mock);
    restore("RATE_LIMIT_PER_HOUR", saved.hour);
    restore("RATE_LIMIT_PER_DAY", saved.day);
    restore("RATE_LIMIT_SECRET", saved.secret);
  });
  afterAll(async () => {
    await db.delete(chatRateEvents);
    await purgeCustomer(ID);
  });

  const LIMITS = { perVisitorPerHour: 2, globalPerDay: 4 };

  it("returns 429 with Retry-After and a readable message once a visitor is over the hourly limit", async () => {
    const visitor = visitorId(new Headers({ "x-real-ip": IP }), SECRET);
    await takeChatTurn(visitor, new Date(TODAY.getTime() - 30 * 60_000), LIMITS);
    await takeChatTurn(visitor, new Date(TODAY.getTime() - 20 * 60_000), LIMITS);

    const res = await chat();
    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe(String(30 * 60));
    expect(await res.text()).toBe(
      "You've sent 2 messages in the last hour, which is the most this demo allows. Please try again in about 30 minutes.",
    );
  });

  it("returns 429 once every visitor together reaches the daily cap", async () => {
    for (const v of ["a", "b", "c", "d"]) await takeChatTurn(v, new Date(TODAY.getTime() - 60_000), LIMITS);
    const res = await chat();
    expect(res.status).toBe(429);
    expect(await res.text()).toContain("limit of 4 messages a day");
  });

  it("never blocks card actions, so a card already on screen can be confirmed", async () => {
    for (const v of ["a", "b", "c", "d"]) await takeChatTurn(v, new Date(TODAY.getTime() - 60_000), LIMITS);
    expect((await chat()).status).toBe(429);
    const res = await postJson(pausePOST, { customerId: ID, weeks: 2 });
    expect(res.status).toBe(200);
  });

  it("is off under the mock model, so the test suites are unaffected", async () => {
    process.env.MOCK_LLM = "1";
    for (const v of ["a", "b", "c", "d"]) await takeChatTurn(v, new Date(TODAY.getTime() - 60_000), LIMITS);
    const res = await chat();
    expect(res.status).toBe(200);
    await res.body?.cancel();
  });
});
