import Link from "next/link";
import { listArticles } from "@/lib/kb/articles";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export default async function HelpCenterIndex() {
  const articles = await listArticles();
  return (
    <main className="mx-auto max-w-2xl px-6 py-10">
      <Link href="/" className="text-sm text-brand hover:underline">
        ← Back to chat
      </Link>
      <h1 className="mt-4 text-2xl font-bold text-slate-900">FreshCrate Help Center</h1>
      <p className="mt-1 text-sm text-slate-500">
        The reference articles the assistant grounds its answers in. {articles.length} articles.
      </p>
      <ul className="mt-6 divide-y divide-slate-100 overflow-hidden rounded-lg border border-slate-200 bg-white">
        {articles.map((a) => (
          <li key={a.slug}>
            <Link
              href={`/kb/${a.slug}`}
              className="flex items-center justify-between px-4 py-3 text-sm hover:bg-slate-50"
            >
              <span className="font-medium text-slate-800">{a.title}</span>
              <span className="text-xs text-slate-400">{a.slug}</span>
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}
