import { describe, expect, it } from "vitest";
import { chunkArticle } from "./chunk";

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

  it("keeps each section's body with its own heading", () => {
    const chunks = chunkArticle("pause-resume", article);
    expect(chunks[1].content).toContain("1 to 52 weeks");
    expect(chunks[1].content).not.toContain("Resume any time");
  });

  it("handles CRLF line endings", () => {
    const chunks = chunkArticle("x", "# T\r\n\r\n## A\r\n\r\nbody\r\n");
    expect(chunks.map((c) => c.heading)).toEqual(["A"]);
  });

});

