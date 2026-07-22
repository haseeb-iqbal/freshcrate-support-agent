import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MOCK_SCRIPTS, normalize } from "./mock-scripts";

const E2E_DIR = join(process.cwd(), "cypress", "e2e");

const specFiles = () => readdirSync(E2E_DIR).filter((f) => f.endsWith(".cy.ts"));
const allSpecText = () => specFiles().map((f) => readFileSync(join(E2E_DIR, f), "utf8")).join("\n");

/** Every string a Cypress spec sends through its `ask()` helper. */
function askedStrings(): string[] {
  const out: string[] = [];
  for (const source of specFiles().map((f) => readFileSync(join(E2E_DIR, f), "utf8"))) {
    for (const m of source.matchAll(/\bask\(\s*"((?:[^"\\]|\\.)*)"\s*\)/g)) {
      out.push(m[1].replace(/\\"/g, '"'));
    }
  }
  return out;
}

describe("MOCK_SCRIPTS / Cypress contract", () => {
  it("finds the ask() calls in the E2E specs", () => {
    // Guard against the regex silently matching nothing after a spec rewrite,
    // which would make every assertion below vacuously true.
    expect(askedStrings().length).toBeGreaterThan(0);
  });

  it("has a script for every question the E2E specs ask", () => {
    const missing = askedStrings().filter((s) => !MOCK_SCRIPTS[normalize(s)]);
    expect(missing).toEqual([]);
  });

  it("has no script that no spec exercises", () => {
    const asked = new Set(askedStrings().map(normalize));
    expect(Object.keys(MOCK_SCRIPTS).filter((k) => !asked.has(k))).toEqual([]);
  });

  it("never lets a fixture assert an order status the specs do not verify", () => {
    // The delivered-vs-shipped bug hid behind a canned reply that stated a
    // status while its spec asserted only the order number. If a fixture claims
    // a status, some spec must check that word - otherwise the fixture is
    // asserting a fact on the suite's behalf that nothing verifies.
    const STATUS_WORDS = ["delivered", "shipped", "processing", "cancelled"];
    const specText = allSpecText();

    const unverified: string[] = [];
    for (const [key, script] of Object.entries(MOCK_SCRIPTS)) {
      const said = script.post_tool
        .concat(script.pre_tool)
        .filter((e) => e.type === "text")
        .map((e) => (e as { value: string }).value)
        .join(" ")
        .toLowerCase();
      for (const word of STATUS_WORDS) {
        if (said.includes(word) && !specText.includes(word)) unverified.push(`${key}: "${word}"`);
      }
    }
    expect(unverified).toEqual([]);
  });

  it("stores every key in normalized form", () => {
    expect(Object.keys(MOCK_SCRIPTS).filter((k) => normalize(k) !== k)).toEqual([]);
  });

  it("gives every script a non-empty first turn", () => {
    const empty = Object.entries(MOCK_SCRIPTS).filter(([, s]) => s.pre_tool.length === 0);
    expect(empty.map(([k]) => k)).toEqual([]);
  });

  it("gives every script that calls a tool a post-tool turn to answer with", () => {
    const broken = Object.entries(MOCK_SCRIPTS)
      .filter(([, s]) => s.pre_tool.some((e) => e.type === "tool_calls") && s.post_tool.length === 0)
      .map(([k]) => k);
    expect(broken).toEqual([]);
  });
});

describe("normalize", () => {
  it("lowercases, trims and collapses whitespace", () => {
    expect(normalize("  Show  My   ORDER history ")).toBe("show my order history");
  });
});
