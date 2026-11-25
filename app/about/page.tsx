import Link from "next/link";
import { STARTERS, TOUR_FEATURES, promptById } from "@/lib/demo-prompts";
import { HeaderShell } from "../header-shell";
import { AboutTabs } from "./tabs";
import { GITHUB_URL, SiteNav } from "../site-nav";

export const metadata = { title: "About" };

const firstName = (name: string) => name.split(" ")[0];
const tryHref = (id: string) => `/?try=${id}`;

const link = "rounded text-brand underline underline-offset-4 hover:text-brand-dark";

const STEPS = [
  { title: "Pick a customer", body: "Each sample customer has a different story, from active to cancelled." },
  { title: "Ask in plain words", body: "Policy answers cite the help center; account answers use live data." },
  { title: "Confirm or say no", body: "Changes show a card with exact figures and wait for your click." },
];

const LIMITATIONS = [
  "gpt-4o-mini isn't fully consistent: a few test conversations fail now and then in a full run.",
  "Everyone shares one sample database, and confirmed changes stay until it is reseeded.",
  "There's no real login and no real money, and hand-offs to a person are simulated.",
  "Chat is capped at 30 messages an hour per visitor and 1,500 a day overall, to protect the model budget.",
];

const TURN = ["You send a message", "It calls tools: orders, help center, billing", "It shows a card with exact figures", "You confirm, and the server applies it"];

