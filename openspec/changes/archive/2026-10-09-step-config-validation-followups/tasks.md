## Standing Constraints

## 1. Backend

### Backend
- [x] 1.1 Add `PipelineStep.rawConfigProblem(kind, raw)` next to `companionFor`; verify it compiles (`nice -n 19 sbt -J-Xmx3g compile`).
- [x] 1.2 Route the six `companionFor(...).toOption.flatMap(_.validateRawConfig(...))` sites through it (design D2); verify `git grep` finds zero remaining copies outside the helper and StepConfigValidation.
- [x] 1.3 `resolvePipelineStepCreate`: strict check after decode, before `authorizeSecondSourceForCreate`, 422 `edit N: <msg>` (D1); verify via 3.1.
- [x] 1.4 `ColumnSchemaInference.inferCompute`: `type` optional, fallback `"string"` (D3); verify via 3.3.
- [x] 1.5 Widen `openspec/specs/pipeline-step-config-rejection/spec.md` Purpose, and add patch-set step-create edits to the HEL-1416 requirement's surface list (l.198-202) (D4); verify `openspec validate --specs` passes.

## 2. Frontend

### Frontend
- [x] 2.1 No code change; grep frontend/ and helio-mcp/ callers of patch-set apply/preview for 422 handling and record findings in files-modified.md / PR body.

## 3. Tests

### Tests
- [x] 3.1 Route-level red-first spec (PatchSetRoutes apply + PatchSetPreviewRoutes preview): step-create edit with `nosuchfn` → 422 `edit 1:` naming `nosuchfn`, earlier edit not applied, no step created; valid create still applies. Record the RED run on the whole pre-fix tree.
- [x] 3.2 Mutation check for 1.2: helper returns `None` → HEL-860/1402/1416 suites go red; restore; record both runs.
- [x] 3.3 Analyze red-first: compute without `type` + valid expression → no validationError, inferred type; unknown field → specific message, `string` column; with-`type` behaviour unchanged.
- [x] 3.4 Tighten `PipelineCreateStepConfigRoutesSpec` aggregate case to assert `Step 'agg':` and `bogus`; show it fails if the prefix is dropped (mutation) then restore.
- [x] 3.5 Full gates: `nice -n 19 sbt -J-Xmx3g testFull`, pre-commit hooks; check `free -g` (≥15 GB) before commit.
