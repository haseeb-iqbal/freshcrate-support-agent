import type { RetrievedChunk } from "./types";

/** Citation label, e.g. "delivery-schedule › How to cancel". Used by the
 *  search_knowledge_base tool and the chat UI to label sources. */
export function citationLabel(
  chunk: Pick<RetrievedChunk, "articleSlug" | "heading">,
): string {
  return `${chunk.articleSlug} › ${chunk.heading}`;
}
