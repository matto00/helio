## Standing Constraints

- [C1] NEVER read/cat/grep/source/print any .env file (backend/.env, frontend/.env, infra/.env.deploy etc.), not even to compare, and never copy one or a tree containing one (cp -a, rsync, hardlinks); never run env-dumping commands (env, printenv, set, export -p, /proc/*/environ). scripts/concertino/.concertino.env may be read by scripts, never printed.
- [C2] Quoted heredocs only (<<'EOF'), even when the body looks harmless.
- [C3] No pkill/pgrep/killall (not even read-only pgrep); exact PIDs only; stop servers with stop-servers.sh; delete test residue with buildUserDeleteSql by exact id; plain emails.
- [C4] jest 3 workers, Playwright 2 workers TOTAL (never two Playwright batches at once), sbt -J-Xmx3g, nice -n 19.
- [C5] Bash timeout 600000; split long batches so each finishes under the timeout; never a background run past the tool timeout.
- [C6] Red first with mutations; run full spec files; record the red run before implementation code (if the pre-commit hook refuses a red jest commit, record it as .txt evidence and say so in the PR).
- [C7] All scratch/tool output in /home/matt/Development/helio/.concertino/scratch/HEL-1810/ (never /tmp, never inside the worktree); follow-up references in /home/matt/Development/helio/.concertino/runs/HEL-1810/evidence/.
- [C8] Lane-private DB helio_hel1810: DATABASE_URL=jdbc:postgresql://localhost:5432/helio_hel1810 for start-servers.sh, Playwright, every e2e cleanup step and every DB-touching jest/commit-hook run; any backend started with ANTHROPIC_API_KEY exported empty.
- [C9] No prod, release, concertino sync or MCP deploy; no claude.ai session link in commits or PR bodies.
- [C10] Scope: the four hooks plus one test in usePipelineStepStructure.sessionEpoch.test.tsx. Do not edit shared/session/*, HEL-1807's draft evaluator/javaRegex files, or package.json/package-lock.json (HEL-1820). A newly found id-carrying post-await site means escalate, not widen.
- [C12] (design-gate round 1) Every "nothing after sign-out" assertion must be reachable: the same-session control must show the follow-on happening with the same seeded preconditions (draft create: replace the step's config object in stepsRef while the create is in flight; undo: seed savedToastRef with the same applicationId; run stream: assert on what dispatch receives and on refreshRunHistoryAfterRun, not only on the preview service, and seed an Output in the store with draftSaveInFlightRef false and a succeeded event in the control). Record which assertion turns red under each mutation.
- [C11] Shared Playwright MCP browser: check for an open dialog and that the page is on this lane's dev port (7242); never navigate another lane's page; discard any open draft before navigating away.

## 1. Red tests (record before any fix)

- [x] 1.1 usePipelineDraftCreate.sessionEpoch.test.tsx: session ends during the create, an edit landed in flight; no `updatePipelineStep` after the create resolves. Same-session control: the flush IS sent.
- [x] 1.2 usePipelineShapeInstantiation.sessionEpoch.test.tsx: session ends during the first step create; no second `createPipelineStep` and no `createOutput`; session ends during a create that then rejects; no toast. Same-session control.
- [x] 1.3 usePipelineRunStream.sessionEpoch.test.tsx: `clearAuth` before the terminal event; no `resetRunScopedState`, no `previewOutput`, no `refreshRunHistoryAfterRun`. Same-session control.
- [x] 1.4 usePipelineDraftUndo.sessionEpoch.test.tsx: session ends during `undoPatchSet` -> no `dismissToast`, no `getPipelineWithDefinition`; session ends during `getPipelineWithDefinition` -> no `adoptDefinition`, no `fetchPipelineById`, no toast. Same-session control.
- [x] 1.5 Run the four files on unmodified hooks; record the red output in `red-run/` (.txt) before writing any hook change.

## 2. Fix

- [x] 2.1 Apply design.md D1 to the four hooks; every 1.x test turns green.
- [x] 2.2 One mutation per new check turns its test red; record in `mutation-runs/`.

## 3. Rollback test

- [x] 3.1 Add design.md D3's same-session rollback test to usePipelineStepStructure.sessionEpoch.test.tsx (green).
- [x] 3.2 Mutations `if (false)` and inverted `!==` on the rollback guard each turn it red; record in `mutation-runs/`.

## 4. Verify

- [x] 4.1 Full frontend jest (3 workers), lint, typecheck, format:check pass; HEL-1634 guard (`shared/session/sessionResetGuard.test.ts`) passes.
- [x] 4.2 e2e `hel1634-logout-user-switch.spec.ts` passes against helio_hel1810 (2 Playwright workers).
- [x] 4.3 Write `files-modified.md`.
