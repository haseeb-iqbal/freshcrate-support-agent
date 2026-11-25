import { beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { db } from "@/db";
import { chatRateEvents } from "@/db/schema";
import { limitMessage, takeChatTurn, visitorId } from "@/lib/http/rate-limit";

const AT = new Date("2026-07-20T12:00:00Z");
const minutes = (n: number) => new Date(AT.getTime() + n * 60_000);
const LIMITS = { perVisitorPerHour: 3, globalPerDay: 5 };

describe("chat rate limit", () => {
  beforeEach(async () => {
    await db.delete(chatRateEvents);
  });

  it("lets a visitor through while under the hourly limit", async () => {
    for (let i = 0; i < 3; i++) expect(await takeChatTurn("a", minutes(i), LIMITS)).toEqual({ ok: true });
  });

  it("refuses the turn over the limit and says when the oldest one expires", async () => {
    for (let i = 0; i < 3; i++) await takeChatTurn("a", minutes(i), LIMITS);
    const d = await takeChatTurn("a", minutes(10), LIMITS);
    // The first turn (minute 0) leaves the window at minute 60: 50 minutes away.
    expect(d).toEqual({ ok: false, scope: "visitor", limit: 3, retryAfterSec: 50 * 60 });
    if (!d.ok) expect(limitMessage(d)).toContain("try again in about 50 minutes");
  });

  it("does not record a refused turn, and lets the visitor back in an hour later", async () => {
    for (let i = 0; i < 3; i++) await takeChatTurn("a", minutes(i), LIMITS);
    await takeChatTurn("a", minutes(10), LIMITS);
    expect(await db.select().from(chatRateEvents)).toHaveLength(3);
    expect(await takeChatTurn("a", minutes(61), LIMITS)).toEqual({ ok: true });
  });

  it("counts each visitor separately", async () => {
    for (let i = 0; i < 3; i++) await takeChatTurn("a", minutes(i), LIMITS);
    expect(await takeChatTurn("b", minutes(5), LIMITS)).toEqual({ ok: true });
  });

  it("applies the daily cap across all visitors", async () => {
    for (const v of ["a", "b", "c", "d", "e"]) expect(await takeChatTurn(v, minutes(1), LIMITS)).toEqual({ ok: true });
    const d = await takeChatTurn("f", minutes(2), LIMITS);
    expect(d).toMatchObject({ ok: false, scope: "global", limit: 5 });
    if (!d.ok) expect(limitMessage(d)).toContain("limit of 5 messages a day");
  });

  it("forgets turns older than a day", async () => {
    for (const v of ["a", "b", "c", "d", "e"]) await takeChatTurn(v, minutes(0), LIMITS);
    expect(await takeChatTurn("f", minutes(24 * 60 + 1), LIMITS)).toEqual({ ok: true });
    expect(await db.select().from(chatRateEvents)).toHaveLength(1);
  });

  it("identifies a visitor by a hash of their IP, never the IP itself", () => {
    const one = visitorId(new Headers({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" }));
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(one).not.toContain("203.0.113.7");
    expect(visitorId(new Headers({ "x-forwarded-for": "203.0.113.7" }))).toBe(one);
    expect(visitorId(new Headers({ "x-forwarded-for": "198.51.100.4" }))).not.toBe(one);
  });
});
