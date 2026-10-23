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
  /** Other SSE events that must appear ("order", "history", "sources"), with optional payload fields. */
  events?: { event: string; where?: Record<string, unknown> }[];
  /** A tool must not be called with these arguments (e.g. a refund for an order already refunded). */
  noToolCall?: { name: string; args: Record<string, unknown> };
  /** Facts the final reply must state: a string is matched case-insensitively, a RegExp as written. */
  facts?: (string | RegExp)[];
  /** Phrases the final reply must not contain, on top of the global banned list. */
  banned?: (string | RegExp)[];
}

/** A customer message, then the checks on the reply to it. */
export interface SayStep {
  say: string;
  expect?: Expect;
}

/** Click Confirm on the latest still-pending card of this kind, as the chat client would. */
export interface ConfirmStep {
  confirm: "refund_proposal" | "plan_change_proposal";
}

export type Step = SayStep | ConfirmStep;

export interface EvalCase {
  id: string;
  /** Seeded customer key, from db/seed.ts. */
  customer: CustomerKey;
  steps: Step[];
  /** A known bug: reported, but it does not fail the run. */
  knownFailing?: boolean;
  note?: string;
}

export type CustomerKey = "ava" | "marcus" | "priya" | "diego" | "lena" | "tom" | "sara" | "noah" | "mia" | "jamal";
