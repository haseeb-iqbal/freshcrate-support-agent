# evals

Real-model evals: `npm run eval` (see the README's Testing section).

- `cases.ts` - the conversations and the checks on each reply. Add a case here.
- `types.ts` - the case and check shapes: rule checks per turn, confirm steps with the DB state they should leave, and an optional `judge` rubric.
- `judge.ts` - the LLM judge (gpt-4o-mini, temperature 0), given the reply and the KB sections the turn cited. Non-gating.
- `run.ts` - seeds the DB, plays each case through `POST /api/chat`, confirms cards through `/api/actions/*`, checks everything, writes `report.md` (gitignored).

Mark a case `knownFailing: true` when it captures a bug that isn't fixed yet: it is reported as XFAIL and doesn't fail the run, and XPASS tells you it now passes.
