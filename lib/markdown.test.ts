import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline, stripCitations } from "./markdown";

describe("parseInline", () => {

  it("marks a double-asterisk run as bold", () => {
    expect(parseInline("**Change or Cancel Subscription**")).toEqual([
      { text: "Change or Cancel Subscription", bold: true },
    ]);
  });

  it("marks a backtick run as inline code", () => {
    expect(parseInline("your order `FC1006` shipped")).toEqual([
      { text: "your order " },
      { text: "FC1006", code: true },
      { text: " shipped" },
    ]);
  });

});

describe("parseBlocks", () => {



  it("groups consecutive dash bullets into one list", () => {
    const out = parseBlocks("- alpha\n- beta");
    expect(out).toEqual([
      { type: "bullets", items: [[{ text: "alpha" }], [{ text: "beta" }]] },
    ]);
  });

  it("parses a hash heading", () => {
    expect(parseBlocks("## Refunds")).toEqual([
      { type: "heading", spans: [{ text: "Refunds" }] },
    ]);
  });

  it("parses a pipe table into a table block", () => {
    const out = parseBlocks("| Plan | Price |\n| --- | --- |\n| 2 meals | $30 |\n| 3 meals | $42 |");
    expect(out).toEqual([
      {
        type: "table",
        header: [[{ text: "Plan" }], [{ text: "Price" }]],
        rows: [
          [[{ text: "2 meals" }], [{ text: "$30" }]],
          [[{ text: "3 meals" }], [{ text: "$42" }]],
        ],
      },
    ]);
  });

  it("hides an unterminated bold marker while streaming", () => {
    // Without this the bubble briefly shows "Cha" preceded by two asterisks.
    expect(parseBlocks("Ready: **Cha", { streaming: true })).toEqual([
      { type: "paragraph", spans: [{ text: "Ready:" }] },
    ]);
  });

});

describe("stripCitations", () => {
  it("removes a bracketed source label with the angle-quote separator", () => {
    expect(stripCitations("Cancel anytime [pause-resume › How pausing works] before billing.")).toBe(
      "Cancel anytime before billing.",
    );
  });

  it("leaves a markdown link alone", () => {
    expect(stripCitations("see [the article](/kb/refunds)")).toBe("see [the article](/kb/refunds)");
  });

});
