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
