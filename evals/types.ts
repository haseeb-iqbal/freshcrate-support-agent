/** A rule check on one assistant turn. Every listed condition must hold. */
export interface Expect {
  /** Tools that must be called this turn (any order, others allowed). */
  tools?: string[];
  /** Tools that must NOT be called this turn. */
  noTools?: string[];
  /** No tool at all may be called this turn. */
  noToolsAtAll?: boolean;
  /** Proposal cards that must appear, each matching the given payload fields. */
  cards?: { event: string; where?: Record<string, unknown> }[];
  /** No proposal card may appear this turn. */
  noCards?: boolean;
  /** These proposal cards must not appear (others may). */
  noCardEvents?: string[];
  /**
   * A message asking for several actions: all of these cards, or at least one
   * of them plus a question back to the customer about the rest.
   */
  multi?: string[];
  /** The reply must ask the customer something (contains "?"). */
  asks?: boolean;
  /** Other SSE events that must appear ("order", "history", "sources"), with optional payload fields. */
  events?: { event: string; where?: Record<string, unknown> }[];
  /** A tool must not be called with these arguments (e.g. a refund for an order already refunded). */
  noToolCall?: { name: string; args: Record<string, unknown> };
  /** Facts the final reply must state: a string is matched case-insensitively, a RegExp as written. */
  facts?: (string | RegExp)[];
  /** Phrases the final reply must not contain, on top of the global banned list. */
  banned?: (string | RegExp)[];
  /**
   * A rubric an LLM judge scores the reply against, given the KB excerpts the
   * turn cited. Reported beside the rule checks; never fails the run.
   */
  judge?: string;
}

/** A customer message, then the checks on the reply to it. */
export interface SayStep {
  say: string;
  expect?: Expect;
}

/**
 * Click Confirm on the latest still-pending card of this kind, through the same
 * /api/actions route as the chat client, then check the customer row.
 */
export interface ConfirmStep {
  confirm: string;
  /** Customer columns (Drizzle field names) that must hold after the confirm. */
  db?: Record<string, unknown>;
}

export type Step = SayStep | ConfirmStep;

export interface EvalCase {
  id: string;
  /** Seeded customer key, from db/seed.ts. */
  customer: CustomerKey;
  steps: Step[];
  /** In the quick smoke set (`npm run eval:smoke`). */
  smoke?: boolean;
  /** A known bug: reported, but it does not fail the run. */
  knownFailing?: boolean;
  note?: string;
}

export type CustomerKey = "ava" | "marcus" | "priya" | "diego" | "lena" | "tom" | "sara" | "noah" | "mia" | "jamal";
