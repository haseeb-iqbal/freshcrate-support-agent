import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticle } from "@/lib/kb/articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Render inline **bold** spans; the articles use no other inline markdown. */
function renderInline(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) =>
    part.startsWith("**") && part.endsWith("**") ? (
      <strong key={i} className="font-semibold text-slate-900">
        {part.slice(2, -2)}
      </strong>
    ) : (
      <span key={i}>{part}</span>
    ),
  );
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
                  {renderInline(cell)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {body.map((row, r) => (
              <tr key={r}>
                {rowCells(row).map((cell, i) => (
                  <td key={i} className="border-b border-slate-100 px-2 py-1 align-top text-slate-700">
                    {renderInline(cell)}
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
          <li key={i}>{renderInline(l.replace(/^\s*-\s+/, ""))}</li>
        ))}
      </ul>
    );
  }

  return <p className="mt-2 text-sm leading-relaxed text-slate-700">{renderInline(text)}</p>;
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
      <p className="mt-1 text-xs text-slate-400">Source: {article.slug}</p>

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
