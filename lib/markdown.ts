/**
 * A deliberately small markdown reader for model output.
 *
 * The chat bubble used to print `message.content` verbatim, so an answer
 * containing `**Change or Cancel Subscription**` reached the customer with its
 * asterisks. Rather than pull in a markdown library for a handful of bold spans
 * and lists, this parses the subset the model actually emits and returns plain
 * data. The React side (app/markdown.tsx) maps that data to elements, so there
 * is no HTML string anywhere and nothing to sanitize.
 *
 * Anything outside the subset falls through as literal text.
 */

export interface Span {
  text: string;
  bold?: boolean;
  italic?: boolean;
}

export type Block =
  | { type: "paragraph"; spans: Span[] }
  | { type: "heading"; spans: Span[] }
  | { type: "bullets"; items: Span[][] }
  | { type: "ordered"; items: Span[][] };

export interface ParseOptions {
  /** Mid-stream: hide a marker whose closing half has not arrived yet. */
  streaming?: boolean;
}

/** `**bold**` or `*italic*`. Bold is tried first so `**x**` never reads as two
 *  empty italic runs. Neither run may contain an asterisk, which keeps the
 *  match non-greedy without lookahead. */
const INLINE = /\*\*[^*]+\*\*|\*[^*\n]+\*/g;

/** `[slug › heading]` or `[slug > heading]`, with any space that precedes it.
 *  The separator is what distinguishes a citation from ordinary bracketed text
 *  such as `[FC1006]` or a markdown link. */
const CITATION = /\s*\[[a-z0-9-]+\s*[›>]\s*[^\]\n]+\]/gi;

const HEADING = /^#{1,3}\s+(.*)$/;
const BULLET = /^[-*]\s+(.*)$/;
const ORDERED = /^\d+[.)]\s+(.*)$/;

/** Split a run of text into bold / italic / plain spans. */
export function parseInline(text: string): Span[] {
  const spans: Span[] = [];
  let last = 0;
  for (const match of text.matchAll(INLINE)) {
    const start = match.index ?? 0;
    if (start > last) spans.push({ text: text.slice(last, start) });
    const token = match[0];
    if (token.startsWith("**")) spans.push({ text: token.slice(2, -2), bold: true });
    else spans.push({ text: token.slice(1, -1), italic: true });
    last = start + token.length;
  }
  if (last < text.length) spans.push({ text: text.slice(last) });
  return spans.filter((s) => s.text !== "");
}

/**
 * Drop a trailing marker whose partner has not streamed in yet.
 *
 * Two conditions must both hold. Parity: an odd number of `**` (or of lone
 * `*`) means the last one opened a run that is still unclosed. Shape: the
 * marker must look like an emphasis OPENER, meaning a non-space character
 * follows it, or it must sit at the very end of the text. Emphasis can never
 * open with "* ", so an ordinary literal asterisk such as the one in "2 * 3"
 * is left alone.
 *
 * Both conditions are needed. Parity alone deletes everything after any stray
 * literal asterisk; shape alone would eat the closing marker of a finished run.
 */
function hideUnterminatedMarker(text: string): string {
  let out = text;
  if ((out.match(/\*\*/g)?.length ?? 0) % 2 === 1) {
    out = out.replace(/\*\*[^*\s][^*]*$|\*\*$/, "");
  }
  // Strip the `**` pairs before counting, so only genuinely lone asterisks
  // drive this parity check. Done without a lookbehind on purpose: a regex
  // literal using one is a parse-time SyntaxError on older Safari, which
  // would take the whole client bundle down rather than degrade.
  const lone = out.replace(/\*\*/g, "").match(/\*/g)?.length ?? 0;
  if (lone % 2 === 1) {
    out = out.replace(/\*[^*\s\n][^*\n]*$|\*$/, "");
  }
  return out;
}

/** Remove inline source labels. The sources are shown as links below the reply,
 *  so a bracketed label in the prose is duplication. */
export function stripCitations(text: string): string {
  return text.replace(CITATION, "").replace(/^\s+/, "");
}

/** Split text into paragraphs, headings and lists. */
export function parseBlocks(text: string, opts: ParseOptions = {}): Block[] {
  const source = opts.streaming ? hideUnterminatedMarker(text) : text;
  const blocks: Block[] = [];
  let paragraph: string[] = [];

  const flush = () => {
    if (paragraph.length === 0) return;
    blocks.push({ type: "paragraph", spans: parseInline(paragraph.join("\n")) });
    paragraph = [];
  };

  const appendItem = (type: "bullets" | "ordered", content: string) => {
    const previous = blocks[blocks.length - 1];
    if (previous && previous.type === type) previous.items.push(parseInline(content));
    else blocks.push({ type, items: [parseInline(content)] });
  };

  for (const line of source.split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "") {
      flush();
      continue;
    }

    const heading = HEADING.exec(trimmed);
    if (heading) {
      flush();
      blocks.push({ type: "heading", spans: parseInline(heading[1]) });
      continue;
    }

    const ordered = ORDERED.exec(trimmed);
    if (ordered) {
      flush();
      appendItem("ordered", ordered[1]);
      continue;
    }

    const bullet = BULLET.exec(trimmed);
    if (bullet) {
      flush();
      appendItem("bullets", bullet[1]);
      continue;
    }

    paragraph.push(trimmed);
  }

  flush();
  return blocks;
}
