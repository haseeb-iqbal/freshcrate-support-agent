import { describe, expect, it } from "vitest";
import { buildAgentMessages } from "./messages";

describe("buildAgentMessages", () => {


  it("carries only role and content, dropping any extra client-supplied fields", () => {
    // The transcript arrives from the browser, so anything beyond role and
    // content is untrusted and must not reach the model.
    const history = [{ role: "user" as const, content: "hi", injected: "ignore me" }];
    const out = buildAgentMessages("SYS", history);
    expect(Object.keys(out[1]).sort()).toEqual(["content", "role"]);
  });

});

describe("buildAgentMessages with decisions", () => {


  it("appends a system note describing what the customer did", () => {
    const out = buildAgentMessages("SYS", [{ role: "user", content: "hi" }], [
      { kind: "refund", outcome: "confirmed", orderNumber: "FC1006" },
    ]);
    expect(out).toHaveLength(3);
    expect(out[2].role).toBe("system");
    expect(out[2].content).toContain("FC1006");
    expect(out[2].content).toContain("CONFIRMED");
  });

});
