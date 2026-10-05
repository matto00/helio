## Evaluation Report — Cycle 1 (evaluation-1.md)
Reviewed HEAD 52f86f959589c3f67eb05c9d4be95630e7cbeb01 against base 63a0b3ea.

### Phase 1: Spec Review — PASS
- Task 1.8 landed: schemas/shared/step-config-error-response.schema.json (5 required fields, const code, additionalProperties false).
- D2 table applied exactly; re-grep of IllegalArgumentException under domain/steps and domain/engine shows only table-listed data/reference/provider/source sites left plain. Window:143 -> IllegalStateException.
- C3 honored: private readTargetTolerant used only by UpsertSourceConfig.decode; UpsertTarget.format.read untouched. Live: create with absent name -> 422 "requires a string 'name'". UpsertSourceConfigSpec pins strictness.
- PipelineRunServiceSpec: only :505 changed (to StepConfigInvalid, message prefix and reason asserted); :920/:937/:976/:1009 untouched in diff. PipelineRunRoutesSpec untouched.
- message byte-identical (same see.getMessage; live body message matches the pre-change format).
- C1: GUARD tests at StepConfigInvalidRoutesSpec :216 and :232 are labelled and documented as green-on-main.
Issues: none.

### Phase 2: Code Review — PASS
Gates run fresh in WORKTREE_PATH: `nice -n 19 sbt testFull` 5646 passed / 0 failed; npm run lint, format:check, typecheck, npm test (417 suites / 4349 tests; root 36/353), frontend build all clean.
Mutation re-run myself (throwaway detached worktree, removed): isStepConfigError := cause.isInstanceOf[IllegalArgumentException] -> 5 failures across StepConfigInvalidRoutesSpec and StepConfigErrorClassificationSpec (plain-IAE-false, nested pass-through, datebucket engine guard, both route GUARDs). Mutation is therefore failable and the 3.4 guards go red under it.
Red-on-main: not re-run (new specs reference StepConfigError and cannot compile on main); relied on the executor's record.
Issues: none.

### Phase 3: UI Review — PASS
Live on ports 6579/9486 (process cwds verified as this worktree): GET preview of upsertsource with empty target.name -> 422 body {code:STEP_CONFIG_INVALID, message (unchanged generic text), reason, stepId, stepKind}. Backend log: single WARN "previewStep failed ... invalid step configuration ...", zero stack frames, no ERROR. Tray rendering (reason only, no UUID/path; upstream attribution) verified via StepCard.test.tsx assertions rather than a browser screenshot; fallback "Preview failed — try again." tests still green.
Issues: none.

### Overall: PASS

### Non-blocking Suggestions
- Live browser check of the tray was not performed (covered by component tests).

### Housekeeping
Shared dev DB: created pipeline 4ceaf7ac-2f3b-4aac-9022-ad8bc4f1163c (with step c6e13996-4476-425e-acd6-0a2e0e07f6e3); deleted by exact id (204, then 404). Servers (pids 1773397, 1773772) killed by exact PID. Mutation worktree removed.
