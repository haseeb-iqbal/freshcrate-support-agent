/**
 * Call a Next App Router route handler directly.
 *
 * The action routes only use `NextRequest` as a type, so a plain `Request` is a
 * valid argument at runtime; the cast keeps TypeScript happy without starting a
 * Next server in the test process. A route that actually reads `nextUrl` needs a
 * real `NextRequest` instead.
 */
type RouteHandler = (req: never) => Promise<Response>;

export function postJson(handler: RouteHandler, body: unknown): Promise<Response> {
  return handler(
    new Request("http://test.local", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    }) as never,
  );
}

/** POST a raw string body, for malformed-JSON cases. */
export function postRaw(handler: RouteHandler, body: string): Promise<Response> {
  return handler(
    new Request("http://test.local", { method: "POST", headers: { "content-type": "application/json" }, body }) as never,
  );
}
