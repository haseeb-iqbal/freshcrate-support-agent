import { and, eq } from "drizzle-orm";
import { db } from "../../db";
import { orders } from "../../db/schema";
import { evaluateRefund } from "../guardrails/refund-policy";
import type { Tool } from "./types";

/**
 * Write-guarded refund. This tool NEVER writes — it only proposes. Three gates:
 *  - already refunded → can't auto-refund again; route to a human.
 *  - over the ceiling → route to a human.
 *  - otherwise → return a proposal; the actual write happens only via
 *    /api/actions/refund on the customer's explicit approval (PRD Section 12).
 */
export const issueRefund: Tool = {
  definition: {
    name: "issue_refund",
    description:
      "Propose a refund for one of the current customer's orders (e.g. a damaged or undelivered box), identified by its order number (e.g. FC1001). This does NOT immediately refund money — small refunds ask the customer to confirm; large refunds, and any order already refunded once, are routed to a human instead. Requires order_number and a brief reason; look the order up first if you don't have its number.",
    parameters: {
      type: "object",
      properties: {
        order_number: { type: "string", description: "The order to refund (e.g. FC1001)." },
        reason: { type: "string", description: "Why the refund is being requested." },
      },
      required: ["order_number", "reason"],
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const orderNumber = String(args.order_number ?? "").trim();
    const reason = String(args.reason ?? "").trim() || "No reason given";
    if (!orderNumber) return { ok: false, summary: "An order number is required to refund." };

    const [order] = await db
      .select()
      .from(orders)
      .where(and(eq(orders.orderNumber, orderNumber), eq(orders.customerId, ctx.customerId)))
      .limit(1);
    if (!order) {
      return { ok: false, summary: `No order ${orderNumber} found for this customer` };
    }

    const amount = `$${(order.totalCents / 100).toFixed(2)}`;

    // Safeguard: an order refunded once cannot be auto-refunded again.
    if (order.refundedAt) {
      return {
        ok: true,
        summary: `Order ${orderNumber} was already refunded — needs a human`,
        data: {
          status: "already_refunded",
          order_number: orderNumber,
          message:
            "This order has already been refunded once. A second refund cannot be issued automatically. Tell the customer it needs a human specialist and call escalate_to_human. Do not propose another refund for it.",
        },
      };
    }

    const decision = evaluateRefund({ totalCents: order.totalCents });
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
      summary: `Proposed refund of ${amount} for order ${orderNumber} — awaiting approval`,
      data: {
        status: "needs_confirmation",
        proposal: { order_number: orderNumber, amount_cents: order.totalCents, reason },
        message:
          "A confirmation card has been shown to the customer. Ask them to approve it to complete the refund. Do NOT say the refund is done — it is only proposed until they approve.",
      },
    };
  },
};
