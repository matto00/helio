## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed at HEAD 469f4ea9377729f90d32e640a22b61be3c487439 (planning artifacts uncommitted under `openspec/changes/createplacement-test-load-timeout/`).

### What I verified (with evidence)

- **Spawn-cwd guard**: `assert-cwd.sh` -> `READY ambient=/home/matt/Development/helio branch=bug/createplacement-test-timeout-under-load/HEL-1353`.
- **Failure premise (read myself)**: `/home/matt/Development/helio/.concertino/runs/HEL-1277/evidence/screenshots/eval-3/jest-frontend-FAILED-under-sbt-load.log` (332 lines): `FAIL ... createPlacement.test.tsx (34.611 s)`; two `Exceeded timeout of 5000 ms` failures, both on the `it.each` at test-file line 345 ("an immediate insert at gap 0/1 ..."); 12 `console.error Error: AggregateError` from jsdom `xhr-utils.js dispatchError` / `socketErrorListener` (real sockets opened, escaping the mocks); `Tests: 2 failed, 4740 passed`. Matches ticket.md, design.md Context, and premise-validation.md.
- **Design's factual claims about the file** (`frontend/src/features/pipelines/ui/PipelineDetailPage.createPlacement.test.tsx`, 629 lines, worktree == main 469f4ea93):
  - Case (a) carries `}, 20000); // heaviest case ... ~1.9s under load` at line 339. Confirmed.
  - Case (b) `it.each` at 342-371 has no explicit timeout. Confirmed.
  - Only `../services/pipelineService` is `jest.mock`ed (line 36); store is real and includes `outputsReducer`, `sourcesReducer`, `dashboardsReducer`, `panelsReducer`, `authReducer` — so un-mocked services elsewhere are a plausible XHR source, as the design says (unconfirmed; correctly left to the probe).
  - `frontend/jest.config.cjs` has no `testTimeout`. Confirmed.
  - `src/test/jest.setup.ts` contains no `useFakeTimers`/`testTimeout`/`setTimeout` (grep, zero hits) — consistent with design's "no fake timers expected", which the probe must still evidence.
  - Helpers `deferredCreate`/`insertAt` (lines 191-237) read as described: the create is held on a deferred promise that the test resolves via `act`.
- **AC coverage**:
  - AC1 (probe root cause, fixed wait vs unresolved promise) -> D1 + task 1.1/1.3; 1.3 requires an explicit confirmed/refuted line for each of the four driver-named hypotheses plus escaped XHR. Covered, with a concrete acceptance signal (`probe-evidence.md`).
  - AC2 (fix properly; timeout raise only if legitimately long, reason stated) -> D2 + 2.1/2.2: unresolved promise is fixed not timed out; timeout only per-case/shared constant, >= 2x worst loaded observation, inline measured reason; global `testTimeout` explicitly a non-goal. Covered.
  - AC3 (20+ green under nice with background load) -> D3 + 3.1. Covered.
  - AC4 (note PanelCard HEL-1215) -> D4 + 3.2, with escalate-if-same-cause. Covered.
- **Driver constraints** mirrored as C1-C4 in tasks.md and workflow-state.md CONSTRAINTS: test-side only / HEL-1354; <=3 niced burners, PID-file `kill` only, no pkill/pgrep/killall; no writes under `~`, no hook bypass, keep failing logs; no ci.yml/playwright.config.ts/.gitignore. D2 explicitly escalates a product-code fixed wait instead of fixing it. No contradiction found between proposal, design and tasks.
- **Placeholders**: none (no TODO/TBD; decision branches in D2 are concrete per classification, not deferrals).
- **Scope**: test file only (plus test helpers only if the probe proves the same cause, test-side). No API/schema change, so `skip_specs: true` is correct and no contract delta is owed.

### Verdict: CONFIRM

### Non-blocking notes

1. **Vacuous-green risk.** If the BEFORE runs (task 1.2) never fail under the recipe, "20 consecutive green" AFTER proves nothing by itself. D3 already says the comparison is on per-case margin to the 5000 ms timeout; task 3.1's verify line should be read as requiring the same per-case max-duration capture as 1.2 (not only a pass count), and the evidence should state plainly whether the recipe reproduced the red. The final gate will hold the change to that.
2. **Escaped-XHR attribution.** Mocking the leaking service is good hygiene but, as D2 says, it may only be claimed as the root cause if the probe's numbers show it (for example, an `open()` spy putting an XHR on case (b)'s critical path, or a duration delta). The probe should record each escaped URL and which test it fired in.
3. **Probe noise.** `nice -n 19` jest competing with `nice -n 19` burners gives equal-priority contention, as intended. Keep the recipe identical between BEFORE and AFTER (same burner count, same `--maxWorkers`, same file set), and set `npm_config_cache` to a project/scratch path before any `npx` so C3 holds.
4. **HEL-1354 overlap.** HEL-1354 may also edit this test file or its siblings when it changes boot cost. Expect a rebase conflict, not a design flaw. If a conflict comes up, it goes to the driver.
