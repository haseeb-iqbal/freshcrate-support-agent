import { parseBlocks, parseInline, type Span } from "@/lib/markdown";

/**
 * Renders the block/span data from lib/markdown.
 *
 * No hooks and no "use client" directive on purpose: the client chat and the
 * server-rendered help article both import this.
 */

function Spans({ spans }: { spans: Span[] }) {
  return (
    <>
      {spans.map((s, i) =>
        s.bold ? (
          <strong key={i} className="font-semibold text-slate-900">
            {s.text}
          </strong>
        ) : s.italic ? (
          <em key={i}>{s.text}</em>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}

/** One run of inline markdown - emphasis only, no block structure. */
export function InlineMarkdown({ text }: { text: string }) {
  return <Spans spans={parseInline(text)} />;
}

export function Markdown({
  text,
  streaming = false,
  className,
}: {
  text: string;
  streaming?: boolean;
  className?: string;
}) {
  const blocks = parseBlocks(text, { streaming });
  return (
    <div className={className}>
      {blocks.map((block, i) => {
        const spacing = i === 0 ? "" : "mt-2 ";
        switch (block.type) {
          case "heading":
            // A bold line rather than an <h*>: this sits inside a chat bubble
            // that is already below the page's heading hierarchy.
            return (
              <p key={i} className={`${spacing}font-semibold text-slate-900`}>
                <Spans spans={block.spans} />
              </p>
            );
          case "bullets":
            return (
              <ul key={i} className={`${spacing}list-disc space-y-0.5 pl-5`}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ul>
            );
          case "ordered":
            return (
              <ol key={i} className={`${spacing}list-decimal space-y-0.5 pl-5`}>
                {block.items.map((item, j) => (
                  <li key={j}>
                    <Spans spans={item} />
                  </li>
                ))}
              </ol>
            );
          default:
            return (
              <p key={i} className={`${spacing}whitespace-pre-wrap`}>
                <Spans spans={block.spans} />
              </p>
            );
        }
      })}
    </div>
  );
}
