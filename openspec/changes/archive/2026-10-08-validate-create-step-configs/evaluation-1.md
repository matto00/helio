## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed commit: `892985c86799c167e99610d3e2464f8c4366e8ca` (single commit on branch)
Review base (live, `resolve-review-base.sh`): `2dd4ed6237817b1feef22d69f8bc8058e58541db`

### Phase 1: Spec Review — PASS
Issues: none

- AC1 (create/step add/update/proposal apply reject an invalid compute expression with 4xx naming the function and the
  supported list): single-call create now returns 422 `Step '<clientId>': compute: invalid expression: 'nosuchfn' is
  not a recognized function; supported functions: abs, ceil, ...` (verbatim companion message). Step routes and proposal
  apply already returned 422 (HEL-860/HEL-814); the proposal path gets a regression pin. The 400→422 premise
  correction is documented in ticket.md/design.md D2 and matches `pipeline-step-config-rejection`, so the AC is not
  silently reinterpreted.
- AC2 (all step kinds on single-call create): the check is in `buildStepsAction`'s fold, keyed on
  `PipelineStep.companionFor(spec.type)`, so it covers every registered kind. Tests cover compute, cast and aggregate.
- AC3 (legacy stored invalid steps): no read/analyze path is touched. The test `still list and analyze a legacy stored
  compute step` inserts the step via `stepRepo.insertInternal`, then lists it (200, 1 step) and analyzes it (200,
  `step-config-invalid`).
- AC4 / C4 (helio-news): I grepped `/home/matt/Development/helio-news` read-only myself. Every config it sends through
  `create_pipeline` (`news/projects/build.py:85-88` filter+aggregate, `news/enrichers/series.py:77-83` aggregate+sort,
  `news/enrichers/__init__.py:65` select) is pinned literally in `CreateStepConfigNonRegressionSpec`.
  `build_shape_pipeline` creates a bare pipeline with no `steps` and then goes through `add_outputs_from_shape`, so the
  create-path change never reaches it (`news/helio_client.py:256-265`).
- Tasks: all tasks are checked and match the diff. The patch-set resolver change (3.1a / design D4) is implemented as
  designed. Planning artifacts reflect the shipped behaviour, including the base-behaviour notes.
- Scope: two main-source hunks (+18/-2) and test files only. No scope creep.
- Constraints C1–C6: C1 holds (I ran `sbt testFull` and `testOnly` only). C3 holds (see the mutation evidence below).
  C4 holds (see above). C6 holds: no existing fixture was edited, and the only change to an existing test file is one
  added test in `PipelineApplyProposalSpec`. C2/C5 are not exercised by this diff: it touches no dev DB and adds no
  Playwright use.

### Phase 2: Code Review — PASS
Issues: none blocking

**Gates (my own fresh runs, in WORKTREE_PATH at 892985c8):**
- `cd backend && sbt testFull` (nice -n 19): **6252 run, 6252 succeeded, 0 failed, 4 canceled** (the pre-existing
  `HELIO_MEASURE=1` report-only perf probes). EXIT=0. All three new specs and the new `PipelineApplyProposalSpec` case
  ran and passed in this run.
- `npm run check:scala-quality`: clean. Only soft size warnings, none new in kind.
- `npm run format:check`: all files pass.
- Frontend gates (lint/test/build) were not triggered because no `frontend/**` file changed.

**Independent red-first / mutation verification (C3).** I did not rely on the executor's `red-keep.log`. I built a
throwaway detached worktree at 892985c8 under the session scratchpad and removed it afterwards
(`git worktree list` shows no straggler):
- Mutation A: reverted only the `PipelineService.buildStepsAction` hunk. All 3 single-call create rejection tests fail:
  compute `201 Created was not equal to 422` (spec L118), cast `400 Bad Request was not equal to 422` (L131),
  aggregate `201 Created was not equal to 422` (L144). The valid-shape, empty-draft, legacy, patch-set and proposal-pin
  tests stay green. That is expected: the proposal path is caught upstream by `validateSteps`, so it is correctly
  labelled a regression pin and not red-first.
- Mutation B: reverted only the `PatchSetApplyResolvers.resolvePipelineCreate` hunk. Both patch-set tests fail. Apply
  returns `Right(PatchSetApplyResponse(... rolledBack ..., failure = Some("Step 'calc': compute: invalid expression:
  'nosuchfn' ...")))`, i.e. HTTP 200 with `failure`, which shows the create-side backstop still catches it. Preview
  returns `Right(PatchSetPreviewResponse(...))`. The single-call create tests stay green.
- Result: each fix is independently necessary, and its tests fail without it and pass with it.

**Code review:**
- Ordering in `buildStepsAction` (`PipelineService.scala:557-566`) mirrors `addStepReporting` (type →
  `validateRawConfig` → tolerant decode). An unparseable config still reaches the decode branch, so it stays 400.
  Atomicity is kept by failing inside the transaction through `PipelineCreateValidationFailure`, and the tests assert
  that no pipeline persists.
- The resolver (`PatchSetApplyResolvers.scala:573-585`) only reports the step-config error after the existing roots
  pre-check passes. Unregistered kinds are skipped (`companionFor(...).toOption`), so an unknown type keeps its existing
  apply-time 400 path. The iterator plus `nextOption()` short-circuits on the first problem.
- No canonical [mechanical] violations: no inline FQNs, scala-quality is clean, and there are no new untyped escapes,
  dead code, TODOs or silent failures.
- The tests are meaningful: the mutations above prove they fail on a real regression. They also assert atomicity, the
  message content (clientId, function, supported list) and the edit index prefix.
- Security: there is no new input surface, and the change only adds validation at an existing boundary.

### Phase 3: UI Review — N/A
None of the Phase-3 trigger paths changed (`frontend/**`, `ApiRoutes.scala`, `schemas/**`, `openspec/specs/**`). The
only spec delta is under `openspec/changes/.../specs/`, and this is a backend-only change. I started no dev servers and
created no dev-DB residue.

### Overall: PASS

### Change Requests
none

### Non-blocking Suggestions
- `PipelineCreateStepConfigRoutesSpec.scala:145`: `should include("agg")` is weak because "agg" is a substring of
  "aggregate"/"aggregations", which appear in many messages. Assert `include("Step 'agg':")` and `include("bogus")`
  instead.
- DRY: the `PipelineStep.companionFor(k).toOption.flatMap(_.validateRawConfig(cfg.compactPrint))` idiom now appears at
  six sites (`PipelineService.scala:561,1840,2194`, `PatchSetApplyResolvers.scala:205,577`,
  `PipelineProposalService.scala:296`). Design D4 allowed either choice. A single
  `PipelineStep.rawConfigProblem(kind, config)` helper would be a good small follow-up.
- `PipelineService.scala:564` uses `rawConfigError.get` after `isDefined`. This matches the file's existing convention
  (L1846, L2196), but a `match` on the Option would remove the partial call.
- `PipelineService.scala` (2634 lines) and `PatchSetApplyResolvers.scala` (840) are far over CONTRIBUTING's ~400-line
  threshold. This is pre-existing (+9 lines here). Per CONTRIBUTING, propose a split in the PR description.
- Behaviour note for the PR body: on single-call create, a wrong-shape `cast` (`casts` array) moves from 400 (decode
  failure) to 422 (consistent with the step routes). This is intended by the spec, but it is a client-visible status
  change.
- Follow-up candidate (already in the Planner Notes): patch-set pipelineStep **create** edits still fail at forward
  apply (200 with `failure`) rather than at resolve time.
