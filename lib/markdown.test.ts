import { describe, expect, it } from "vitest";
import { parseBlocks, parseInline, stripCitations } from "./markdown";

describe("parseInline", () => {
  it("returns a single plain span for text with no markers", () => {
    expect(parseInline("hello there")).toEqual([{ text: "hello there" }]);
  });

  it("marks a double-asterisk run as bold", () => {
    expect(parseInline("**Change or Cancel Subscription**")).toEqual([
      { text: "Change or Cancel Subscription", bold: true },
    ]);
  });

  it("marks a single-asterisk run as italic", () => {
    expect(parseInline("*soon*")).toEqual([{ text: "soon", italic: true }]);
  });

  it("splits surrounding plain text from an emphasised run", () => {
    expect(parseInline("a **b** c")).toEqual([
      { text: "a " },
      { text: "b", bold: true },
      { text: " c" },
    ]);
  });

  it("handles two bold runs in one line", () => {
    expect(parseInline("**a** and **b**")).toEqual([
      { text: "a", bold: true },
      { text: " and " },
      { text: "b", bold: true },
    ]);
  });

  it("leaves a lone asterisk as literal text", () => {
    expect(parseInline("2 * 3 = 6")).toEqual([{ text: "2 * 3 = 6" }]);
  });

  it("leaves an unterminated marker as literal text", () => {
    expect(parseInline("**half")).toEqual([{ text: "**half" }]);
  });

  it("drops empty spans", () => {
    expect(parseInline("**a**")).toHaveLength(1);
  });
});

describe("parseBlocks", () => {
  it("returns one paragraph for a single line", () => {
    expect(parseBlocks("hello")).toEqual([{ type: "paragraph", spans: [{ text: "hello" }] }]);
  });

  it("splits paragraphs on a blank line", () => {
    const out = parseBlocks("one\n\ntwo");
    expect(out).toHaveLength(2);
    expect(out.every((b) => b.type === "paragraph")).toBe(true);
  });

  it("keeps a single newline inside one paragraph", () => {
    const out = parseBlocks("one\ntwo");
    expect(out).toEqual([{ type: "paragraph", spans: [{ text: "one\ntwo" }] }]);
  });

  it("groups consecutive dash bullets into one list", () => {
    const out = parseBlocks("- alpha\n- beta");
    expect(out).toEqual([
      { type: "bullets", items: [[{ text: "alpha" }], [{ text: "beta" }]] },
    ]);
  });

  it("treats an asterisk bullet as a bullet, not italics", () => {
    // "* item" is a bullet; "*item*" is emphasis. The space is the difference.
    const out = parseBlocks("* alpha");
    expect(out).toEqual([{ type: "bullets", items: [[{ text: "alpha" }]] }]);
  });

  it("does not treat an emphasised line as a bullet", () => {
    const out = parseBlocks("*alpha*");
    expect(out).toEqual([{ type: "paragraph", spans: [{ text: "alpha", italic: true }] }]);
  });

  it("groups consecutive numbered items into one ordered list", () => {
    const out = parseBlocks("1. alpha\n2. beta");
    expect(out).toEqual([
      { type: "ordered", items: [[{ text: "alpha" }], [{ text: "beta" }]] },
    ]);
  });

  it("parses emphasis inside a list item", () => {
    const out = parseBlocks("- go to **settings**");
    expect(out).toEqual([
      { type: "bullets", items: [[{ text: "go to " }, { text: "settings", bold: true }]] },
    ]);
  });

  it("parses a hash heading", () => {
    expect(parseBlocks("## Refunds")).toEqual([
      { type: "heading", spans: [{ text: "Refunds" }] },
    ]);
  });

  it("separates a paragraph that follows a list", () => {
    const out = parseBlocks("- alpha\nthen this");
    expect(out.map((b) => b.type)).toEqual(["bullets", "paragraph"]);
  });

  it("returns nothing for empty input", () => {
    expect(parseBlocks("")).toEqual([]);
  });

  it("hides an unterminated bold marker while streaming", () => {
    // Without this the bubble briefly shows "Cha" preceded by two asterisks.
    expect(parseBlocks("Ready: **Cha", { streaming: true })).toEqual([
      { type: "paragraph", spans: [{ text: "Ready:" }] },
    ]);
  });

  it("hides an unterminated italic marker while streaming", () => {
    expect(parseBlocks("Ready: *Cha", { streaming: true })).toEqual([
      { type: "paragraph", spans: [{ text: "Ready:" }] },
    ]);
  });

  it("keeps a closed bold run untouched while streaming", () => {
    expect(parseBlocks("**done**", { streaming: true })).toEqual([
      { type: "paragraph", spans: [{ text: "done", bold: true }] },
    ]);
  });

  it("shows the unterminated marker once streaming has finished", () => {
    expect(parseBlocks("Ready: **Cha")).toEqual([
      { type: "paragraph", spans: [{ text: "Ready: **Cha" }] },
    ]);
  });
});

describe("stripCitations", () => {
  it("removes a bracketed source label with the angle-quote separator", () => {
    expect(stripCitations("Cancel anytime [pause-resume › How pausing works] before billing.")).toBe(
      "Cancel anytime before billing.",
    );
  });

  it("removes a label with a plain greater-than separator", () => {
    expect(stripCitations("Yes [refunds > When we refund] it is.")).toBe("Yes it is.");
  });

  it("removes a label at the end of a sentence without leaving a gap before the full stop", () => {
    expect(stripCitations("You can pause [pause-resume › How pausing works].")).toBe("You can pause.");
  });

  it("removes several labels in one answer", () => {
    const out = stripCitations("A [a › one] and B [b › two] done");
    expect(out).toBe("A and B done");
  });

  it("leaves ordinary bracketed text alone", () => {
    expect(stripCitations("Your order [FC1006] is on the way")).toBe("Your order [FC1006] is on the way");
  });

  it("leaves a markdown link alone", () => {
    expect(stripCitations("see [the article](/kb/refunds)")).toBe("see [the article](/kb/refunds)");
  });

  it("returns text with no citation unchanged", () => {
    expect(stripCitations("nothing to strip")).toBe("nothing to strip");
  });
});
