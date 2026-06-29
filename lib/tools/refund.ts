import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { orders } from "../../db/schema";
import { evaluateRefund } from "../guardrails/refund-policy";
import type { Tool } from "./types";

/**
 * Write-guarded refund. This tool NEVER writes — it only proposes.
 *  - Over the ceiling → returns over_ceiling; the agent then escalates.
 *  - At/under the ceiling → returns a proposal; the UI shows a confirmation
 *    card and the actual write happens only via /api/actions/refund on the
 *    customer's explicit approval (human-in-the-loop, PRD Section 12).
 */
export const issueRefund: Tool = {
  definition: {
    name: "issue_refund",
    description:
      "Propose a refund for a specific order belonging to the current customer (e.g. a damaged or undelivered box). This does NOT immediately refund money — it asks the customer to confirm, and large refunds are routed to a human instead. Requires order_id and a brief reason; look the order up first if you don't have its id.",
    parameters: {
      type: "object",
      properties: {
        order_id: { type: "string", description: "The order to refund." },
        reason: { type: "string", description: "Why the refund is being requested." },
      },
      required: ["order_id", "reason"],
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const orderId = String(args.order_id ?? "").trim();
    const reason = String(args.reason ?? "").trim() || "No reason given";
    if (!orderId) return { ok: false, summary: "An order_id is required to refund." };

    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.customerId, ctx.customerId)))
      .limit(1);
    if (!order) {
      return { ok: false, summary: `No order ${orderId} found for this customer` };
    }

    const decision = evaluateRefund({ totalCents: order.totalCents });
    const amount = `$${(order.totalCents / 100).toFixed(2)}`;

    if (decision.kind === "over_ceiling") {
      return {
        ok: true,
        summary: `Refund ${amount} exceeds the self-service limit — needs a human`,
        data: {
          status: "over_ceiling",
          amount_cents: order.totalCents,
          ceiling_cents: decision.ceilingCents,
          message:
            "This refund is above the amount support can approve automatically. Tell the customer it needs a human specialist, then call escalate_to_human. Do not claim the refund was issued.",
        },
      };
    }

    // needs_confirmation — propose only; the write happens on user approval.
    return {
      ok: true,
      summary: `Proposed refund of ${amount} for order ${orderId.slice(0, 8)} — awaiting approval`,
      data: {
        status: "needs_confirmation",
        proposal: { order_id: orderId, amount_cents: order.totalCents, reason },
        message:
          "A confirmation card has been shown to the customer. Ask them to approve it to complete the refund. Do NOT say the refund is done — it is only proposed until they approve.",
      },
    };
  },
};
