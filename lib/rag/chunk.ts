import type { Chunk } from "./types";

/**
 * Split a markdown article into one chunk per H2 section.
 *
 * The H1 is treated as the article title (carried on each chunk to enrich the
 * embedding, not stored). Each `## Heading` starts a new chunk whose `heading`
 * is the citation section. Any text between the H1 and the first H2 becomes an
 * "Overview" chunk.
 */
export function chunkArticle(slug: string, markdown: string): Chunk[] {
  const lines = markdown.split(/\r?\n/);
  let title = slug;
  let currentHeading: string | null = null;
  let buffer: string[] = [];
  const chunks: Chunk[] = [];

  const flush = () => {
    const content = buffer.join("\n").trim();
    buffer = [];
    if (!content) return;
    chunks.push({
      articleSlug: slug,
      heading: currentHeading ?? "Overview",
      content,
      title,
    });
  };

  for (const line of lines) {
    const h1 = line.match(/^#\s+(.+)$/);
    const h2 = line.match(/^##\s+(.+)$/);
    if (h1) {
      title = h1[1].trim();
      continue;
    }
    if (h2) {
      flush();
      currentHeading = h2[1].trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return chunks;
}

/** The text actually sent to the embedding model: title + heading give context. */
export function embeddingText(chunk: Chunk): string {
  const title = chunk.title ?? chunk.articleSlug;
  return `${title} > ${chunk.heading}\n${chunk.content}`;
}
