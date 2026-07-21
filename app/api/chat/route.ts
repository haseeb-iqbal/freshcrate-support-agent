import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { runAgent } from "@/lib/agent/loop";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";

// postgres.js and the OpenAI SDK need the Node runtime (not edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  messages?: { role: "user" | "assistant"; content: string }[];
  customerId?: string;
}

const MAX_INPUT_CHARS = 2000; // reject oversized input before any model call

export async function POST(req: NextRequest) {
  let body: ChatRequestBody;
  try {
    body = (await req.json()) as ChatRequestBody;
  } catch {
    return new Response("Invalid JSON body", { status: 400 });
  }

  const messages = (body.messages ?? []).filter(
    (m) => m.role === "user" || m.role === "assistant",
  );
  const last = messages[messages.length - 1];
  if (!last || last.role !== "user" || !last.content?.trim()) {
    return new Response("Expected a final user message", { status: 400 });
  }
  if (last.content.length > MAX_INPUT_CHARS) {
    return new Response("Message exceeds the maximum length", { status: 413 });
  }
  if (!body.customerId) {
    return new Response("Missing customerId", { status: 400 });
  }

  // Bring the subscription up to date (billing, pause fees, auto-resume) before
  // the turn sees its state.
  await reconcile(body.customerId, now());

  // Resolve + validate the signed-in customer. This id is the trusted scope
  // passed to every tool — never the customer_id a model might emit.
  const [customer] = await db
    .select()
    .from(customers)
    .where(eq(customers.id, body.customerId))
    .limit(1);
  if (!customer) {
    return new Response("Unknown customer", { status: 400 });
  }
  const customerLabel = `${customer.name} (${customer.subscriptionStatus}, ${customer.plan})`;

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      try {
        await runAgent({
          customerId: customer.id,
          customerLabel,
          history: messages,
          emit,
        });
      } catch (err) {
        emit("error", { message: err instanceof Error ? err.message : "agent error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
