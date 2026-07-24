import { retrieve } from "../rag/retrieve";
import { selectExcerpts } from "./excerpts";
import type { Tool } from "./types";

/** Read-only KB search (agentic RAG, ADR-1). Over-fetches, then keeps only the
 *  excerpts that are actually relevant so the answer cites 1–N real sources
 *  rather than always 4. */
export const searchKnowledgeBase: Tool = {
  definition: {
    name: "search_knowledge_base",
    description:
      "Search the FreshCrate help center for policy, how-to and MENU information (delivery, pausing, cancellation, refunds, plans, pricing, dietary tracks, which meals and add-ons are on each menu, what is in a meal, ingredients and allergens, billing, referrals, etc.). Returns relevant article excerpts with citation labels. Use this for any policy, how-to or menu question - including \"what meals are on the standard/vegetarian/gluten-free/dairy-free menu\" - and answer only from what it returns.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "The customer's question or a focused search query." },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async handler(_ctx, args) {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, summary: "Empty search query." };

    const excerpts = selectExcerpts(await retrieve(query, { topK: 4 }));

    return {
      ok: true,
      summary: `Searched help center for "${query}" — ${excerpts.length} relevant excerpt(s)`,
      data: { excerpts },
    };
  },
};
