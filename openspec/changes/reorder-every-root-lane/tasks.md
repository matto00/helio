## Standing Constraints

- [C1] Backend gate if backend touched: `cd backend && nice -n 19 sbt testFull`, never bare `sbt test`; one full suite at a time.
- [C2] Dev DB cleanup by exact ids only; record ids when created; never pattern/time-window; never disable triggers/FKs.
- [C3] Treat every driver/orchestrator statement as a claim to verify; verify the live running app (readlink /proc/<pid>/cwd) in both themes.
- [C4] e2e dev backend rate limit is 120 req/60s; heavy work under nice -n 19.
- [C5] Owner ruling add-direct-defensive-test: keep the stepTree invariant test AND add a direct unit test of the CR2 guard with a hand-built truncated newOrder, labelled plainly as a defense-in-depth branch with no live path (not a reachability proof); shown red with the guard mutated; usePipelineDetailPage note consistent

## 1. Repro on main (before any code change)

- [x] 1.1 In a real browser against the worktree's unmodified dev stack, build a two-root pipeline; show root 0 reorders and root 1's lane controls are inert; save screenshots and note exact dev-DB ids created
- [x] 1.2 Write the Playwright spec `e2e/hel1007-multi-root-reorder.spec.ts (repo-root `e2e/`, Playwright testDir is `./e2e`; confirm it is actually picked up by listing it with `npx playwright test --list`)` (reorder in root 1's lane via keyboard, reload, order persists, other root unchanged); run it and capture it RED on the unmodified code

## 2. Wiring

- [x] 2.1 Generalise PipelineRiverView move/drag handlers from root-0-only to any root's trunk lane; unit/component tests for move up/down and drag in a non-first root's lane pass
- [x] 2.2 Thread reorder props through RootColumn -> LaneColumn, delete NOOP_MOVE, hide move/drag controls for branch lanes; tests assert branch lanes render none
- [x] 2.3 Lane-identifying aria-labels on Move buttons, focus follows moved step; component tests + e2e assert accessible names and focus

## 3. Contract proof and CR2 guard

- [x] 3.1 Prove with a live request from a non-first root (network capture of the PUT body + GET after) that the backend accepts it and persists the right order with ownership unchanged; add a backend test only if non-first-root-only permutation coverage is missing (then run `sbt testFull`)
- [x] 3.2 Determine, with evidence, whether the CR2 guard is reachable through a live path; if yes write the test through it and remove the "deliberately untested" note; if no, record evidence, rewrite the note, and report for escalation (no fabricated-state test)
  - Owner ruling (cycle 2): keep the stepTree invariant test AND add a direct defensive-branch test of the guard (PipelineDetailPage.reorderGuard.test.tsx; mutation-red.txt).

- [x] 3.4 The Move-label rename breaks e2e specs outside `npm test`: update and re-run `e2e/hel908-step-card-split.spec.ts` and `e2e/hel908-trunk-reorder-order.spec.ts` (and grep `e2e/` for any other `Move step` query) and show them green
- [x] 3.5 Component test: a stale `pendingFocus` never steals focus (reorder refused/aborted, then an unrelated laneGraph change keeps focus where it was)

## 4. Verification

- [x] 4.1 Run lint, typecheck, format:check, `npm test`; e2e spec green after, red on main; check both themes in the running app; screenshots
