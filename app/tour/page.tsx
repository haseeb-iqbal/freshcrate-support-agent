import Link from "next/link";
import { STARTERS, TOUR_FEATURES, promptById } from "@/lib/demo-prompts";
import { CrateCard, CrateFacts } from "../chat/cards/crate";
import { HeaderShell } from "../header-shell";
import { GITHUB_URL, SiteNav } from "../site-nav";

export const metadata = { title: "Guided tour" };

const firstName = (name: string) => name.split(" ")[0];
const tryHref = (id: string) => `/?try=${id}`;

const link = "rounded text-brand underline underline-offset-4 hover:text-brand-dark";

const STEPS = [
  {
    title: "Pick a customer",
    body: "Each sample customer is set up for a different story: active, paused, cancelled, or with a damaged box. Switch any time from Signed in as.",
  },
  {
    title: "Ask in plain words",
    body: "Policy questions are answered from the help center, with the articles linked underneath. Account questions use that customer's live data.",
  },
  {
    title: "Confirm or decline",
    body: "Anything that changes the account shows a card with the exact figures. Click yes to apply it, or say \"actually no\" and nothing happens.",
  },
];

const TURN = ["You send a message", "It calls tools: orders, help center, billing", "It shows a card with exact figures", "You confirm, and the server applies it"];

