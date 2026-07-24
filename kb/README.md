# kb — knowledge base & ingest

Markdown help articles plus the ingest pipeline (chunk → embed → load into pgvector).

- `articles/*.md` — 14 help articles (one H1 title, `##` sections). Each `##`
  section becomes one `kb_chunks` row; `article_slug` (filename) + `heading`
  are the citation source.
- `ingest.ts` — parse → chunk → embed (`text-embedding-3-small`) → replace
  `kb_chunks`. Run with `npm run kb:ingest` (needs `OPENAI_API_KEY` + a pushed DB).

Retrieval + MMR rerank live in [`lib/rag`](../lib/rag). Verify with
`npm run kb:test`.
