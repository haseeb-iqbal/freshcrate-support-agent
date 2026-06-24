// Shared types for the RAG pipeline (chunking → embedding → retrieval → rerank).

/** A unit of knowledge-base text, addressed by article + heading for citations. */
export interface Chunk {
  articleSlug: string; // citation source id (filename without .md)
  heading: string; // citation section (the H2 it came from)
  content: string; // the section body, as stored and displayed
  title?: string; // article H1, used to enrich embedding context (not persisted)
}

/** A chunk returned from retrieval, with its relevance score. */
export interface RetrievedChunk {
  id: string;
  articleSlug: string;
  heading: string;
  content: string;
  score: number; // cosine similarity to the query, 0..1
}

/**
 * Swappable embedding backend. The agent and ingest both depend on this
 * interface, not on OpenAI directly, so the provider can be replaced later.
 */
export interface EmbeddingProvider {
  readonly model: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
