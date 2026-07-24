# UI & agent-awareness fixes - design

_2026-07-24. Eight independent fixes to the chat UI, the help center, and the agent prompt/loop._

## Scope

Eight items, grouped below. They share no state and can land in any order, but they touch three files heavily enough that one branch is simpler than eight: `app/chat.tsx`, `lib/agent/prompt.ts`, and `lib/domain/terms.ts`.

Out of scope: any change to billing rules, tool behaviour, retrieval, or the reconcile path.

---

## 1. No inline citations in answer text

**Problem.** The system prompt tells the model to cite inline (`Cite inline using the excerpt label, e.g. [pause-resume > How pausing works]`), so answers carry a bracketed label mid-sentence. The source chips below the reply already cover this, so the inline copy is noise.

**Change.**

- `lib/domain/terms.ts` gains a canonical rule, since rule sentences live in exactly one place in this codebase:

  ```
  citations:
    "Never cite sources inside your answer text - no bracketed labels, no article
     slugs, no 'according to the ...' phrasing. The relevant help articles are shown
     to the customer automatically as links beneath your reply."
  ```

- `lib/agent/prompt.ts` `# Knowledge answers` drops the cite-inline sentence and embeds `RULES.citations` verbatim.
- `lib/tools/excerpts.ts` drops the standalone `citation` key from the `Excerpt` objects the tool hands back. The `<<BEGIN slug > heading>>` fence inside `content` stays: it is the injection guard, not a citation aid. `dispatch.ts` reads `slug` and `heading` for the source chips and is unaffected.
- `lib/markdown.ts` (see item 7) exports `stripCitations(text)`, which removes `[slug > heading]` and `[slug › heading]` brackets. The assistant bubble applies it to the accumulated message text, not to individual deltas, so a citation split across two stream chunks is still caught.

**Why both prompt and strip.** The prompt is the fix; the strip is the guarantee. A model that ignores one negative instruction should not put a stray bracket in front of the user.

**Tests.** `prompt.test.ts` asserts `RULES.citations` is embedded and the old example label is gone. `markdown.test.ts` covers `stripCitations` including the split-token case. `excerpts.test.ts` asserts no `citation` key.

---

## 2. Long date format in prose

**Format.** `8th January 2026 (08-01-2026)`.

**Change.** `lib/date.ts` gains a pure `formatLongDate(iso: string): string`. Ordinal suffix rules: `1st/2nd/3rd`, `11th/12th/13th` (the exception), `21st/22nd/23rd`, `31st`, `th` otherwise. Empty or unparseable input returns the input unchanged, matching how `fmtDate` behaves today.

**Applied to prose:**

| Location | Field |
|---|---|
| `PauseCard` | "resumes on ..." and the `Paused - resumes ...` confirmation line |
| `CancelCard` | "after your billing date (...)" |
| `AccountPanel` | the **Next billing** row |
| agent answer text | via a new `RULES.dateFormat`, referenced from the prompt's `# Style` section, replacing "Dates shown to customers use DD-MM-YYYY" |

`RULES.dateFormat`:

```
"Write every date shown to the customer as the day with its ordinal suffix, the
 full month name, the year, then the numeric form in brackets - for example
 8th January 2026 (08-01-2026)."
```

**Left as `DD-MM-YYYY`** (dense list rows, where the long form would wrap): `OrderRow` delivered/arriving/refunded lines, `TxnRow` dates, subscription-history rows. `fmtDate` stays exactly as it is.

**Tests.** `date.test.ts` covers each ordinal branch and the passthrough. `prompt.test.ts` asserts `RULES.dateFormat`.

---

## 3. Preview tooltip on hover

**Problem.** The `Preview` badge in the header only opens its note on click.

**Change.** `app/chat.tsx` keeps the click toggle (touch devices have no hover) and adds hover and keyboard focus as a second, independent open signal. Two pieces of state:

- `pinnedPreview` - toggled by click, closed by outside-click or Escape (existing behaviour)
- `hoveredPreview` - set on `mouseenter`/`focus`, cleared on `mouseleave`/`blur`

