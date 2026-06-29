import { escalateToHuman } from "./escalate";
import { lookupOrder } from "./orders";
import { issueRefund } from "./refund";
import { searchKnowledgeBase } from "./search";
import { pauseSubscription } from "./subscription";
import type { Tool } from "./types";

/** The five agent tools (PRD Section 9). */
export const tools: Tool[] = [
  searchKnowledgeBase,
  lookupOrder,
  pauseSubscription,
  issueRefund,
  escalateToHuman,
];

export const toolByName: Record<string, Tool> = Object.fromEntries(
  tools.map((t) => [t.definition.name, t]),
);

export const toolDefinitions = tools.map((t) => t.definition);

export type { Tool, ToolContext, ToolResult } from "./types";
