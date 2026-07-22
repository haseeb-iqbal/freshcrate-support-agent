import { describe, expect, it } from "vitest";
import { chunkArticle, embeddingText } from "./chunk";

const article = `# Pausing and Resuming

Intro text before any section.

## How pausing works

You can pause for 1 to 52 weeks.

## How resuming works

Resume any time.
`;

describe("chunkArticle", () => {
  it("makes one chunk per H2 plus an Overview for the preamble", () => {
    const chunks = chunkArticle("pause-resume", article);
    expect(chunks.map((c) => c.heading)).toEqual(["Overview", "How pausing works", "How resuming works"]);
  });

  it("carries the H1 as the title on every chunk without storing it as content", () => {
    const chunks = chunkArticle("pause-resume", article);
    expect(chunks.every((c) => c.title === "Pausing and Resuming")).toBe(true);
    expect(chunks.some((c) => c.content.includes("# Pausing"))).toBe(false);
  });

  it("stamps the slug on every chunk", () => {
    const chunks = chunkArticle("pause-resume", article);
    expect(chunks.every((c) => c.articleSlug === "pause-resume")).toBe(true);
  });

  it("keeps each section's body with its own heading", () => {
    const chunks = chunkArticle("pause-resume", article);
    expect(chunks[1].content).toContain("1 to 52 weeks");
    expect(chunks[1].content).not.toContain("Resume any time");
  });

  it("drops sections that are empty after trimming", () => {
    const chunks = chunkArticle("x", "# T\n\n## Empty\n\n## Real\n\nbody\n");
    expect(chunks.map((c) => c.heading)).toEqual(["Real"]);
  });

  it("falls back to the slug as title when there is no H1", () => {
    const [chunk] = chunkArticle("no-title", "## Only\n\nbody\n");
    expect(chunk.title).toBe("no-title");
  });

  it("handles CRLF line endings", () => {
    const chunks = chunkArticle("x", "# T\r\n\r\n## A\r\n\r\nbody\r\n");
    expect(chunks.map((c) => c.heading)).toEqual(["A"]);
  });

  it("does not treat an H3 as a section break", () => {
    const chunks = chunkArticle("x", "# T\n\n## A\n\nbody\n\n### Sub\n\nmore\n");
    expect(chunks).toHaveLength(1);
    expect(chunks[0].content).toContain("### Sub");
  });

  it("returns nothing for an empty document", () => {
    expect(chunkArticle("x", "")).toEqual([]);
  });
});

describe("embeddingText", () => {
  it("prefixes the content with title and heading for context", () => {
    const text = embeddingText({ articleSlug: "s", heading: "H", content: "body", title: "T" });
    expect(text).toBe("T > H\nbody");
  });

  it("falls back to the slug when there is no title", () => {
    const text = embeddingText({ articleSlug: "s", heading: "H", content: "body" });
    expect(text).toBe("s > H\nbody");
  });
});
