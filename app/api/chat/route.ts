import type { NextRequest } from "next/server";
import { getChatProvider } from "@/lib/llm";
import { buildGroundedMessages } from "@/lib/rag/ground";
import { retrieve } from "@/lib/rag/retrieve";
import type { ChatMessage } from "@/lib/llm/types";

// postgres.js and the OpenAI SDK need the Node runtime (not edge).
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ChatRequestBody {
  messages?: ChatMessage[];
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

  const question = last.content.trim();

  // Phase 2: retrieve-then-generate. (Phase 3 makes search an agent tool.)
  const chunks = await retrieve(question, { topK: 4 });
  const chatMessages = buildGroundedMessages(messages, chunks);
  const provider = getChatProvider();

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (event: string, data: unknown) => {
        controller.enqueue(
          encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`),
        );
      };

      try {
        // Emit the citations up front so the UI can show sources immediately.
        send(
          "sources",
          chunks.map((c) => ({
            slug: c.articleSlug,
            heading: c.heading,
            score: Number(c.score.toFixed(3)),
          })),
        );

        for await (const delta of provider.streamChat({ messages: chatMessages })) {
          send("delta", delta);
        }
        send("done", {});
      } catch (err) {
        send("error", { message: err instanceof Error ? err.message : "stream error" });
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
