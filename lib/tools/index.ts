import { escalateToHuman } from "./escalate";
import { listOrders, lookupOrder } from "./orders";
import { changePlan } from "./plan";
import { issueRefund } from "./refund";
import { searchKnowledgeBase } from "./search";
import {
  cancelSubscription,
  pauseSubscription,
  reactivateSubscription,
  resumeSubscription,
} from "./subscription";
import type { Tool } from "./types";

/** The agent tools: PRD Section 9 + order history, subscription lifecycle, plans. */
export const tools: Tool[] = [
  searchKnowledgeBase,
  lookupOrder,
  listOrders,
  pauseSubscription,
  resumeSubscription,
  reactivateSubscription,
  cancelSubscription,
  changePlan,
  issueRefund,
  escalateToHuman,
];

export const toolByName: Record<string, Tool> = Object.fromEntries(
  tools.map((t) => [t.definition.name, t]),
);

export const toolDefinitions = tools.map((t) => t.definition);

export type { Tool, ToolContext, ToolResult } from "./types";
