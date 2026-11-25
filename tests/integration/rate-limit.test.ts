import { beforeEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { db } from "@/db";
import { chatRateEvents } from "@/db/schema";
import { clientIp, limitMessage, takeChatTurn, visitorId } from "@/lib/http/rate-limit";

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

  it("never lets concurrent turns from different visitors overshoot the daily cap", async () => {
    const visitors = Array.from({ length: 12 }, (_, i) => `v${i}`);
    const results = await Promise.all(visitors.map((v) => takeChatTurn(v, minutes(1), LIMITS)));
    expect(results.filter((r) => r.ok)).toHaveLength(5);
    expect(await db.select().from(chatRateEvents)).toHaveLength(5);
  });

  it("forgets turns older than a day", async () => {
    for (const v of ["a", "b", "c", "d", "e"]) await takeChatTurn(v, minutes(0), LIMITS);
    expect(await takeChatTurn("f", minutes(24 * 60 + 1), LIMITS)).toEqual({ ok: true });
    expect(await db.select().from(chatRateEvents)).toHaveLength(1);
  });

  it("identifies a visitor by a keyed hash of their IP, never the IP itself", () => {
    const h = (ip: string) => new Headers({ "x-real-ip": ip });
    const one = visitorId(h("203.0.113.7"), "secret");
    expect(one).toMatch(/^[0-9a-f]{64}$/);
    expect(one).not.toContain("203.0.113.7");
    expect(visitorId(h("203.0.113.7"), "secret")).toBe(one);
    expect(visitorId(h("198.51.100.4"), "secret")).not.toBe(one);
    expect(visitorId(h("203.0.113.7"), "other-secret")).not.toBe(one);
  });

  it("reads the IP only from headers the platform sets", () => {
    expect(clientIp(new Headers({ "x-vercel-forwarded-for": "203.0.113.7", "x-real-ip": "10.0.0.1" }))).toBe("203.0.113.7");
    expect(clientIp(new Headers({ "x-real-ip": "203.0.113.7" }))).toBe("203.0.113.7");
    // A visitor can prepend to x-forwarded-for; only the proxy-appended last entry counts.
    expect(clientIp(new Headers({ "x-forwarded-for": "1.2.3.4, 203.0.113.7" }))).toBe("203.0.113.7");
    // Junk can't mint a fresh identity: it all lands in one shared bucket.
    expect(clientIp(new Headers({ "x-forwarded-for": "not-an-ip" }))).toBe("unknown");
    expect(clientIp(new Headers())).toBe("unknown");
  });

  it("never lets one visitor's concurrent turns slip past their limit", async () => {
    const results = await Promise.all(Array.from({ length: 8 }, () => takeChatTurn("a", minutes(1), LIMITS)));
    expect(results.filter((r) => r.ok)).toHaveLength(3);
    expect(await db.select().from(chatRateEvents)).toHaveLength(3);
  });
});
