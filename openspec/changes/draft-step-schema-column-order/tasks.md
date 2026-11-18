## Standing Constraints

## Driver Constraints (restated from the driver brief, binding for every role)

- D-C1: NEVER read/cat/grep/source/print any .env file; never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). Only scripts/concertino/.concertino.env may be read by scripts, never printed. Never copy .env files.
- D-C2: quoted heredocs only (<<'EOF'), or Write/Edit.
- D-C3: no pkill, pgrep or killall; kill only by exact PID; stop servers with scripts/concertino/stop-servers.sh; delete DB residue only by exact id via buildUserDeleteSql (e2e/support/userCleanupCore.cjs); throwaway emails are plain addresses.
- D-C4: jest 3 workers, Playwright 2 workers, sbt -J-Xmx3g, nice -n 19.
- D-C5: `timeout: 600000` on long Bash calls (including `git commit`); `sbt testFull`, never bare `sbt test`.
- D-C12: RED FIRST with recorded mutations; evaluator and skeptic run FULL affected spec files.
- D-C13: scratch in .concertino/scratch/HEL-1732/.
- D-C14: clean any dev-DB residue you create (exact ids). For e2e/UI use a lane-private DB `helio_hel1732` (createdb; DATABASE_URL set for start-servers.sh AND the Playwright process); the shared dev DB is behind main's Flyway version. No migration in this change.
- Do not touch the Output editor chart preview files (concurrent HEL-1763) or shared popover fit (HEL-1762).

## 0. Owner ruling

- [x] 0.1 Escalation answered `redesign-no-request` (2026-11-18): no request on a client-evaluable edit; the standing requirement stays as written.

## 1. Remove cycle-1 request pieces (D5)

- [x] 1.1 Delete `useDraftStepProjection.ts`, `draftProjection.ts` and their tests; revert page/sheet wiring and the two test edits to main; `git diff main --` on those files is empty.

## 2. Truncated fallback (D4)

- [x] 2.1 RED test in `draftStepView.test.ts` (proven red on main in cycle 1).
- [x] 2.2 Fix in `mapServerResolved` (kept).

## 3. Declared column order without a request (D1-D3)

- [x] 3.1 RED: input re-key unit tests (roots and source secondaries, exact rootId match, inferredSchema fallback, code-unit fallback, memo identity); observe red.
- [x] 3.2 D2 audit of every client step handler vs the server analyze order; record the table; RED tests for each handler fixed (at least `rename` in place) and order assertions for those already matching.
- [x] 3.3 RED: `draftColumnOrder` (D3a, incl. sparse frame) and D3b precedence unit tests (incl. root binding change and secondary-lane edit); flash test (only changed rows flash after the re-key); join-with-source-secondary order test.
- [x] 3.4 Implement D1 (memoized, both base and draft), D2 fixes (rename rebuild from input order), D3a/D3b, and the grid using the resulting order (no request). Remove or rewrite cycle-1 `StepPreviewTable.columnOrder.test.tsx`.
- [x] 3.5 RED: page-level test (6+ column hash-ordered sample, rename in shown step, shown + descendant headers, no request); record the unplug mutation turning it red.
- [x] 3.6 RED: draft-inserted compute step derived through the real walk (replaces cycle-1 test (c)).

## 4. Optional HEL-1705 extras: deferred, listed in the PR

## 5. Gates and UI check

- [x] 5.1 Frontend lint, typecheck, format check; full jest (3 workers); FULL affected spec files.
- [x] 5.2 e2e on lane-private DB: `hel1631-draft-mode.spec.ts` (all), `hel1632-live-output.spec.ts` (all), `npm run e2e:prod-build` for the `@prod-build` burst test; all green unchanged.
- [x] 5.3 Running app: 6+ column source; headers in declared order for a client step, a draft rename and its descendant, a draft-inserted step and a server-resolved step; desktop and 375px phone, light and dark; network shows no request on client-evaluable edits; screenshots in scratch.
- [x] 5.4 Merge origin/main into the branch before handoff to delivery (main has moved; HEL-1762/1763 touch nearby UI); re-run the affected specs after the merge.
