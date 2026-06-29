import { citationLabel } from "../rag/ground";
import { retrieve } from "../rag/retrieve";
import type { Tool } from "./types";

/** Read-only KB search. This is the agentic-RAG tool (ADR-1): the model chooses
 *  to call it rather than retrieval being an always-on step. */
export const searchKnowledgeBase: Tool = {
  definition: {
    name: "search_knowledge_base",
    description:
      "Search the FreshCrate help center for policy and how-to information (delivery, pausing, cancellation, refunds, plans, dietary options, billing, referrals, etc.). Returns relevant article excerpts with citation labels. Use this for any policy/how-to question and answer only from what it returns.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "The customer's question or a focused search query.",
        },
      },
      required: ["query"],
      additionalProperties: false,
    },
  },
  async handler(_ctx, args) {
    const query = String(args.query ?? "").trim();
    if (!query) return { ok: false, summary: "Empty search query." };

    const chunks = await retrieve(query, { topK: 4 });
    return {
      ok: true,
      summary: `Searched help center for "${query}" — ${chunks.length} excerpt(s)`,
      data: {
        excerpts: chunks.map((c) => ({
          citation: citationLabel(c),
          slug: c.articleSlug,
          heading: c.heading,
          content: c.content,
        })),
      },
    };
  },
};
