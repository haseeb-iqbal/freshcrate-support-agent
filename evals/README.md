# evals

Real-model evals: `npm run eval` (see the README's Testing section).

- `cases.ts` - the conversations and the rule checks on each reply. Add a case here.
- `types.ts` - the case and check shapes.
- `run.ts` - seeds the DB, plays each case through `POST /api/chat`, checks it, writes `report.md` (gitignored).

Mark a case `knownFailing: true` when it captures a bug that isn't fixed yet: it is reported as XFAIL and doesn't fail the run, and XPASS tells you it now passes.
