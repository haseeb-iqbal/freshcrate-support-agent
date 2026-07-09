import { buildSystemPrompt } from "./prompt";

/** Backward-compatible constant; assembled from lib/domain/terms via buildSystemPrompt. */
export const AGENT_SYSTEM_PROMPT = buildSystemPrompt();