/** The guided tour: how to test the demo, for a first-time visitor. */
export default function TourPage() {
  return (
    <div className="min-h-screen">
      <HeaderShell
        brand={
          <Link href="/" className="whitespace-nowrap rounded font-display text-[19px] font-extrabold tracking-tight text-brand hover:text-brand-dark sm:text-[21px]">
            FreshCrate support
          </Link>
        }
      >
        <SiteNav current="tour" />
      </HeaderShell>

      <main className="mx-auto max-w-[1280px] px-4 sm:px-6">
        <section className="grid items-center gap-10 py-12 lg:grid-cols-[minmax(0,1fr)_440px] lg:py-20">
          <div>
            <h1 className="max-w-[16ch] font-display text-[40px] font-extrabold leading-[1.02] tracking-[-0.035em] sm:text-5xl lg:text-[60px]">
              A support agent that can do things, but asks you first.
            </h1>
            <p className="mt-5 max-w-[60ch] text-[17px] leading-relaxed text-muted">
              A portfolio project by Haseeb Iqbal. FreshCrate is a made-up meal-kit company. Its assistant answers from a
              help center, looks up orders, and proposes real account changes, like pauses, refunds and plan switches,
              that only happen when you confirm. Everything runs on sample data, so try anything.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="#steps" className="inline-flex min-h-[48px] items-center rounded-[10px] bg-brand px-5 font-bold text-white hover:bg-brand-dark">
                Take the 3-minute tour
              </a>
              <Link href="/" className="inline-flex min-h-[48px] items-center rounded-[10px] border border-[#C9D6CE] bg-white px-5 font-bold text-ink hover:border-brand">
                Go straight to the demo
              </Link>
            </div>
          </div>

          <figure aria-label="Example: the assistant proposing a pause" className="rounded-[18px] border border-mist bg-white p-5 sm:p-6">
            <div className="flex justify-end">
              <p className="max-w-[80%] rounded-2xl rounded-br-[4px] bg-brand px-4 py-2.5 text-[15px] text-white">pause my subscription for 2 weeks</p>
            </div>
            <p className="mt-4 text-[15px] leading-relaxed">Here&apos;s a 2-week pause from next week. Please confirm below to go ahead.</p>
            <CrateCard title="Pause your subscription" state="pending">
              <CrateFacts
                rows={[
                  ["Pauses", "from next week, for 2 weeks"],
                  ["While paused", "$8 a week instead of your plan price"],
                  ["Charged now", "nothing"],
                ]}
              />
              <div aria-hidden className="mt-3.5 flex flex-wrap items-center gap-2.5">
                <span className="inline-flex min-h-[44px] items-center rounded-lg bg-brand px-4 text-[15px] font-bold text-white">Yes, pause it</span>
                <span className="inline-flex min-h-[44px] items-center rounded-lg border border-[#C9D6CE] px-4 text-[15px]">Not now</span>
              </div>
            </CrateCard>
            <figcaption className="mt-4 text-sm text-muted">
              Nothing changes until you click yes.{" "}
              <Link href={tryHref("pause-two-weeks")} className={link}>
                Try this one
              </Link>
            </figcaption>
          </figure>
        </section>

        <section id="steps" aria-labelledby="steps-title" className="scroll-mt-6 border-t border-mist py-14">
          <h2 id="steps-title" className="font-display text-[32px] font-extrabold tracking-tight">
            Test it in 3 steps
          </h2>
          <p className="mt-2 text-muted">No sign-up. Pick a sample customer, ask something, and decide.</p>
          <ol className="mt-8 grid gap-8 md:grid-cols-3">
            {STEPS.map((s, i) => (
              <li key={s.title} className="max-w-[48ch]">
                <span aria-hidden className="flex h-10 w-10 items-center justify-center rounded-full bg-citrus font-display text-lg font-extrabold">
                  {i + 1}
                </span>
                <h3 className="mt-3 font-display text-xl font-bold tracking-tight">{s.title}</h3>
                <p className="mt-1.5 leading-relaxed text-muted">{s.body}</p>
              </li>
            ))}
          </ol>
        </section>

        <section aria-labelledby="try-title" className="border-t border-mist py-14">
          <h2 id="try-title" className="font-display text-[32px] font-extrabold tracking-tight">
            Things to try
          </h2>
          <p className="mt-2 text-muted">Each one opens the demo as the right customer, with the message ready to send.</p>
          <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {STARTERS.map((s) => (
              <li key={s.id} className="flex flex-col rounded-2xl border border-mist bg-white p-5">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-display text-lg font-bold tracking-tight">{s.title}</h3>
                  <span className="whitespace-nowrap text-[13px] text-muted">as {firstName(s.customer)}</span>
                </div>
                <p className="mt-2 font-bold">&ldquo;{s.text}&rdquo;</p>
                <p className="mt-1.5 flex-1 text-[15px] leading-relaxed text-muted">{s.expect}</p>
                <Link href={tryHref(s.id)} className={`${link} mt-4 self-start font-bold`}>
                  Try it
                </Link>
              </li>
            ))}
          </ul>
        </section>

        <section aria-labelledby="features-title" className="border-t border-mist py-14">
          <h2 id="features-title" className="font-display text-[32px] font-extrabold tracking-tight">
            What it can do
          </h2>
          <p className="mt-2 max-w-[70ch] text-muted">
            Everything below works in the demo. Policies come from the help center, and anything that changes an account
            asks you first.
          </p>
          <ul className="mt-8 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-4">
            {TOUR_FEATURES.map((f) => {
              const p = promptById(f.promptId);
              return (
                <li key={f.title} className="border-t-2 border-ink pt-4">
                  <h3 className="font-display text-lg font-bold tracking-tight">{f.title}</h3>
                  <p className="mt-1.5 text-[15px] leading-relaxed text-muted">{f.body}</p>
                  {p && (
                    <p className="mt-3 text-[15px]">
                      Try:{" "}
                      <Link href={tryHref(p.id)} className={link}>
                        &ldquo;{p.text}&rdquo;
                      </Link>
                    </p>
                  )}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="hood-title" className="grid gap-10 border-t border-mist py-14 lg:grid-cols-2">
          <div>
            <h2 id="hood-title" className="font-display text-[32px] font-extrabold tracking-tight">
              Under the hood
            </h2>
            <p className="mt-2 max-w-[60ch] leading-relaxed text-muted">
              The model never changes an account by itself. It calls tools, the server re-checks every figure, and the
              card is the only way a change happens.
            </p>
            <ol aria-label="How a chat turn works" className="mt-6 space-y-3">
              {TURN.map((t, i) => (
                <li key={t} className="flex items-center gap-3">
                  <span aria-hidden className="flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 border-brand text-sm font-bold text-brand">
                    {i + 1}
                  </span>
                  <span>{t}</span>
                </li>
              ))}
            </ol>
          </div>
          <dl className="grid gap-px self-start overflow-hidden rounded-2xl border border-mist bg-mist sm:grid-cols-2">
            <Stat label="Required test conversations passing" value="91 of 92" note="Run against the real model" />
            <Stat label="Cost per chat turn" value="about $0.0016" />
            <Stat label="Model" value="gpt-4o-mini" />
            <div className="bg-white p-5">
              <dt className="text-sm text-muted">Live cost and latency</dt>
              <dd className="mt-1.5">
                <Link href="/dashboard" className={`${link} font-bold`}>
                  Open the dashboard
                </Link>
              </dd>
            </div>
          </dl>
        </section>
      </main>

      <footer className="border-t border-mist">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-6 text-sm text-muted sm:px-6">
          <p>Built by Haseeb Iqbal with Next.js, Postgres and pgvector, and OpenAI.</p>
          <p className="flex gap-5">
            <a href={GITHUB_URL} target="_blank" rel="noopener noreferrer" className={link}>
              GitHub
            </a>
            <Link href="/kb" className={link}>
              Help center
            </Link>
          </p>
        </div>
      </footer>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note?: string }) {
  return (
    <div className="bg-white p-5">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-[28px] font-extrabold tracking-tight">{value}</dd>
      {note && <dd className="text-[13px] text-muted">{note}</dd>}
    </div>
  );
}
