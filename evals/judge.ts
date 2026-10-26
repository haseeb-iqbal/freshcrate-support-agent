import OpenAI from "openai";
import { and, eq, or } from "drizzle-orm";
import { db } from "@/db";
import { kbChunks } from "@/db/schema";

export interface JudgeVerdict {
  pass: boolean;
  reason: string;
  promptTokens: number;
  completionTokens: number;
}

const MODEL = "gpt-4o-mini";
let client: OpenAI | null = null;

/** The text of the KB sections a turn cited, as its `sources` event named them. */
export async function excerptsFor(sources: { slug: string; heading: string }[]): Promise<string> {
  if (sources.length === 0) return "(no excerpts were retrieved this turn)";
  const rows = await db
    .select({ slug: kbChunks.articleSlug, heading: kbChunks.heading, content: kbChunks.content })
    .from(kbChunks)
    .where(or(...sources.map((s) => and(eq(kbChunks.articleSlug, s.slug), eq(kbChunks.heading, s.heading)))));
  return rows.map((r) => `[${r.slug} / ${r.heading}]\n${r.content}`).join("\n\n");
}

/** Score one reply against a rubric, given what the customer asked and the excerpts cited. */
export async function judge(rubric: string, question: string, reply: string, excerpts: string): Promise<JudgeVerdict> {
  client ??= new OpenAI();
  const res = await client.chat.completions.create({
    model: MODEL,
    temperature: 0,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content:
          'You grade a customer-support reply against a rubric. Judge only what the rubric asks. The excerpts are the knowledge-base text the assistant was given this turn. Reply with JSON: {"pass": true|false, "reason": "<one short sentence>"}.',
      },
      { role: "user", content: `Rubric:\n${rubric}\n\nCustomer asked:\n${question}\n\nExcerpts:\n${excerpts}\n\nAssistant reply:\n${reply}` },
    ],
  });
  const parsed = JSON.parse(res.choices[0]?.message.content ?? "{}") as { pass?: boolean; reason?: string };
  return {
    pass: parsed.pass === true,
    reason: parsed.reason ?? "no reason given",
    promptTokens: res.usage?.prompt_tokens ?? 0,
    completionTokens: res.usage?.completion_tokens ?? 0,
  };
}
