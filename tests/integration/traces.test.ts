import { afterAll, afterEach, describe, expect, it } from "vitest";
import "dotenv/config";
import { eq } from "drizzle-orm";
import { db } from "@/db";
import { traces } from "@/db/schema";
import { recordTrace, type TraceInput } from "@/lib/observability/traces";

const CONVERSATION = "77777777-7777-7777-7777-777777770001";
const AVA = "11111111-1111-1111-1111-111111110001";

const turn = (over: Partial<TraceInput> = {}): TraceInput => ({
  conversationId: CONVERSATION,
  customerId: AVA,
  turnIndex: 0,
  userMessage: "pause my subscription for 2 weeks",
  latencyMs: 2400,
  summary: { model: "gpt-4o-mini", promptTokens: 10_000, completionTokens: 500, tools: ["pause_subscription"], guards: ["nudge"], end: "answered" },
  ...over,
});

const rows = () => db.select().from(traces).where(eq(traces.conversationId, CONVERSATION));

describe("recordTrace", () => {
  afterEach(() => {
    delete process.env.TRACES_DISABLED;
    return db.delete(traces).where(eq(traces.conversationId, CONVERSATION));
  });
  afterAll(() => db.delete(traces).where(eq(traces.conversationId, CONVERSATION)));

  it("writes one row per turn with its tokens, cost, tools, guards and outcome", async () => {
    await recordTrace(turn());
    const [r] = await rows();
    expect(r).toMatchObject({
      customerId: AVA,
      turnIndex: 0,
      userMessage: "pause my subscription for 2 weeks",
      modelUsed: "gpt-4o-mini",
      toolsCalled: ["pause_subscription"],
      guards: ["nudge"],
      endReason: "answered",
      inputTokens: 10_000,
      outputTokens: 500,
      latencyMs: 2400,
    });
    expect(Number(r.estCostUsd)).toBeCloseTo(0.0018, 6);
  });

  it("logs a turn that threw as an error with no usage", async () => {
    await recordTrace(turn({ summary: null }));
    const [r] = await rows();
    expect(r).toMatchObject({ endReason: "error", inputTokens: 0, toolsCalled: [], guards: [] });
  });

  it("writes nothing when tracing is disabled, as the eval runner sets it", async () => {
    process.env.TRACES_DISABLED = "1";
    await recordTrace(turn());
    expect(await rows()).toEqual([]);
  });

  it("swallows a failed write instead of throwing into the chat", async () => {
    await expect(recordTrace(turn({ conversationId: "not-a-uuid" }))).resolves.toBeUndefined();
  });
});
