import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";

type Customer = typeof customers.$inferSelect;

export interface ActionContext<B> {
  /** The parsed request body. Its own fields are still the route's to validate. */
  body: B;
  /** The signed-in customer, already reconciled. */
  customer: Customer;
  /**
   * "Now" for this request, read once. Every route used to call `now()` two or
   * three times per request, so a request that straddled midnight could
   * reconcile against one date and price against the next.
   */
  now: Date;
}

/** Any action body must name the customer it acts on. */
export interface ActionBody {
  customerId?: string;
}

/**
 * The shared preamble for every `/api/actions/*` route.
 *
 * All six routes opened with the same twenty-odd lines: parse the JSON or 400,
 * require a customerId or 400, `reconcile()` so the subscription is current on
 * read, then load the customer or 404. That block was copied per route, so a fix
 * to any of it had six places to land, and `"Invalid JSON body"` appeared
 * verbatim six times.
 *
 * What is deliberately NOT shared: each route's own guards (already cancelled,
 * not paused, unknown plan) and its writes. Those differ per action and belong
 * with the action.
 *
 * Note the reconcile now runs before a route validates its own fields, where
 * some routes previously validated first. That is safe because `reconcile` is
 * idempotent and writes nothing when nothing has come due, so an invalid
 * request still changes no state.
 */
export function actionRoute<B extends ActionBody>(
  handler: (ctx: ActionContext<B>) => Promise<Response>,
): (req: NextRequest) => Promise<Response> {
  return async (req: NextRequest) => {
    let body: B;
    try {
      body = (await req.json()) as B;
    } catch {
      return new Response("Invalid JSON body", { status: 400 });
    }

    const { customerId } = body;
    if (!customerId) return new Response("Missing customerId", { status: 400 });

    const at = now();
    await reconcile(customerId, at);

    const [customer] = await db.select().from(customers).where(eq(customers.id, customerId)).limit(1);
    if (!customer) return new Response("Unknown customer", { status: 404 });

    return handler({ body, customer, now: at });
  };
}
