import OpenAI from "openai";
import type { EmbeddingProvider } from "./types";

const MODEL = process.env.EMBEDDING_MODEL ?? "text-embedding-3-small";
const DIMENSIONS = 1536; // must match kb_chunks.embedding vector(1536)
const MAX_BATCH = 256; // stay well under OpenAI's per-request input limit

/** OpenAI-backed embeddings (ADR-3). Batches inputs to bound request size. */
export class OpenAIEmbeddingProvider implements EmbeddingProvider {
  readonly model = MODEL;
  readonly dimensions = DIMENSIONS;
  private client: OpenAI;

  constructor(apiKey: string | undefined = process.env.OPENAI_API_KEY) {
    if (!apiKey) {
      throw new Error("OPENAI_API_KEY is not set — required for embeddings.");
    }
    this.client = new OpenAI({ apiKey });
  }

  async embed(texts: string[]): Promise<number[][]> {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    for (let i = 0; i < texts.length; i += MAX_BATCH) {
      const batch = texts.slice(i, i + MAX_BATCH);
      const res = await this.client.embeddings.create({
        model: MODEL,
        input: batch,
      });
      // The API preserves input order; sort defensively just in case.
      const sorted = [...res.data].sort((a, b) => a.index - b.index);
      out.push(...sorted.map((d) => d.embedding));
    }
    return out;
  }
}

export function getEmbeddingProvider(): EmbeddingProvider {
  return new OpenAIEmbeddingProvider();
}
