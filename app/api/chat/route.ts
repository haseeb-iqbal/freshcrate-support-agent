import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { customers } from "@/db/schema";
import { runAgent, type TurnSummary } from "@/lib/agent/loop";
import { reconcile } from "@/lib/billing/reconcile";
import { now } from "@/lib/clock";
import { parseDecisions } from "@/lib/decisions";
import { recordTrace } from "@/lib/observability/traces";

// postgres.js and the OpenAI SDK need the Node runtime (not edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  messages?: { role: "user" | "assistant"; content: string }[];
  customerId?: string;
  /** Enum-only log of what the customer did with each confirmation prompt. */
  decisions?: unknown;
  /** The chat session this turn belongs to, for the traces log. */
  conversationId?: string;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

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
  // Enum-only by construction, so there is no client-supplied text to fence.
  const decisions = parseDecisions(body.decisions);

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

  // The browser sends one id per chat session; anything else gets a fresh one,
  // so a bad id can never land in the traces table.
  const conversationId = body.conversationId && UUID.test(body.conversationId) ? body.conversationId : crypto.randomUUID();
  const turnIndex = messages.filter((m) => m.role === "user").length - 1;
  const started = Date.now();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const emit = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };
      let summary: TurnSummary | null = null;
      try {
        summary = await runAgent({
          customerId: customer.id,
          customerLabel,
          history: messages,
          decisions,
          emit,
        });
      } catch (err) {
        emit("error", { message: err instanceof Error ? err.message : "agent error" });
      } finally {
        controller.close();
        // After the response has finished, so the customer never waits on it.
        void recordTrace({ conversationId, customerId: customer.id, turnIndex, userMessage: last.content, latencyMs: Date.now() - started, summary });
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
