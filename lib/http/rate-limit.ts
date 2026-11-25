import { createHmac } from "node:crypto";
import { isIP } from "node:net";
import { and, asc, count, eq, gte, lt, sql } from "drizzle-orm";
import { db } from "@/db";
import { chatRateEvents } from "@/db/schema";

/**
 * Per-visitor and global limits on chat turns, the only route that spends money
 * on the model. Counts live in Postgres (chat_rate_events), not in memory, so
 * they hold across serverless instances. Confirm and card actions
 * (/api/actions/*) never call this, so a visitor can always finish a card that
 * is already on screen.
 */

const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;

export interface RateLimits {
  /** Chat turns one visitor may send in any rolling hour. */
  perVisitorPerHour: number;
  /** Chat turns all visitors together may send in any rolling 24 hours. */
  globalPerDay: number;
}

export function limitsFromEnv(): RateLimits {
  return {
    perVisitorPerHour: Number(process.env.RATE_LIMIT_PER_HOUR ?? 30),
    globalPerDay: Number(process.env.RATE_LIMIT_PER_DAY ?? 1500),
  };
}

/** Off for the scripted mock model (it costs nothing, and the test suites run on
 *  it) and when RATE_LIMIT_DISABLED=1, which the real-model evals set. */
export function rateLimitEnabled(): boolean {
  return process.env.MOCK_LLM !== "1" && process.env.RATE_LIMIT_DISABLED !== "1";
}

/**
 * The client's IP address, read only from headers the platform sets.
 * Vercel sets x-vercel-forwarded-for and x-real-ip itself; a visitor can add
 * entries to x-forwarded-for, so only its LAST entry (appended by the proxy in
 * front of the app) is used, never the first. Anything that isn't a valid IP
 * becomes "unknown", a single shared bucket, so a junk header can't mint a fresh
 * identity per request. The daily cap bounds the total either way.
 */
export function clientIp(headers: Headers): string {
  const candidates = [
    headers.get("x-vercel-forwarded-for")?.split(",")[0],
    headers.get("x-real-ip"),
    headers.get("x-forwarded-for")?.split(",").pop(),
  ];
  for (const c of candidates) {
    const ip = c?.trim();
    if (ip && isIP(ip)) return ip;
  }
  return "unknown";
}

/**
 * The HMAC key for visitor ids: RATE_LIMIT_SECRET, a value used for nothing
 * else. Required in production (null there means misconfigured, and the chat
 * route refuses turns rather than run without a limit); local development
 * falls back to a fixed key.
 */
export function rateLimitSecret(): string | null {
  const secret = process.env.RATE_LIMIT_SECRET;
  if (secret) return secret;
  return process.env.NODE_ENV === "production" ? null : "freshcrate-local-dev";
}

/**
 * A stable, non-reversible id for the visitor: an HMAC of their IP address keyed
 * with a server-side secret, so the stored value can't be turned back into an IP
 * by trying every address.
 */
export function visitorId(headers: Headers, secret: string): string {
  return createHmac("sha256", secret).update(clientIp(headers)).digest("hex");
}

export type RateDecision =
  | { ok: true }
  | { ok: false; scope: "visitor" | "global"; limit: number; retryAfterSec: number };

/**
 * Check both limits for one chat turn at `at`, and record the turn if it is
 * allowed. A denied turn is not recorded, so retrying doesn't push the wait out.
 */
export async function takeChatTurn(visitor: string, at: Date, limits: RateLimits): Promise<RateDecision> {
  // Check-then-insert runs under one transaction-scoped advisory lock, so
  // concurrent turns are counted one at a time and can't all slip under a limit.
  // The lock is held for a few small queries per chat turn.
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(${RATE_LIMIT_LOCK})`);
    return check(tx, visitor, at, limits);
  });
}

/** Arbitrary constant naming the advisory lock the limiter takes. */
const RATE_LIMIT_LOCK = 7_310_201;

type Tx = Parameters<Parameters<typeof db.transaction>[0]>[0];

async function check(db: Tx, visitor: string, at: Date, limits: RateLimits): Promise<RateDecision> {
  const hourAgo = new Date(at.getTime() - HOUR_MS);
  const dayAgo = new Date(at.getTime() - DAY_MS);

  // Nothing older than a day is ever counted, so drop it.
  await db.delete(chatRateEvents).where(lt(chatRateEvents.createdAt, dayAgo));

  const mine = and(eq(chatRateEvents.visitor, visitor), gte(chatRateEvents.createdAt, hourAgo));
  const [{ n: visitorTurns }] = await db.select({ n: count() }).from(chatRateEvents).where(mine);
  if (visitorTurns >= limits.perVisitorPerHour) {
    const [oldest] = await db
      .select({ at: chatRateEvents.createdAt })
      .from(chatRateEvents)
      .where(mine)
      .orderBy(asc(chatRateEvents.createdAt))
      .limit(1);
    return { ok: false, scope: "visitor", limit: limits.perVisitorPerHour, retryAfterSec: secondsUntil(oldest?.at, HOUR_MS, at) };
  }

  const today = gte(chatRateEvents.createdAt, dayAgo);
  const [{ n: allTurns }] = await db.select({ n: count() }).from(chatRateEvents).where(today);
  if (allTurns >= limits.globalPerDay) {
    const [oldest] = await db
      .select({ at: chatRateEvents.createdAt })
      .from(chatRateEvents)
      .where(today)
      .orderBy(asc(chatRateEvents.createdAt))
      .limit(1);
    return { ok: false, scope: "global", limit: limits.globalPerDay, retryAfterSec: secondsUntil(oldest?.at, DAY_MS, at) };
  }

  await db.insert(chatRateEvents).values({ visitor, createdAt: at });
  return { ok: true };
}

/** Seconds until the oldest counted turn leaves its window, at least 1. */
function secondsUntil(oldest: Date | undefined, windowMs: number, at: Date): number {
  const freeAt = (oldest?.getTime() ?? at.getTime()) + windowMs;
  return Math.max(1, Math.ceil((freeAt - at.getTime()) / 1000));
}

/** What the visitor sees in the chat when a turn is refused. */
export function limitMessage(d: Extract<RateDecision, { ok: false }>): string {
  if (d.scope === "visitor") {
    const minutes = Math.max(1, Math.ceil(d.retryAfterSec / 60));
    return `You've sent ${d.limit} messages in the last hour, which is the most this demo allows. Please try again in about ${minutes} minute${minutes === 1 ? "" : "s"}.`;
  }
  const hours = Math.max(1, Math.ceil(d.retryAfterSec / 3600));
  return `The demo has reached its limit of ${d.limit} messages a day for everyone. Please try again in about ${hours} hour${hours === 1 ? "" : "s"}.`;
}
