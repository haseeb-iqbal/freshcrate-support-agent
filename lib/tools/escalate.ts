import { db } from "../../db";
import { escalations } from "../../db/schema";
import type { Tool } from "./types";

/** Write tool: hand off to a human by logging an escalation record. */
export const escalateToHuman: Tool = {
  definition: {
    name: "escalate_to_human",
    description:
      "Hand off to a human support specialist. Use when the customer explicitly asks for a human, when the request is out of scope or sensitive, or when a policy requires manual review. Provide a short summary of the issue.",
    parameters: {
      type: "object",
      properties: {
        summary: {
          type: "string",
          description: "Brief summary of the issue for the human agent.",
        },
      },
      required: ["summary"],
      additionalProperties: false,
    },
  },
  async handler(ctx, args) {
    const summary =
      String(args.summary ?? "").trim() || "Customer requested human assistance";

    const [row] = await db
      .insert(escalations)
      .values({ customerId: ctx.customerId, summary })
      .returning({ id: escalations.id });

    return {
      ok: true,
      summary: "Escalated to a human specialist",
      data: { escalation_id: row.id, summary },
    };
  },
};
