import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getArticle } from "@/lib/kb/articles";
import { InlineMarkdown } from "@/app/markdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: { slug: string } }): Promise<Metadata> {
  const article = await getArticle(params.slug);
  // A missing article still renders notFound() in the page body; the title just
  // needs a sensible fallback for the moment before that happens.
  return { title: article?.title ?? "Help Center" };
}

/** Cells of a markdown table row, without the leading and trailing pipes. */
function rowCells(row: string): string[] {
  return row.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
}

/**
 * Render one blank-line-separated block of an article section.
 *
 * Blocks were previously all rendered as paragraphs, which collapsed the single
 * newlines inside a markdown table or bullet list into spaces - a price table
 * came out as one run-on line of pipes. Tables and lists are structural, so they
 * get real elements; everything else stays a paragraph.
 */
function Block({ text }: { text: string }) {
  const lines = text.split("\n").filter((l) => l.trim() !== "");
  if (lines.length === 0) return null;

  // A table needs a header row and a separator row before any body rows.
  if (lines.length >= 2 && lines.every((l) => l.trimStart().startsWith("|"))) {
    const [header, , ...body] = lines;
    return (
      <div className="mt-2 overflow-x-auto">
        <table className="w-full border-collapse text-left text-sm">
          <thead>
            <tr>
              {rowCells(header).map((cell, i) => (
                <th key={i} className="border-b border-slate-300 px-2 py-1 text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <InlineMarkdown text={cell} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {rowCells(row).map((cell, i) => (
                  <td key={i} className="border-b border-slate-100 px-2 py-1 align-top text-slate-700">
                    <InlineMarkdown text={cell} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  if (lines.every((l) => /^\s*-\s+/.test(l))) {
    return (
      <ul className="mt-2 list-disc space-y-1 pl-5 text-sm leading-relaxed text-slate-700">
        {lines.map((l, i) => (
          <li key={i}><InlineMarkdown text={l.replace(/^\s*-\s+/, "")} /></li>
        ))}
      </ul>
    );
  }

  return <p className="mt-2 text-sm leading-relaxed text-slate-700"><InlineMarkdown text={text} /></p>;
}

export default async function ArticlePage({ params }: { params: { slug: string } }) {
  const article = await getArticle(params.slug);
  if (!article) notFound();

  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/kb" className="text-sm text-brand hover:underline">
        ← All help articles
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">{article.title}</h1>

      <div className="mt-6 space-y-6">
        {article.sections.map((s) => (
          <section key={s.heading}>
            <h2 className="text-base font-semibold text-brand">{s.heading}</h2>
            {s.content.split(/\n\n+/).map((block, i) => (
              <Block key={i} text={block} />
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
