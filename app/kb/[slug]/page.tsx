import Link from "next/link";
import { notFound } from "next/navigation";
import { getArticle } from "@/lib/kb/articles";
import { InlineMarkdown } from "@/app/markdown";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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
            {s.content.split(/\n\n+/).map((para, i) => (
              <p key={i} className="mt-2 text-sm leading-relaxed text-slate-700">
                <InlineMarkdown text={para} />
              </p>
            ))}
          </section>
        ))}
      </div>
    </main>
  );
}
