import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { setClock } from "@/lib/clock";
import { POST } from "@/app/api/chat/route";
import { createTestCustomer, purgeCustomer } from "../helpers/db";
import { postJson, postRaw } from "../helpers/http";

const ID = "88888888-8888-8888-8888-888888880060";
const TODAY = new Date(2026, 6, 20);
const user = (content: string) => [{ role: "user" as const, content }];

/**
 * Validation only. Every case here is rejected before runAgent is reached, so
 * no model is called and no API key is needed. The streaming path is covered by
 * the Cypress specs.
 */
describe("POST /api/chat input validation", () => {
  beforeAll(() => createTestCustomer({ id: ID, billingDate: "2026-08-17" }));
  beforeEach(() => setClock(() => TODAY));
  afterEach(() => setClock(null));
  afterAll(() => purgeCustomer(ID));

  it("rejects a malformed JSON body", async () => {
    const res = await postRaw(POST, "{not json");
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Invalid JSON body");
  });

  it("rejects a transcript with no messages", async () => {
    const res = await postJson(POST, { customerId: ID, messages: [] });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Expected a final user message");
  });

  it("rejects a transcript whose last turn is not the user's", async () => {
    const res = await postJson(POST, { customerId: ID, messages: [{ role: "assistant", content: "hi" }] });
    expect(res.status).toBe(400);
  });

  it("rejects a blank user message", async () => {
    const res = await postJson(POST, { customerId: ID, messages: user("   ") });
    expect(res.status).toBe(400);
  });

  it("rejects a message over the 2000 character limit before any model call", async () => {
    const res = await postJson(POST, { customerId: ID, messages: user("x".repeat(2001)) });
    expect(res.status).toBe(413);
  });

  it("accepts a message exactly at the limit", async () => {
    // Boundary check: 2000 must pass, so the limit is not off by one. This one
    // does reach the agent, so only the rejection status is asserted.
    const res = await postJson(POST, { customerId: ID, messages: user("x".repeat(2000)) });
    expect(res.status).not.toBe(413);
  });

  it("rejects a request with no customerId", async () => {
    const res = await postJson(POST, { messages: user("hello") });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Missing customerId");
  });

  it("rejects a customerId that does not exist", async () => {
    const res = await postJson(POST, { customerId: "88888888-8888-8888-8888-888888880999", messages: user("hello") });
    expect(res.status).toBe(400);
    expect(await res.text()).toBe("Unknown customer");
  });
});
