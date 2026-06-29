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
            {s.content.split(/\n\n+/).map((para, i) => (
              <p key={i} className="mt-2 text-sm leading-relaxed text-slate-700">
                {renderInline(para)}
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
