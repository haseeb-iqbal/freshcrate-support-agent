import { cosineDistance, desc, gt, sql } from "drizzle-orm";
import { db } from "../../db";
import { kbChunks } from "../../db/schema";
import { getEmbeddingProvider } from "./embed";
import { mmrRerank, type Candidate } from "./rerank";
import type { EmbeddingProvider, RetrievedChunk } from "./types";

export interface RetrieveOptions {
  /** Final number of chunks returned after rerank. */
  topK?: number;
  /** Candidates pulled by vector search before rerank (over-fetch for MMR). */
  fetchK?: number;
  /** Drop candidates below this cosine similarity (0..1). */
  minSimilarity?: number;
  /** Apply MMR rerank over the fetched candidates. */
  rerank?: boolean;
  /** MMR relevance/diversity tradeoff (1 = pure relevance). */
  lambda?: number;
  /** Inject a provider (tests); defaults to the OpenAI provider. */
  provider?: EmbeddingProvider;
}

/**
 * Agentic-RAG retrieval (ADR-1): embed the query, pull the nearest chunks by
 * pgvector cosine distance, then MMR-rerank to a diverse top-K. Each result
 * carries article_slug + heading so the agent can cite its source.
 */
export async function retrieve(
  query: string,
  opts: RetrieveOptions = {},
): Promise<RetrievedChunk[]> {
  const {
    topK = 4,
    fetchK = 12,
    minSimilarity = 0,
    rerank = true,
    lambda = 0.7,
    provider = getEmbeddingProvider(),
  } = opts;

  const [queryEmbedding] = await provider.embed([query]);

  // 1 - cosine_distance = cosine similarity. The fragment is reused in WHERE,
  // so Postgres re-evaluates the expression rather than referencing the alias.
  const similarity = sql<number>`1 - (${cosineDistance(kbChunks.embedding, queryEmbedding)})`;

  const rows = await db
    .select({
      id: kbChunks.id,
      articleSlug: kbChunks.articleSlug,
      heading: kbChunks.heading,
      content: kbChunks.content,
      embedding: kbChunks.embedding,
      similarity,
    })
    .from(kbChunks)
    .where(gt(similarity, minSimilarity))
    .orderBy(desc(similarity))
    .limit(fetchK);

  const candidates: Candidate[] = rows.map((r) => ({
    chunk: {
      id: r.id,
      articleSlug: r.articleSlug,
      heading: r.heading,
      content: r.content,
      score: Number(r.similarity),
    },
    embedding: normalizeEmbedding(r.embedding),
  }));

  if (!rerank) {
    return candidates.slice(0, topK).map((c) => c.chunk);
  }
  return mmrRerank(queryEmbedding, candidates, topK, lambda);
}

/** pgvector may surface as number[] (drizzle) or a "[..]" string; handle both. */
function normalizeEmbedding(value: unknown): number[] {
  if (Array.isArray(value)) return value as number[];
  if (typeof value === "string") {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map(Number);
  }
  return [];
}