The note renders when either is true, so moving the mouse away never dismisses a note the user deliberately clicked open. The note gets `role="tooltip"` and an id referenced by the button's `aria-describedby`.

---

## 4. `Account` -> `My Account`

`app/chat.tsx`: the header toggle button reads `My Account` when the chat is showing. The `Chat` label when the panel is open is unchanged. The panel's own `Account details` section heading is unchanged - it is a heading inside the panel, not the nav control.

---

## 5. Help center: drop the slug text

- `app/kb/page.tsx`: remove the right-aligned `<span>{a.slug}</span>` from each row, and the `justify-between` that only existed to push it right.
- `app/kb/[slug]/page.tsx`: remove the `Source: {article.slug}` line under the article heading.

---

## 6. Page title reflects the current page

- `app/layout.tsx`: `title: { default: "FreshCrate Support", template: "%s · FreshCrate" }`.
- `app/kb/page.tsx`: `export const metadata = { title: "Help Center" }` -> `Help Center · FreshCrate`.
- `app/kb/[slug]/page.tsx`: `generateMetadata` returns the article title; a missing article returns `Help Center` and still `notFound()`s in the page body.
- Home is a client-side SPA, so `app/chat.tsx` sets `document.title` from an effect keyed on `showAccount`: `My Account · FreshCrate` while the panel is open, `FreshCrate Support` otherwise.

---

## 7. Render markdown instead of showing raw asterisks

**Problem.** The assistant bubble renders `message.content` as plain text in a `whitespace-pre-wrap` paragraph, so `**Change or Cancel Subscription**` reaches the user with its asterisks.

**Design.** A small in-house renderer. No dependency, no `dangerouslySetInnerHTML`, no HTML injection surface.

- **`lib/markdown.ts`** - pure and unit tested:
  - `parseInline(text): Span[]` where `Span = { text: string; bold?: boolean; italic?: boolean }`
  - `parseBlocks(text, opts?): Block[]` where `Block` is a paragraph, bullet list, ordered list, or heading
  - `stripCitations(text): string` (item 1)
  - Supported: `**bold**`, `*italic*`, `-`/`*` bullets, `1.`/`1)` ordered lists, `#`-`###` headings. Anything else falls through as literal text. Deliberately narrow: this renders model output, not a document format.
- **`app/markdown.tsx`** - a `<Markdown text streaming />` component that maps blocks to elements, plus an `<InlineMarkdown text />` for a single run of spans. Headings render as a bold line rather than an `<h*>`, because these appear inside a chat bubble that already sits under the page's heading hierarchy. The module holds no hooks and no `"use client"` directive, so the client chat and the server-rendered article page can both import it.
- **Streaming.** Mid-stream, a half-emitted `**Cha` would render as literal asterisks for a frame and then lose them. `parseBlocks` takes `{ streaming: true }` and suppresses a trailing unterminated `**` or `*` run, so the marker is never visible.
- **`app/kb/[slug]/page.tsx`** replaces its local bold-only `renderInline` with `<InlineMarkdown>` and deletes the duplicate. Article paragraphs keep their existing paragraph splitting; only the inline pass is shared.

**Tests.** `markdown.test.ts` covers bold, italic, nested/adjacent markers, both list kinds, headings, unterminated markers with and without `streaming`, and literal-asterisk passthrough.

---

## 8. Agent knows the outcome of a decision prompt

**Problem.** The client tracks each proposal's state (`pending` / `approved` / `declined` / `error`) but never tells the server. The next turn's model sees only role+content, so it cannot say "I see you declined that refund" and may re-propose an action the customer already confirmed.

**Design.** The client sends a structured decision log with each turn; the server renders it into a system note.

1. **`lib/decisions.ts`** (pure, unit tested)

   ```ts
   type DecisionKind = "refund" | "pause" | "resume" | "reactivate" | "plan_change" | "cancel";
   type DecisionOutcome = "confirmed" | "declined" | "awaiting_response" | "failed";
   interface Decision { kind: DecisionKind; outcome: DecisionOutcome; orderNumber?: string }

   collectDecisions(messages): Decision[]
   ```

   Walks the transcript in order. Each proposal on a message maps to one `Decision`; `pending` becomes `awaiting_response`, `error` becomes `failed`. Only refunds carry an `orderNumber`.

