import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { chunkArticle } from "../rag/chunk";

const ARTICLES_DIR = path.join(process.cwd(), "kb", "articles");

export interface ArticleSection {
  heading: string;
  content: string;
}

export interface Article {
  slug: string;
  title: string;
  sections: ArticleSection[];
}

/** List all help articles (slug + title) for the help-center index. */
export async function listArticles(): Promise<{ slug: string; title: string }[]> {
  const files = (await readdir(ARTICLES_DIR)).filter((f) => f.endsWith(".md")).sort();
  const out: { slug: string; title: string }[] = [];
  for (const file of files) {
    const slug = file.replace(/\.md$/, "");
    const md = await readFile(path.join(ARTICLES_DIR, file), "utf8");
    const chunks = chunkArticle(slug, md);
    out.push({ slug, title: chunks[0]?.title ?? slug });
  }
  return out;
}

/** Read one article by slug, reusing the same chunker the RAG pipeline uses. */
export async function getArticle(slug: string): Promise<Article | null> {
  if (!/^[a-z0-9-]+$/.test(slug)) return null; // guard against path traversal
  let md: string;
  try {
    md = await readFile(path.join(ARTICLES_DIR, `${slug}.md`), "utf8");
  } catch {
    return null;
  }
  const chunks = chunkArticle(slug, md);
  return {
    slug,
    title: chunks[0]?.title ?? slug,
    sections: chunks.map((c) => ({ heading: c.heading, content: c.content })),
  };
}