/** About the demo, with a short tour of how to test it, for a first-time visitor. */
export default function AboutPage() {
  return (
    <div className="min-h-screen">
      <HeaderShell
        brand={
          <Link href="/about" title="About this demo" className="whitespace-nowrap rounded font-display text-[17px] font-extrabold tracking-tight text-brand hover:text-brand-dark sm:text-[18px]">
            FreshCrate support
          </Link>
        }
      >
        <SiteNav current="about" />
      </HeaderShell>

      <main className="mx-auto max-w-[1280px] px-4 sm:px-6">
        <section className="max-w-[70ch] py-5 lg:py-6">
          <h1 className="font-display text-[22px] font-extrabold leading-[1.1] tracking-[-0.02em] lg:text-[26px]">
            FreshCrate Support Agent
          </h1>
          <p className="mt-1 font-display text-[15px] font-bold tracking-tight text-brand">
            An agent for all your meal-kit needs
          </p>
          <p className="mt-2 leading-[1.45] text-muted">
            A portfolio project by Haseeb Iqbal: a support chat for a made-up meal-kit company that answers questions and
            changes accounts only when you confirm. Everything is sample data, so try anything.
          </p>
          <Link href="/" className="btn btn-primary mt-4">
            Open the chat
          </Link>
        </section>

        <AboutTabs
          tabs={[
            {
              id: "try",
              label: "Try it",
              content: (
                <>
                  <section aria-labelledby="steps-title">
                    <h2 id="steps-title" className="font-display text-[19px] font-extrabold tracking-tight">
                      Test it in 3 steps
                    </h2>
                    <ol className="mt-4 grid gap-4 md:grid-cols-3 md:gap-0">
                      {STEPS.map((s, i) => (
                        <li key={s.title} className="relative flex gap-3 md:block md:pr-6">
                          {i < STEPS.length - 1 && (
                            <span
                              aria-hidden
                              className="absolute left-[11px] top-7 h-[calc(100%-12px)] w-px bg-mist md:left-7 md:right-0 md:top-[11px] md:h-px md:w-auto"
                            />
                          )}
                          <span
                            aria-hidden
                            className="relative flex h-6 w-6 flex-none items-center justify-center rounded-full border-2 border-brand bg-paper text-[12px] font-bold text-brand"
                          >
                            {i + 1}
                          </span>
                          <div className="md:mt-2">
                            <h3 className="text-sm font-bold">{s.title}</h3>
                            <p className="mt-0.5 max-w-[40ch] text-sm leading-[1.45] text-muted">{s.body}</p>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </section>
                  <section aria-labelledby="things-title" className="mt-8">
                    <h2 id="things-title" className="font-display text-[19px] font-extrabold tracking-tight">
                      Things to try
                    </h2>
                    <p className="mt-1 text-muted">Each one opens the demo as the right customer, with the message ready to send.</p>
                    <ul className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                      {STARTERS.map((s) => (
                        <li key={s.id} className="flex flex-col rounded-2xl border border-mist bg-white p-4">
                          <div className="flex items-baseline justify-between gap-3">
                            <h3 className="font-display text-[15px] font-bold tracking-tight">{s.title}</h3>
                            <span className="whitespace-nowrap text-[13px] text-muted">as {firstName(s.customer)}</span>
                          </div>
                          <p className="mt-2 font-bold">&ldquo;{s.text}&rdquo;</p>
                          <p className="mt-1.5 flex-1 text-[15px] leading-[1.45] text-muted">{s.expect}</p>
                          <Link href={tryHref(s.id)} className={`${link} mt-3 self-start text-[13px] font-bold`}>
                            Try it
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </section>
                </>
              ),
            },
            {
              id: "features",
              label: "What it does",
              content: (
                <>
                  <p className="max-w-[70ch] text-muted">
                    Everything here works in the demo. Policies come from the help center, and anything that changes an
                    account asks you first.
                  </p>
                  <ul className="mt-4 grid gap-x-6 gap-y-5 sm:grid-cols-2 lg:grid-cols-4">
                    {TOUR_FEATURES.map((f) => {
                      const p = promptById(f.promptId);
                      return (
                        <li key={f.title} className="border-t-2 border-ink pt-3">
                          <h3 className="font-display text-[15px] font-bold tracking-tight">{f.title}</h3>
                          <p className="mt-1 text-[15px] leading-[1.45] text-muted">{f.body}</p>
                          {p && (
                            <p className="mt-2 text-[15px]">
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
                </>
              ),
            },
            {
              id: "built",
              label: "How it's built",
              content: (
                <div className="grid gap-8 lg:grid-cols-2">
                  <div>
                    <p className="max-w-[60ch] leading-[1.45] text-muted">
                      The model never changes an account by itself. It calls tools, the server re-checks every figure,
                      and the card is the only way a change happens.
                    </p>
                    <ol aria-label="How a chat turn works" className="mt-4 space-y-2.5">
                      {TURN.map((t, i) => (
                        <li key={t} className="flex items-center gap-3">
                          <span aria-hidden className="flex h-7 w-7 flex-none items-center justify-center rounded-full border-2 border-brand text-sm font-bold text-brand">
                            {i + 1}
                          </span>
                          <span>{t}</span>
                        </li>
                      ))}
                    </ol>
                    <h2 className="mt-6 font-display text-[19px] font-extrabold tracking-tight">Limitations</h2>
                    <ul className="mt-2 list-disc space-y-1.5 pl-5 leading-[1.45] text-muted">
                      {LIMITATIONS.map((l) => (
                        <li key={l}>{l}</li>
                      ))}
                    </ul>
                  </div>
                  <dl className="grid gap-px self-start overflow-hidden rounded-2xl border border-mist bg-mist sm:grid-cols-2">
                    <Stat label="Required test conversations passing" value="91 of 92" note="Run against the real model" />
                    <Stat label="Cost per chat turn" value="about $0.0016" />
                    <Stat label="Model" value="gpt-4o-mini" />
                    <div className="bg-white p-4">
                      <dt className="text-sm text-muted">Live cost and latency</dt>
                      <dd className="mt-1.5">
                        <Link href="/dashboard" className={`${link} font-bold`}>
                          Open the dashboard
                        </Link>
                      </dd>
                    </div>
                  </dl>
                </div>
              ),
            },
          ]}
        />
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
    <div className="bg-white p-4">
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-1 font-display text-[18px] font-extrabold tracking-tight">{value}</dd>
      {note && <dd className="text-[13px] text-muted">{note}</dd>}
    </div>
  );
}