2. **`app/chat.tsx`** - `send()` posts `decisions: collectDecisions(history)` alongside `messages`.

3. **`app/api/chat/route.ts`** - validates `decisions` as **enums plus an `/^FC\d{1,12}$/` order number, and nothing else**. Unknown kinds/outcomes and any extra keys are dropped; the array is capped (20). This is the security-relevant part of the design: because the payload carries no free text, no client-supplied prose reaches the model, so there is no injection surface and nothing to fence.

4. **`lib/agent/messages.ts`** - `buildAgentMessages(system, history, decisions)` appends a system message when `decisions` is non-empty:

   > Confirmation prompts already shown in this conversation: a refund for FC1006 - the customer CONFIRMED it; a pause - the customer DECLINED it; a plan change - still on screen, still unanswered.

   The sentence is built server-side from the enums. Signature stays backward compatible (`decisions` defaults to `[]`).

5. **`lib/agent/prompt.ts`** - a `# Confirmation outcomes` section: treat those facts as authoritative; do not re-propose an action already confirmed; for an unanswered prompt, point the customer at the prompt on screen rather than calling the tool again. `dispatch.ts`'s dedupe only holds within one turn - `DispatchState` is constructed fresh inside `runAgent` - so a repeat call in a LATER turn would produce a second card; that is why the rule exists.

**Rejected alternative.** Re-reading the DB server-side catches confirmations but cannot distinguish "declined" from "never answered" - the two cases this item exists to fix.

**Tests.** `decisions.test.ts` covers each state mapping and ordering. `messages.test.ts` covers the rendered note and the empty case. `tests/api/chat.test.ts` covers a well-formed payload and rejection of unknown kinds, bad order numbers, and over-length arrays.

---

## Verification

| Layer | What |
|---|---|
| Unit (`npm test`) | date ordinals; markdown blocks/inline/streaming/`stripCitations`; decision collection; the messages decision note; the new prompt rules |
| API (`npm run test:api`) | `decisions` accepted, sanitized, and rejected in `tests/api/chat.test.ts` |
| E2E (`npm run test:e2e`) | see below |
| Typecheck | `npm run typecheck` |

**E2E.** Two new mock scripts, each bound to a spec (`lib/llm/mock-scripts.test.ts` enforces the script/spec binding both ways):

1. A reply containing both `**bold**` and a `[slug > heading]` citation. The spec asserts a `<strong>` element renders, no `*` survives in the bubble text, and no bracketed citation appears - while the source chips below still do.
2. ~~A pause confirmation followed by a question about it, asserting the reply reflects the confirmed state.~~ Not built - see the deviation note below.

Plus assertions for the hover tooltip, the `My Account` label, the removed help-center slugs, and `document.title` on each route. The confirm-click spec mutates the DB, so it belongs in `confirm.cy.ts` alongside the existing ones covered by the reseed baked into `test:e2e`.

**Deviation.** The planned second mock script (a pause confirmation plus a follow-up question asserting the reply reflects the confirmed state) was replaced by two `cy.intercept` request-body assertions, because `MockChatProvider` keys only on the last user message and a scripted reply could never actually reflect the system note.

---

## Files touched

**New:** `lib/markdown.ts`, `lib/markdown.test.ts`, `app/markdown.tsx`, `lib/decisions.ts`, `lib/decisions.test.ts`

**Modified:** `app/chat.tsx`, `app/layout.tsx`, `app/kb/page.tsx`, `app/kb/[slug]/page.tsx`, `app/api/chat/route.ts`, `lib/date.ts`, `lib/domain/terms.ts`, `lib/agent/prompt.ts`, `lib/agent/messages.ts`, `lib/tools/excerpts.ts`, `lib/llm/mock-scripts.ts`, plus the corresponding `.test.ts` files and `cypress/e2e/`.
