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
 * This app is deployed on Vercel, whose edge sets x-vercel-forwarded-for and
 * x-real-ip itself and overwrites any value a visitor sends, so those come
 * first. The last x-forwarded-for entry (the one the nearest proxy appended,
 * never the visitor-controlled first one) is a fallback for other hosts.
 * Anything that isn't a valid IP becomes "unknown": on Vercel that never
 * happens, and locally it is just one shared bucket. The daily cap bounds the
 * total either way.
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
  const hourAgo = new Date(at.getTime() - HOUR_MS);
  const dayAgo = new Date(at.getTime() - DAY_MS);

  // Two transaction-scoped advisory locks keep both limits exact under
  // concurrency. The per-visitor lock serialises one visitor's turns while that
  // visitor's hourly count is checked, so different visitors don't wait on each
  // other there. Only a visitor still under their limit then takes the shared
  // lock, which covers just the daily count and the insert, so concurrent turns
  // can't overshoot the daily cap either. Waits over 3 seconds error out instead
  // of piling up connections.
  return db.transaction(async (tx) => {
    await tx.execute(sql`set local lock_timeout = '3s'`);
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${visitor}))`);

    const mine = and(eq(chatRateEvents.visitor, visitor), gte(chatRateEvents.createdAt, hourAgo));
    const [{ n: visitorTurns }] = await tx.select({ n: count() }).from(chatRateEvents).where(mine);
    if (visitorTurns >= limits.perVisitorPerHour) {
      const [oldest] = await tx
        .select({ at: chatRateEvents.createdAt })
        .from(chatRateEvents)
        .where(mine)
        .orderBy(asc(chatRateEvents.createdAt))
        .limit(1);
      return { ok: false, scope: "visitor", limit: limits.perVisitorPerHour, retryAfterSec: secondsUntil(oldest?.at, HOUR_MS, at) };
    }

    await tx.execute(sql`select pg_advisory_xact_lock(${GLOBAL_LOCK})`);
    const today = gte(chatRateEvents.createdAt, dayAgo);
    const [{ n: allTurns }] = await tx.select({ n: count() }).from(chatRateEvents).where(today);
    if (allTurns >= limits.globalPerDay) {
      const [oldest] = await tx
        .select({ at: chatRateEvents.createdAt })
        .from(chatRateEvents)
        .where(today)
        .orderBy(asc(chatRateEvents.createdAt))
        .limit(1);
      return { ok: false, scope: "global", limit: limits.globalPerDay, retryAfterSec: secondsUntil(oldest?.at, DAY_MS, at) };
    }

    await tx.insert(chatRateEvents).values({ visitor, createdAt: at });
    // Housekeeping only on an admitted turn, so a refused request can't trigger
    // writes: nothing older than a day is ever counted. Indexed on created_at.
    await tx.delete(chatRateEvents).where(lt(chatRateEvents.createdAt, dayAgo));
    return { ok: true };
  });
}

/** Arbitrary constant naming the shared advisory lock for the daily cap. */
const GLOBAL_LOCK = 7_310_201;

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
