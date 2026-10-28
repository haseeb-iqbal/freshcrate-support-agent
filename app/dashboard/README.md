# app/dashboard

`/dashboard`: observability for the demo, read from the `traces` table (one row per chat turn, written by `lib/observability/traces.ts` after each response finishes).

- Totals for today, the last 7 days and all time: conversations, turns, cost, average cost per turn, average and p95 latency, and the share of turns that showed a card, needed a guard, or were cut short.
- Turns per day for the last 14 days, tool usage, and which guards stepped in.
- The slowest turns and the 20 most recent. Click a time to see that conversation's turns in order (`/dashboard?conversation=<id>`).

Costs are estimates at the list prices in `lib/llm/pricing.ts`. Evals don't write traces (`TRACES_DISABLED=1`). Like the rest of the demo, the page has no login, so it never shows what customers typed: the message is stored in `traces.user_message` for debugging from the database, but the page doesn't read it.
