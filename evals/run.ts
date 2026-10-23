import "dotenv/config";
import { spawnSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import type { NextRequest } from "next/server";
import { eq } from "drizzle-orm";
import { client, db } from "@/db";
import { customers } from "@/db/schema";
import { POST as chatPOST } from "@/app/api/chat/route";
import { POST as refundPOST } from "@/app/api/actions/refund/route";
import { POST as pausePOST } from "@/app/api/actions/pause/route";
import { POST as resumePOST } from "@/app/api/actions/resume/route";
import { POST as reactivatePOST } from "@/app/api/actions/reactivate/route";
import { POST as changePlanPOST } from "@/app/api/actions/change-plan/route";
import { POST as cancelPOST } from "@/app/api/actions/cancel/route";
import { POST as dietPOST } from "@/app/api/actions/dietary-track/route";
import { CASES as BASE_CASES } from "./cases";
import { GAP_CASES } from "./cases-gaps";
import { excerptsFor, judge } from "./judge";
import type { ConfirmStep, CustomerKey, EvalCase, Expect, SayStep } from "./types";

/**
 * Real-model eval runner: `npm run eval`.
 *
 * Seeds the DB, then plays each case through the same POST /api/chat handler
 * the browser calls, collecting its SSE events, and rule-checks every turn.
 * Card confirmations go through the same /api/actions/* handlers as the
 * chat client's Confirm button. Writes evals/report.md and exits non-zero when
 * any case not marked knownFailing fails.
 */

const CASES = [...BASE_CASES, ...GAP_CASES];

const CUSTOMER_IDS: Record<CustomerKey, string> = {
  ava: "11111111-1111-1111-1111-111111110001",
  marcus: "11111111-1111-1111-1111-111111110002",
  priya: "11111111-1111-1111-1111-111111110003",
  diego: "11111111-1111-1111-1111-111111110004",
  lena: "11111111-1111-1111-1111-111111110005",
  tom: "11111111-1111-1111-1111-111111110006",
  sara: "11111111-1111-1111-1111-111111110007",
  noah: "11111111-1111-1111-1111-111111110008",
  mia: "11111111-1111-1111-1111-111111110009",
  jamal: "11111111-1111-1111-1111-111111110010",
};

/** gpt-4o-mini list prices, USD per 1M tokens. */
const PRICE_PER_M = { input: 0.15, output: 0.6 };
/** A full run should cost well under this; past it the remaining cases are skipped. */
const BUDGET_USD = 0.25;
/** Claims an action happened before the customer confirmed anything. */
const GLOBAL_BANNED: RegExp[] = [/\bI(?:'ve| have) initiated\b/i];

/** Event name -> decision kind, as lib/decisions.ts names them. */
const DECISION_KIND: Record<string, string> = {
  refund_proposal: "refund",
  pause_proposal: "pause",
  resume_proposal: "resume",
  reactivate_proposal: "reactivate",
  plan_change_proposal: "plan_change",
  cancel_proposal: "cancel",
  diet_change_proposal: "dietary_track",
};

type Handler = (req: NextRequest) => Promise<Response>;
type Data = Record<string, unknown>;

/**
 * What the chat client's Confirm button posts for each card kind - the same
 * endpoints and bodies as app/chat/proposals.ts (which can't be imported here:
 * it pulls in the React cards).
 */
const CONFIRM: Record<string, { handler: Handler; body: (p: Data) => Data }> = {
  refund_proposal: { handler: refundPOST, body: (p) => ({ orderNumber: p.order_number, reason: p.reason }) },
  pause_proposal: { handler: pausePOST, body: (p) => ({ weeks: p.weeks, resumeDate: p.resume_date, indefinite: p.indefinite }) },
  resume_proposal: { handler: resumePOST, body: (p) => ({ newPlan: p.plan_changed ? p.plan : undefined }) },
  reactivate_proposal: { handler: reactivatePOST, body: (p) => ({ newPlan: p.plan_changed ? p.plan : undefined }) },
  plan_change_proposal: { handler: changePlanPOST, body: (p) => ({ plan: p.plan }) },
  cancel_proposal: { handler: cancelPOST, body: () => ({}) },
  diet_change_proposal: { handler: dietPOST, body: (p) => ({ track: p.new_track }) },
};

interface Card {
  event: string;
  data: Record<string, unknown>;
  state: "pending" | "approved" | "locked" | "error";
}

interface TurnResult {
  text: string;
  events: { event: string; data: unknown }[];
  tools: { name: string; args: Record<string, unknown> }[];
  cards: { event: string; data: Record<string, unknown> }[];
  sources: { slug: string; heading: string }[];
  promptTokens: number;
  completionTokens: number;
  ms: number;
}

interface CaseResult {
  c: EvalCase;
  failures: string[];
  /** Judge verdicts, one per judged turn. Reported, never gating. */
  judged: { pass: boolean; reason: string }[];
  transcript: string[];
  promptTokens: number;
  completionTokens: number;
  ms: number;
}

const usd = (prompt: number, completion: number) => (prompt * PRICE_PER_M.input + completion * PRICE_PER_M.output) / 1_000_000;

function seed() {
  const r = spawnSync("npm run db:seed", { shell: true, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`db:seed failed:\n${r.stdout}\n${r.stderr}`);
}

/** One chat turn through the real route handler, SSE parsed as app/chat.tsx does. */
async function chatTurn(customerId: string, messages: { role: "user" | "assistant"; content: string }[], cards: Card[]): Promise<TurnResult> {
  const decisions = cards.map((c) => ({
    kind: DECISION_KIND[c.event],
    outcome: c.state === "approved" ? "confirmed" : c.state === "locked" ? "declined" : c.state === "error" ? "failed" : "awaiting_response",
    ...(c.event === "refund_proposal" ? { orderNumber: c.data.order_number } : {}),
  }));
  const started = Date.now();
  const res = await chatPOST(
    new Request("http://eval/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, messages, decisions }),
    }) as unknown as NextRequest,
  );
  if (!res.ok || !res.body) throw new Error(`chat returned ${res.status}: ${await res.text()}`);
  const raw = await res.text();

  const out: TurnResult = { text: "", events: [], tools: [], cards: [], sources: [], promptTokens: 0, completionTokens: 0, ms: 0 };
  for (const block of raw.split("\n\n")) {
    const event = block.match(/^event: (.*)$/m)?.[1];
    const line = block.match(/^data: (.*)$/m)?.[1];
    if (!event || line === undefined) continue;
    const data = JSON.parse(line) as unknown;
    if (event === "delta") out.text += data as string;
    else if (event === "reset") out.text = "";
    else {
      out.events.push({ event, data });
      if (event === "tool_call") out.tools.push(data as TurnResult["tools"][number]);
      if (DECISION_KIND[event]) out.cards.push({ event, data: data as Record<string, unknown> });
      if (event === "sources") out.sources.push(...(data as TurnResult["sources"]));
      if (event === "usage") {
        const u = data as { promptTokens: number; completionTokens: number };
        out.promptTokens += u.promptTokens;
        out.completionTokens += u.completionTokens;
      }
    }
  }
  out.ms = Date.now() - started;
  return out;
}

/** The chat client's Confirm button: the same action handler, the same body. */
async function confirm(customerId: string, card: Card): Promise<boolean> {
  const route = CONFIRM[card.event];
  if (!route) throw new Error(`No confirm route for ${card.event}`);
  const res = await route.handler(
    new Request("http://eval/api/actions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ customerId, ...route.body(card.data) }),
    }) as unknown as NextRequest,
  );
  const json = (await res.json().catch(() => ({}))) as { ok?: boolean };
  return res.ok && !!json.ok;
}

/** Customer columns that differ from what the confirm step expects. */
async function dbMismatches(customerId: string, want: Data): Promise<string[]> {
  const [row] = (await db.select().from(customers).where(eq(customers.id, customerId)).limit(1)) as Data[];
  return Object.entries(want)
    .filter(([k, v]) => JSON.stringify(row?.[k]) !== JSON.stringify(v))
    .map(([k, v]) => `after confirm, ${k} is ${JSON.stringify(row?.[k])}, expected ${JSON.stringify(v)}`);
}

const matches = (data: unknown, where: Record<string, unknown> = {}) =>
  Object.entries(where).every(([k, v]) => JSON.stringify((data as Record<string, unknown> | null)?.[k]) === JSON.stringify(v));

const hasText = (text: string, p: string | RegExp) => (typeof p === "string" ? text.toLowerCase().includes(p.toLowerCase()) : p.test(text));

/** Every way this turn breaks its expectations, as readable lines. */
function check(t: TurnResult, e: Expect = {}): string[] {
  const f: string[] = [];
  const called = t.tools.map((x) => x.name);
  for (const name of e.tools ?? []) if (!called.includes(name)) f.push(`expected tool ${name}, called [${called.join(", ")}]`);
  for (const name of e.noTools ?? []) if (called.includes(name)) f.push(`must not call ${name}`);
  if (e.noToolsAtAll && called.length) f.push(`expected no tools, called [${called.join(", ")}]`);
  for (const want of e.cards ?? []) {
    if (!t.cards.some((c) => c.event === want.event && matches(c.data, want.where))) {
      const got = t.cards.map((c) => `${c.event} ${JSON.stringify(c.data)}`).join("; ") || "none";
      f.push(`expected card ${want.event} ${JSON.stringify(want.where ?? {})}, got ${got}`);
    }
  }
  if (e.noCards && t.cards.length) f.push(`expected no card, got ${t.cards.map((c) => c.event).join(", ")}`);
  for (const ev of e.noCardEvents ?? []) if (t.cards.some((c) => c.event === ev)) f.push(`must not show ${ev}`);
  if (e.multi) {
    const shown = e.multi.filter((ev) => t.cards.some((c) => c.event === ev));
    const ok = shown.length === e.multi.length || (shown.length > 0 && t.text.includes("?"));
    if (!ok) f.push(`expected cards ${e.multi.join(" + ")} (or one plus a question), got ${t.cards.map((c) => c.event).join(", ") || "none"}`);
  }
  if (e.asks && !t.text.includes("?")) f.push("expected the reply to ask the customer something");
  for (const want of e.events ?? []) {
    if (!t.events.some((x) => x.event === want.event && matches(x.data, want.where))) f.push(`expected event ${want.event} ${JSON.stringify(want.where ?? {})}`);
  }
  if (e.noToolCall && t.tools.some((x) => x.name === e.noToolCall!.name && matches(x.args, e.noToolCall!.args))) {
    f.push(`must not call ${e.noToolCall.name} with ${JSON.stringify(e.noToolCall.args)}`);
  }
  for (const fact of e.facts ?? []) if (!hasText(t.text, fact)) f.push(`reply is missing ${fact}`);
  for (const p of [...GLOBAL_BANNED, ...(e.banned ?? [])]) if (hasText(t.text, p)) f.push(`reply contains banned ${p}`);
  if (!t.text.trim()) f.push("empty reply");
  const done = t.events.find((x) => x.event === "done")?.data as { truncated?: boolean; timedOut?: boolean } | undefined;
  if (!done) f.push("turn never finished");
  if (done?.truncated) f.push("hit the iteration cap");
  if (done?.timedOut) f.push("timed out");
  if (t.events.some((x) => x.event === "error")) f.push(`error event: ${JSON.stringify(t.events.find((x) => x.event === "error")!.data)}`);
  return f;
}

async function runCase(c: EvalCase, useJudge: boolean): Promise<CaseResult> {
  const id = CUSTOMER_IDS[c.customer];
  const r: CaseResult = { c, failures: [], judged: [], transcript: [], promptTokens: 0, completionTokens: 0, ms: 0 };
  const history: { role: "user" | "assistant"; content: string }[] = [];
  const cards: Card[] = [];

  for (const [i, step] of c.steps.entries()) {
    if ("confirm" in step) {
      const card = [...cards].reverse().find((x) => x.event === (step as ConfirmStep).confirm && x.state === "pending");
      if (!card) {
        r.failures.push(`step ${i + 1}: no pending ${step.confirm} to confirm`);
        break;
      }
      card.state = (await confirm(id, card)) ? "approved" : "error";
      r.transcript.push(`[confirm ${step.confirm}: ${card.state}]`);
      if (card.state === "error") r.failures.push(`step ${i + 1}: confirming ${step.confirm} failed`);
      else if (step.db) for (const m of await dbMismatches(id, step.db)) r.failures.push(`step ${i + 1}: ${m}`);
      continue;
    }
    // Typing a new message locks any card still waiting, as the chat client does.
    for (const x of cards) if (x.state === "pending") x.state = "locked";
    history.push({ role: "user", content: (step as SayStep).say });
    let t: TurnResult;
    try {
      t = await chatTurn(id, history, cards);
    } catch (err) {
      r.failures.push(`step ${i + 1}: ${err instanceof Error ? err.message : String(err)}`);
      break;
    }
    history.push({ role: "assistant", content: t.text });
    for (const x of t.cards) cards.push({ ...x, state: "pending" });
    r.promptTokens += t.promptTokens;
    r.completionTokens += t.completionTokens;
    r.ms += t.ms;
    r.transcript.push(`> ${step.say}`, `  tools: ${t.tools.map((x) => x.name).join(", ") || "none"} | cards: ${t.cards.map((x) => x.event).join(", ") || "none"}`, `  ${t.text.replace(/\s+/g, " ").trim()}`);
    const expect = (step as SayStep).expect;
    for (const f of check(t, expect)) r.failures.push(`turn ${i + 1}: ${f}`);
    if (expect?.judge && useJudge) {
      const v = await judge(expect.judge, (step as SayStep).say, t.text, await excerptsFor(t.sources));
      r.judged.push({ pass: v.pass, reason: v.reason });
      r.promptTokens += v.promptTokens;
      r.completionTokens += v.completionTokens;
      r.transcript.push(`  judge: ${v.pass ? "pass" : "FAIL"} - ${v.reason}`);
    }
  }
  return r;
}

function verdict(r: CaseResult): "PASS" | "FAIL" | "XFAIL" | "XPASS" {
  const failed = r.failures.length > 0;
  if (r.c.knownFailing) return failed ? "XFAIL" : "XPASS";
  return failed ? "FAIL" : "PASS";
}

async function main() {
  // `--smoke` runs the quick set; any other argument keeps cases whose id contains it.
  const args = process.argv.slice(2);
  const smoke = args.includes("--smoke");
  const only = args.find((a) => !a.startsWith("--"));
  const cases = CASES.filter((c) => (!smoke || c.smoke) && (!only || c.id.includes(only)));
  if (cases.length === 0) throw new Error(`No cases match${smoke ? " --smoke" : ""}${only ? ` "${only}"` : ""}`);

  const [{ kb }] = await client<{ kb: number }[]>`select count(*)::int as kb from kb_chunks`;
  if (kb === 0) throw new Error("kb_chunks is empty - run `npm run kb:ingest` first");

  const results: CaseResult[] = [];
  const skipped: EvalCase[] = [];
  let dirty = true; // seed before the first case
  for (const c of cases) {
    const spent = usd(
      results.reduce((s, r) => s + r.promptTokens, 0),
      results.reduce((s, r) => s + r.completionTokens, 0),
    );
    if (spent > BUDGET_USD) {
      skipped.push(c);
      continue;
    }
    // Confirmed actions write to the DB, so the next case starts from a clean seed.
    if (dirty) seed();
    dirty = c.steps.some((s) => "confirm" in s);
    const r = await runCase(c, !smoke); // the smoke set skips the judge to stay cheap
    results.push(r);
    const lines = [...r.failures, ...r.judged.filter((j) => !j.pass).map((j) => `judge: ${j.reason}`)];
    console.log(`${verdict(r).padEnd(5)} ${c.id}${lines.length ? `\n      ${lines.join("\n      ")}` : ""}`);
  }
  if (dirty) seed(); // leave the demo DB as seeded

  const count = (v: string) => results.filter((r) => verdict(r) === v).length;
  const prompt = results.reduce((s, r) => s + r.promptTokens, 0);
  const completion = results.reduce((s, r) => s + r.completionTokens, 0);
  const gating = results.filter((r) => !r.c.knownFailing).length;
  const judged = results.flatMap((r) => r.judged);
  const summary = [
    `Passed ${count("PASS")}/${gating} gating cases` +
      ` | known failing: ${count("XFAIL")} still failing, ${count("XPASS")} now passing` +
      (skipped.length ? ` | ${skipped.length} skipped (over the $${BUDGET_USD} budget)` : ""),
    `LLM judge (non-gating): ${judged.filter((j) => j.pass).length}/${judged.length} passed`,
    `Tokens: ${prompt.toLocaleString()} in, ${completion.toLocaleString()} out | est. cost $${usd(prompt, completion).toFixed(4)} (gpt-4o-mini list prices; KB embeddings add well under $0.001)`,
  ];
  console.log(`\n${summary.join("\n")}`);

  const md = [
    "# Eval report",
    "",
    `Run ${new Date().toISOString()} with \`npm run eval\`.`,
    "",
    ...summary.map((s) => `- ${s}`),
    "",
    "| Result | Case | Turns | Tokens | Failures | Judge |",
    "| --- | --- | --- | --- | --- | --- |",
    ...results.map(
      (r) =>
        `| ${verdict(r)} | ${r.c.id} | ${r.c.steps.filter((s) => "say" in s).length} | ${(r.promptTokens + r.completionTokens).toLocaleString()} | ${r.failures.join("<br>").replace(/\|/g, "\\|") || "-"} | ${r.judged.map((j) => `${j.pass ? "pass" : "FAIL"}: ${j.reason}`).join("<br>").replace(/\|/g, "\\|") || "-"} |`,
    ),
    ...skipped.map((c) => `| SKIP | ${c.id} | - | - | over budget | - |`),
    "",
    "## Transcripts",
    "",
    ...results.flatMap((r) => [`### ${r.c.id} (${verdict(r)})`, ...(r.c.note ? [`_${r.c.note}_`, ""] : []), "```", ...r.transcript, "```", ""]),
  ];
  writeFileSync(new URL("./report.md", import.meta.url), md.join("\n"));

  await client.end();
  if (count("FAIL") > 0 || skipped.length > 0) process.exitCode = 1;
}

main().catch(async (err) => {
  console.error(err);
  await client.end().catch(() => {});
  process.exitCode = 1;
});
