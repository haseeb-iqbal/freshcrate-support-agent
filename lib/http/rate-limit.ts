import { createHmac } from "node:crypto";
import { and, asc, count, eq, gte, lt } from "drizzle-orm";
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
 * A stable, non-reversible id for the visitor: an HMAC of their IP address.
 * On Vercel the first x-forwarded-for entry is the client address. The key is
 * RATE_LIMIT_SECRET, falling back to OPENAI_API_KEY so a deploy works without
 * extra setup; either way it stays on the server, so the stored value can't be
 * turned back into an IP by trying every address.
 */
export function visitorId(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  const ip = forwarded || headers.get("x-real-ip")?.trim() || "unknown";
  const secret = process.env.RATE_LIMIT_SECRET || process.env.OPENAI_API_KEY || "freshcrate-local";
  return createHmac("sha256", secret).update(ip).digest("hex");
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
