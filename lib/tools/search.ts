import { asUntrustedData } from "../guardrails/injection";
import { citationLabel } from "../rag/ground";
import { retrieve } from "../rag/retrieve";
import type { Tool } from "./types";

const MIN_SIMILARITY = 0.32; // absolute floor for "relevant"
const TOP_MARGIN = 0.12; // keep chunks within this of the best score

/** Read-only KB search (agentic RAG, ADR-1). Over-fetches, then keeps only the
 *  excerpts that are actually relevant so the answer cites 1–N real sources
 *  rather than always 4. */
export const searchKnowledgeBase: Tool = {
  definition: {
    name: "search_knowledge_base",
    description:
      "Search the FreshCrate help center for policy and how-to information (delivery, pausing, cancellation, refunds, plans, pricing, dietary options, billing, referrals, etc.). Returns relevant article excerpts with citation labels. Use this for any policy/how-to question and answer only from what it returns.",
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

    const chunks = await retrieve(query, { topK: 4 });
    const top = chunks[0]?.score ?? 0;
    const relevant = chunks.filter((c) => c.score >= MIN_SIMILARITY && c.score >= top - TOP_MARGIN);
    const used = relevant.length > 0 ? relevant : chunks.slice(0, 1);

    return {
      ok: true,
      summary: `Searched help center for "${query}" — ${used.length} relevant excerpt(s)`,
      data: {
        excerpts: used.map((c) => ({
          citation: citationLabel(c),
          slug: c.articleSlug,
          heading: c.heading,
          content: asUntrustedData(citationLabel(c), c.content),
        })),
      },
    };
  },
};
