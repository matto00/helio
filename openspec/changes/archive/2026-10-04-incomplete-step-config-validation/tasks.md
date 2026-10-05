## Standing Constraints

- [C1] Task 3.4 tests are GUARDS (green on main), labelled as such; their proof is a "classify any IAE as config" mutation turning them red.
- [C2] Every D2 "config" row is covered by one parametrised engine-level test asserting `isStepConfigError`; the 3.9 row-revert mutation names the row it reverts.
- [C3] D7 tolerance lives in a private decode-only target reader used by `UpsertSourceConfig.decode`; `UpsertTarget.format.read` (write path, wire protocol, DataSourceReferenceRepository) stays strict.

## 1. Backend

### Backend

- [x] 1.1 Add `StepConfigError extends IllegalArgumentException`; re-parent `StepConfigTypeMismatch`; engine requiredConfigProblems branch throws it (verify: engine spec)
- [x] 1.2 Add `StepExecutionException.isStepConfigError` (true iff cause is `StepConfigError`; nested SEE keeps its flag)
- [x] 1.3 Apply design.md D2 table: config rows → `StepConfigError`, Window:143 → `IllegalStateException`, others untouched; re-grep and report any unlisted site before changing it
- [x] 1.4 D7: tolerant read decode maps newSource with absent/non-string `name` to `NewSource("")`; write-path `validateRawConfig` unchanged (verify: create still 422)
- [x] 1.5 Add `ServiceError.StepConfigInvalid` + `StepConfigErrorResponse` JsonFormat; `statusCodeFor` → 422; explicit `completeError` arm emitting the structured body
- [x] 1.6 One log helper in `PipelineRunService` (WARN no throwable for config, ERROR+stack otherwise) at both previewAtNode arms, `executeRunFailure`, both backfill sites
- [x] 1.7 Return `StepConfigInvalid` from both previewAtNode arms and `executeRunFailure` only when `isStepConfigError`; persisted/SSE text unchanged
- [x] 1.8 Add the body schema under `schemas/` (pattern: `shared/field-validation-error-response.schema.json`)

## 2. Frontend

### Frontend

- [x] 2.1 `useStepCardPreview`: `reason` for own step, "Upstream <kind> step is not fully configured: <reason>" for ancestor; existing fallback otherwise
- [x] 2.2 `outputsSlice` preview error extraction prefers `reason` for `STEP_CONFIG_INVALID`

## 3. Tests

### Tests

- [x] 3.1 Route: upsertsource preview with `name: ""` and whitespace → 422 with all five body fields; `message` byte-identical to pre-change format
- [x] 3.2 Route: create with absent `name` → 422, no ERROR log event; stored absent-name row (inserted bypassing write validation) → step list 200 and preview named 422 (red on main first, record the observed main behaviour)
- [x] 3.3 Route: ancestor compute (empty `column`) previewed via child → `stepId` is the ancestor; fillnull constant w/o value → `stepKind` fillnull; Output preview and dry run return the named body
- [x] 3.4 Negative: datebucket with unparsable data and an AI step `fail()` (ai-error, stubbed client) → unnamed 422 as before and ERROR with throwable
- [x] 3.5 Log capture (ListAppender, `ApiRoutesCorsErrorHandlingSpec.scala:224` pattern): config preview and run → no ERROR, one WARN without throwable
- [x] 3.6 Engine unit (parametrised over every D2 config row, per C2): `isStepConfigError` true for `StepConfigError`, false for plain IAE and non-IAE, nested pass-through keeps the flag (behavioural, not compile-only)
- [x] 3.7 Classify `PipelineRunServiceSpec.scala:505, :920, :937, :976, :1009`; update only D2-config ones to `StepConfigInvalid` (message asserted unchanged), reason in report; `PipelineRunRoutesSpec` `startWith` pins untouched and green
- [x] 3.8 Frontend: StepCard/useStepCardPreview own-step and upstream rendering, no UUID in tray; "Preview failed — try again." fallback tests still green
- [x] 3.9 Red-before-green + mutations (flag always false; helper back to `log.error`; a D2 row reverted to plain IAE) each turning a named test red; gates `nice -n 19 sbt testFull`, frontend lint/typecheck/test
