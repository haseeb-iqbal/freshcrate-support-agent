import { PAUSE_FEE_CENTS } from "../../billing/pricing";
import { money } from "../../money";

/** The pause fee as it is written for humans and for the model, e.g. "$8/week".
 *  Derived so the fee quoted in tool descriptions, summaries and model-facing
 *  messages cannot drift from PAUSE_FEE_CENTS. */
export const PAUSE_FEE_PER_WEEK = `${money(PAUSE_FEE_CENTS)}/week`;
