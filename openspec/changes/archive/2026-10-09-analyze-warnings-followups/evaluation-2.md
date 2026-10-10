## Evaluation Report — Cycle 2 (evaluation-2.md)

Reviewed HEAD `519a03ef3ce3af53a0eed078dcd9ec1bf988ae8e`. The review base, resolved live, is `365d824c8f2eba017e150e9b5f67743920f56619`. Since cycle 1 (`e88dc69bb`), the commit changes:
- `PipelineAnalyzeService.scala`: adds `import scala.util.Try` and replaces all three inline `scala.util.Try` calls.
- `StepCard.tsx` and `PipelineDetailPage.css`: the heading gets an icon and becomes semibold.
- Three test files (detailed under Phase 2).
- It also commits `evaluation-1.md`.

### Gates (my own fresh runs, in WORKTREE_PATH)
- `npm run lint`, `npm run format:check`, `npm run typecheck`, and `npm run check:scala-quality` (clean, soft warnings only): all exit 0.
- `npm test`: root jest 44/44 suites, 433 tests. Frontend 500/500 suites, 5238 tests (cycle 1 had 5234; the 4 new tests are the page test and the three lane/root tests).
- `npm --prefix frontend run build`: exit 0.
- `cd backend && sbt -J-Xmx3g testFull` (nice 19): 6500 succeeded, 0 failed, 4 canceled (env-gated).

### Phase 1: Spec Review — PASS
Unchanged from evaluation-1 apart from the cycle-2 delta, which stays within scope. C1–C4 still hold: the delta touches no blocking path.

### Phase 2: Code Review — PASS
All three cycle-1 change requests are resolved. I checked the executor's mutation claims myself, in a throwaway detached worktree at 519a03ef3 that I have since removed. The `-t` filters ran only the targeted tests.

**CR1 (hook data flow).** The new `PipelineDetailPage.test.tsx` test, "renders each step's analyze warnings on its own card, in server order, none on other steps", passes unmutated. Under each mutation it fails (1 failed):
- `getAnalyzeWarnings` always returns `EMPTY_ANALYZE_WARNINGS`.
- The grouping uses `unshift` instead of `push`, i.e. server order is reversed.
- Every warning is returned for every step.

**CR2 (lane/root threading).** In `PipelineRiverView.test.tsx`:
- `LaneColumn.tsx:228` (compact lane) passing `warnings={undefined}` → 2 failed.
- `LaneColumn.tsx:281` (full lane) passing `warnings={undefined}` → 1 failed.
- `RootColumn.tsx:140` not forwarding `getAnalyzeWarnings` → 1 failed.

**CR3.** `import scala.util.Try` is at the top of `PipelineAnalyzeService.scala`, and no inline `scala.util.Try` remains in that file.

**Placement test.** The executor did not mutate this one, so I did. The StepCard test now asserts header < region < `.outputs-rail` < body. I moved the warnings region to after `<OutputsRail>`: the test "lists every message under 'Check before running' … before the Outputs rail" failed (Expected < 1, Received 2). I also moved the region before the header: 1 failed. The test is genuinely red-able.

**Heading change.** It uses only tokens: `--space-1`/`--space-2` gap and `--weight-semibold`. The `TriangleAlert` icon is `aria-hidden`, so the region's accessible name is unchanged: "Check before running (these don't block runs)". `tokenAuditSweep` passes.

### Phase 3: UI Review — PASS
- **Setup.** I used a fresh, isolated Playwright context (my own `chromium.launch()` + `newContext()` per theme), not the shared MCP browser, and never touched another lane's session. The frontend on 6846 is served from this worktree's `frontend/`, so it serves the cycle-2 code. The backend on 9753 is the instance I restarted in cycle 1 at e88dc69bb. Cycle 2's only backend change is the import refactor, which changes no behaviour, and the fresh `sbt testFull` above covers it.
- **Test pipeline.** A throwaway user, with a source-secondary lookup whose keys are string vs integer.
- **Light and dark.**
  - The warning region shows the TriangleAlert icon in `--app-warning` (light `rgb(133,85,26)` = `#85551a`, dark `rgb(245,185,68)` = `#f5b944`), with a weight-600 heading followed by "(these don't block runs)".
  - Card DOM order: header → warnings → outputs-rail → body.
  - No card has the `--errored` class.
  - Both lookup warnings (rename and key mismatch) are listed.
  - The region now matches the optionA mockup's icon + bold heading.
- **Console.** Only expected entries:
  - two `401`s for `/api/auth/me` on `/login` before logging in;
  - the pre-existing `/schedule` 404 for a pipeline with no schedule.
- **Evidence** (persisted):
  - `/home/matt/Development/helio/.concertino/runs/HEL-1414/evidence/.concertino/runs/HEL-1414/evidence/eval-c2-region-light.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1414/evidence/.concertino/runs/HEL-1414/evidence/eval-c2-region-dark.png`
  - originals at `/home/matt/Development/helio/.concertino/runs/HEL-1414/evidence/eval-c2-region-{light,dark}.png`.
- The cycle-1 checks (live analyze endpoint, breakpoints, keyboard, tail lane, refresh flow) were done on the unchanged backend and the same rendering path. The cycle-2 UI delta is limited to the heading.

### Overall: PASS

### Non-blocking Suggestions
- `StepCard.tsx` (≈508 lines) and `usePipelineDetailPage.ts` (≈1443 lines) are over CONTRIBUTING's ~400-line budget, so the PR description should propose a split.
- The duplicate `id="lookup-key"` across lookup cards predates this change. It is a candidate spinoff.

### Environment notes
- The throwaway user `hel1414-eval-c2-…@example.test` has id `020ca563-128c-4b12-ac94-00c939d3a300`. Everything I created was deleted by exact id:
  - pipeline `7eb9c23f-9635-4316-a307-9bc87ead0aaf` → 204
  - data sources `9903a773-9baf-4b1f-821b-f992491cea2e` and `4d7e7513-dee3-4e8e-b120-9c13292449bb` → 204
  - the user row, via psql (`pipeline_run_rate_window` had 0 rows for that id; the user delete returned the id; 0 remain).
- The mutation worktree is removed, `git worktree list` shows no stragglers, and WORKTREE_PATH is clean.
