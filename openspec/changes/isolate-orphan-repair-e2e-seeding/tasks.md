## Standing Constraints

- [C1] Any trace parse that classifies a repair POST compares `resource-snapshot._monotonicTime` and action `startTime` in the same unit (ms), and attributes a counted repair POST to the explicit open only if it starts after the new page's own page-frame `GET /api/dashboards/<id>/panels` following the `goto` (not merely after the goto action began).

## 1. Tests

- [x] 1.1 Orphan test: attach the request listener before `registerAndLogin` (regex on `/layout/repair`, record url+body; page PATCH to `/api/dashboards/`)
- [x] 1.2 Orphan test: `page.goto("about:blank")` after login, before API seeding; assert the single repair URL targets the seeded dashboard id
- [x] 1.3 UI-create test: same early listener and `about:blank` isolation; keep `repairPosts` length 0
- [x] 1.4 Confirm every pre-existing assertion is kept at equal or stronger strength (design D4); no timeout lengthened
- [x] 1.5 Lint/format/typecheck the spec (`npm run lint`, `npm run format:check`, `npm run typecheck` as applicable)

## 2. Verification

- [x] 2.1 Mutation (a): make `useStoredLayoutRepair` inert, run the orphan test, record RED, revert
- [x] 2.2 Mutation (b): double-dispatch the repair, run the orphan test, record RED on exactly-one, revert
- [x] 2.3 Mutation (c): restore the old listener/seeding order in a scratch copy, run 20x, record that it flakes, discard
- [x] 2.4 Run the full spec with `--repeat-each 20 --workers 2 --trace on` under `nice -n 19`; record 20/20 consecutive green
- [x] 2.5 Parse the traces: zero page-frame `/api/` requests between `about:blank` and the dashboard goto, in every run
- [x] 2.6 Write the evidence (commands, counts, trace-parse output) to `verification.md` in this change dir
