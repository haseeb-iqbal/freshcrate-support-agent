import "dotenv/config";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { client, db } from "../db";
import { kbChunks } from "../db/schema";
import { chunkArticle, embeddingText } from "../lib/rag/chunk";
import { getEmbeddingProvider } from "../lib/rag/embed";
import type { Chunk } from "../lib/rag/types";

const ARTICLES_DIR = path.join(process.cwd(), "kb", "articles");

/**
 * Ingest pipeline: read every markdown article, chunk by heading, embed with
 * the configured provider, and replace kb_chunks. Idempotent — safe to re-run.
 */
async function main() {
  const provider = getEmbeddingProvider();

  const files = (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md")).sort();
  if (files.length === 0) {
    throw new Error(`No markdown articles found in ${ARTICLES_DIR}`);
  }

  const chunks: Chunk[] = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const md = await readFile(path.join(ARTICLES_DIR, file), "utf8");
    chunks.push(...chunkArticle(slug, md));
  }
  console.log(`Parsed ${chunks.length} chunks from ${files.length} articles.`);

  console.log(`Embedding ${chunks.length} chunks with ${provider.model}…`);
  const embeddings = await provider.embed(chunks.map(embeddingText));

  await db.delete(kbChunks);
  await db.insert(kbChunks).values(
    chunks.map((c, i) => ({
      articleSlug: c.articleSlug,
      heading: c.heading,
      content: c.content,
      embedding: embeddings[i],
    })),
  );

  console.log(`✓ Ingested ${chunks.length} chunks into kb_chunks.`);
}

main()
  .catch((err) => {
    console.error("Ingest failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await client.end();
  });
