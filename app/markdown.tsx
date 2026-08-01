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
        s.code ? (
          <code key={i} className="rounded bg-slate-100 px-1 py-0.5 font-mono text-[0.85em] text-slate-800">
            {s.text}
          </code>
        ) : s.bold ? (
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
          case "table":
            // Wrapped in an overflow container so a wide table scrolls inside the
            // bubble rather than stretching it.
            return (
              <div key={i} className={`${spacing}overflow-x-auto`}>
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr>
                      {block.header.map((cell, j) => (
                        <th
                          key={j}
                          className="border-b border-slate-300 px-2 py-1 font-semibold text-slate-900"
                        >
                          <Spans spans={cell} />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {block.rows.map((row, r) => (
                      <tr key={r}>
                        {row.map((cell, c) => (
                          <td key={c} className="border-b border-slate-100 px-2 py-1 align-top">
                            <Spans spans={cell} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
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
