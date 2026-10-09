## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `bf65f66f369f936a2e3456c9cf83bb535d950a62`. Diff base: resolved live with `resolve-review-base.sh` as `3d63a1751bcfd09595943ce390f8f10678e44e49`.

origin/main is now `b0ff8570`, 2 commits ahead of the base (HEL-1281 schema wording, HEL-1413 e2e/grid). Neither touches files in this diff, and neither adds a migration. `git merge-tree HEAD origin/main` merges cleanly.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` printed `READY ambient=/home/matt/Development/helio branch=feature/reject-invalid-step-enums/HEL-1416`.

**AC trace (source read at HEAD):**
- **Every write path rejects.**
  - The `validateRawConfig` overrides are at `FillNullStep.scala:220`, `WindowStep.scala:281` and `PivotStep.scala:166`. Each is `super.validateRawConfig(raw).orElse(Try(decode).toOption.flatMap(rule))`.
  - The call sites reached by the overrides, confirmed by grep: `PipelineService.scala:561` (single-call create), `:1853` (step create), `:2207` (step update), `PipelineProposalService.scala:296`, and `PatchSetApplyResolvers.scala:205` and `:578`.
- **Drafts stay saveable (HEL-814 D2).**
  - Each rule fires only on a non-empty unknown value. For window it also fires on a lag/lead with an explicit offset <= 0.
  - `""` and absent keys pass. Covered by `StepEnumWriteValidationSpec` and the route specs' draft-201 cases.
- **Legacy stored invalid configs still read and analyze.**
  - No read path was touched.
  - `PipelineCreateStepConfigRoutesSpec` "still list and analyze a legacy stored fillnull step…" inserts `average` through the repo. It asserts the list returns 200 and analyze returns the single exact message. That proves no `"; "` duplication.
- **Analyze and run share one rule.**
  - `PipelineAnalyzeService.validateFillNull/Window/Pivot` and each `apply` call the shared `strategyProblem` / `enumProblems` / `aggProblem`.
  - The leftover second branches are now limited to the empty value.
- **helio-news.** A read-only grep of `/home/matt/Development/helio-news` for fillnull, pivot or a window step type found 0 hits. Nothing in it is newly rejected.
  - In-repo producer: `PivotMatrixShape.scala:111,118` emits `agg = "first"`, which is valid.
  - `helio-mcp/src/tools/write.ts:393,413` documents only supported values.
- **The frontend surfaces the 422 for each kind.**
  - `useStepCardState.ts` passes `captureErrors=true` from `onPivotChange`, `onWindowChange` and `onFillNullChange`.
  - `StepOpEditor.tsx` passes `saveError` to the three editors.
  - Each editor renders the shared `InlineError`, the same element `UpsertSourceConfig.tsx:192` uses.

**Backend gates, run by me:**
- In WORKTREE_PATH: `nice -n 19 sbt "testOnly PipelineStepRoutesSpec PipelineCreateStepConfigRoutesSpec PipelineAnalyzeRoutesSpec PatchSetApplyServiceSpec PatchSetPipelineCreateStepConfigSpec StepEnumWriteValidationSpec *CreateStepConfigNonRegressionSpec"`.
  - Result: `Suites: completed 7 … Tests: succeeded 204, failed 0`. Every HEL-1416 case is listed as passing.
- In a scratch export of HEAD's `backend/`: `StepEnumWriteValidationSpec`, `PipelineStepRequiredConfigSpec` and `PipelineProposalServiceValidateSpec` gave 55/55 passed.
- I did not re-run the full `testFull`. For that I rely on the evaluator's reported 6344/0/4-canceled, which is consistent with the subsets I ran.

**C1 red-first, backend, run by me rather than traced:**
- In the scratch copy I restored the four `backend/src/main` files to base `3d63a175` and kept HEAD's tests.
- **7 FAILED**, all from the new tests:
  - every `validateRawConfig` rejection case in `StepEnumWriteValidationSpec`;
  - the new "report only the enum failure (once)" test in `PipelineStepRequiredConfigSpec`;
  - the HEL-1416 case in `PipelineProposalServiceValidateSpec`.
- The DB route specs were not red-run. Their only mechanism is the companion override, which the unit red run shows was absent at base.

**C1 shared-rule mutation of SOURCE (the evaluator traced this but did not run it):**
- I mutated the three shared rules in source and kept the tests unchanged:
  - `FillNullStep.strategyProblem` was changed to `if (false && …)`;
  - `PivotStep.aggProblem` was changed to `if (false && …)`;
  - `WindowStep.enumProblems` offset check was changed from `<= 0` to `< 0`.
- Result: **7 FAILED**. The failures span the write, analyze and apply layers:
  - write: the validateRawConfig rejections;
  - analyze: "report each invalid value exactly once";
  - apply: "still refuse unknown values with the same message";
  - plus the proposal surface.
- So the shared rule is load-bearing on all three layers, as design D1 requires.

**C1 red-first, frontend, run by me:**
- In a scratch export of HEAD's `frontend/`, I restored base `3d63a175` versions of the five changed non-test sources: `useStepCardState.ts`, `StepOpEditor.tsx`, `FillNullConfig.tsx`, `PivotConfig.tsx` and `WindowConfig.tsx`.
  - `StepCard.enumSaveError.test.tsx` gave **4 failed / 4**.
  - On HEAD, the stepConfigs plus StepCard tests gave 296/296 passed.
  - One suite, `JoinConfig.seam.test.tsx`, could not run in the scratch copy because `shared-test-fixtures` was not exported. That is an artifact of my copy, not a defect in this change.
- Guards (task 3.7):
  - The new `FillNullConfig.test.tsx` GUARD was shown failable by a source mutation in evaluation-1.
  - The pre-existing window and pivot option guards and the offset-0 guard exist at `WindowConfig.test.tsx:64-66`, `:261` and `PivotConfig.test.tsx:63`.

**UI / design judgment:**
- Servers: `start-servers.sh` reused the healthy servers, then `assert-phase.sh servers` printed `PASS servers`.
- **Isolation:** the shared MCP browser was logged in as another lane's user (`eval-hel1408-c1-…`), so I did not touch it. I used my own headless Playwright context with a fresh user per theme. That avoided the parallel-Playwright cookie clobber.
- **Method:**
  - I used the `ops` template pipeline plus one fillnull, one window and one pivot step created through the API.
  - A route hook rewrote each outgoing config PATCH to an invalid enum, so the **real backend returned real 422s**. The captured responses were 422 with the exact shared messages for all 3 kinds, in both themes.
- **Screenshots, persisted:**
  - `/home/matt/Development/helio/.concertino/runs/HEL-1416/evidence/.playwright-mcp/skeptic-hel1416/skeptic-hel1416-{fillnull,window,pivot}-422-{light,dark}.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1416/evidence/.playwright-mcp/skeptic-hel1416/skeptic-hel1416-page-{light,dark}.png`
- **Judgment:**
  - The message renders as the shared `p.inline-error` with token colors: light `rgb(175,51,37)`, dark `rgb(241,123,103)`, 12px.
  - It sits directly above the card's Preview/Remove actions, the same treatment and color as the analyze `validationError` line at the top of the same card.
  - No new styling and no one-off component. Light and dark match.
  - The text wraps inside the card at 1440 px.
- **Console:** the only errors are the three intended 422 resource logs and one 404, the pre-existing `/schedule` 404 for a pipeline with no schedule. There were no page errors.

### Verdict: CONFIRM

### Non-blocking notes
- In `FillNullConfig` the error line sits flush under the Strategy select, with no gap, while Window and Pivot show a visible gap. This follows each editor's existing internal spacing, not a new divergence. Cosmetic only.
- After a rejected save, the editor keeps showing the user's choice while the server keeps the old config. This is pre-existing local-state-reflects-intent behavior, the same as upsertsource. The visible error makes the mismatch discoverable.
- The branch is 2 commits behind origin/main, with no overlap and a clean merge. Squash/rebase as usual.
- Run-time error order changed: `WindowStep.apply` now raises a lag/lead offset error before `requires 'field'`. This only affects already-invalid configs, as the evaluator noted.

### Skeptic side effects (dev-DB residue, by exact id)
- User `815eda2e-39e4-4eca-89c5-a8a27843855c` (skeptic-hel1416-light-1791510222415@example.test). The first attempt hit the CSRF 403, so no other rows were created.
- User `6a6d0a9e-423a-43a1-8ef8-1a4ca6ed71e8` (skeptic-hel1416-light-1791510237465@example.test):
  - ops template dashboard `02d6d4f5-e868-4afd-aec2-95907456d3b5`, pipeline `5e6fa950-b35b-4e6d-a0d0-ff2636376fe6`, source `e6724ba4-7c94-4681-93f2-b8e6a2ce5fdc`;
  - added steps `80df02cf-d02f-4a8b-921f-db23ea7330ce` (fillnull), `415d1207-be4a-458c-9c85-169ec50303ca` (window), `77a910e1-ef05-4f2a-b5ac-4007a107729d` (pivot).
- User `fe942310-7874-41d3-b170-f3d482176b7e` (skeptic-hel1416-dark-1791510257368@example.test):
  - dashboard `cd1956a0-514c-4466-ad11-b30d416f64c2`, pipeline `7b3130e8-c428-4a4b-b16b-d00c46a90022`, source `43930c32-3739-4819-a70e-6c4a7f9cfc15`;
  - steps `74d5c463-781d-4b49-81c7-78445cda30af` (fillnull), `6a453b64-25ca-4bef-a33f-9df0c09afd67` (window), `60a0d8a0-0f04-4a52-8846-d0c468b077f3` (pivot).
- Every rewritten PATCH returned 422, so no invalid config was persisted.
- `sbt testOnly` in WORKTREE_PATH ran DB route specs, which create and clean their own test rows as usual.
