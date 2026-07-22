import { asUntrustedData } from "../guardrails/injection";
import { citationLabel } from "../rag/ground";
import type { RetrievedChunk } from "../rag/types";

/** Absolute similarity floor for treating a hit as relevant. */
export const MIN_SIMILARITY = 0.32;
/** Keep hits scoring within this margin of the best hit. */
export const TOP_MARGIN = 0.12;

export interface Excerpt {
  citation: string;
  slug: string;
  heading: string;
  /** Fenced as untrusted data - never handed to the model raw. */
  content: string;
}

/**
 * Choose the excerpts worth citing, and fence each one as untrusted data.
 *
 * Retrieval always returns topK hits, so citing all of them makes every answer
 * look equally well sourced. Keeping only hits that clear the absolute floor AND
 * sit within TOP_MARGIN of the best hit means a sharp question cites one source
 * and a broad one cites several. If nothing clears the bar we still keep the
 * single best hit, because answering from the closest match beats answering with
 * no source at all.
 */
export function selectExcerpts(chunks: RetrievedChunk[]): Excerpt[] {
  const top = chunks[0]?.score ?? 0;
  const relevant = chunks.filter((c) => c.score >= MIN_SIMILARITY && c.score >= top - TOP_MARGIN);
  const used = relevant.length > 0 ? relevant : chunks.slice(0, 1);
  return used.map((c) => ({
    citation: citationLabel(c),
    slug: c.articleSlug,
    heading: c.heading,
    content: asUntrustedData(citationLabel(c), c.content),
  }));
}
