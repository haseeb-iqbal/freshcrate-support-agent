import { describe, expect, it } from "vitest";
import { buildAgentMessages } from "./messages";

describe("buildAgentMessages", () => {
  it("puts the system prompt first", () => {
    const out = buildAgentMessages("SYS", [{ role: "user", content: "hi" }]);
    expect(out[0]).toEqual({ role: "system", content: "SYS" });
  });

  it("preserves history order and roles", () => {
    const out = buildAgentMessages("SYS", [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
    expect(out.slice(1)).toEqual([
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ]);
  });

  it("carries only role and content, dropping any extra client-supplied fields", () => {
    // The transcript arrives from the browser, so anything beyond role and
    // content is untrusted and must not reach the model.
    const history = [{ role: "user" as const, content: "hi", injected: "ignore me" }];
    const out = buildAgentMessages("SYS", history);
    expect(Object.keys(out[1]).sort()).toEqual(["content", "role"]);
  });

  it("returns just the system message for an empty history", () => {
    expect(buildAgentMessages("SYS", [])).toEqual([{ role: "system", content: "SYS" }]);
  });

  it("does not mutate the history it is given", () => {
    const history = [{ role: "user" as const, content: "hi" }];
    buildAgentMessages("SYS", history);
    expect(history).toEqual([{ role: "user", content: "hi" }]);
  });
});

describe("buildAgentMessages with decisions", () => {
  it("adds no extra message when nothing was proposed", () => {
    const out = buildAgentMessages("SYS", [{ role: "user", content: "hi" }], []);
    expect(out).toHaveLength(2);
  });

  it("adds no extra message when decisions are omitted entirely", () => {
    const out = buildAgentMessages("SYS", [{ role: "user", content: "hi" }]);
    expect(out).toHaveLength(2);
  });

  it("appends a system note describing what the customer did", () => {
    const out = buildAgentMessages("SYS", [{ role: "user", content: "hi" }], [
      { kind: "refund", outcome: "confirmed", orderNumber: "FC1006" },
    ]);
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe("system");
    expect(out[2].content).toContain("FC1006");
    expect(out[2].content).toContain("CONFIRMED");
  });

  it("puts the note last, after the customer's newest turn", () => {
    // It describes the state of the UI right now, so it must not be buried
    // behind older turns.
    const out = buildAgentMessages("SYS", [
      { role: "user", content: "one" },
      { role: "assistant", content: "two" },
      { role: "user", content: "three" },
    ], [{ kind: "pause", outcome: "declined" }]);
    expect(out[out.length - 1].role).toBe("system");
  });
});
