import Link from "next/link";

export const GITHUB_URL = "https://github.com/haseeb-iqbal/freshcrate-support-agent";

/** The page links shared by the home page and /tour headers. */
export function SiteNav({ current }: { current: "home" | "tour" }) {
  const link = "rounded text-brand underline-offset-4 hover:text-brand-dark hover:underline";
  return (
    <nav aria-label="Main" className="flex flex-wrap items-center gap-x-5 gap-y-1 text-[15px]">
      {current === "home" ? (
        <Link href="/tour" className={link}>
          Guided tour
        </Link>
      ) : (
        <Link href="/" className={link}>
          Try the demo
        </Link>
      )}
      <Link href="/kb" className={link}>
        Help center
      </Link>
      <Link href="/dashboard" className={link}>
        Dashboard
      </Link>
      <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={link}>
        GitHub
      </a>
    </nav>
  );
}
