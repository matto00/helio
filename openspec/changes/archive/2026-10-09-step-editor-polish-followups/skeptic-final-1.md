## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `a51f3125128649c1234fb51a88eefa78ea1507d6`. Diff base `428e1d2d4a61eca7d4d64bb57fe37fe0b21dc1c8`, resolved live with `resolve-review-base.sh` (exit 0). The only uncommitted file is the evaluator's `evaluation-1.md`.

### What I verified (with evidence)

**Spawn guard.** `assert-cwd.sh` returned `READY ambient=/home/matt/Development/helio branch=task/step-editor-polish-followups/HEL-1422`.

**AC1: fillnull error spacing.**
- In `FillNullConfig.tsx`, the root class changed from `pipeline-detail-page__dedupe-config` to `pipeline-detail-page__aggregate-config`.
- The old class had no CSS rule at all; grep finds only `PipelineDetailPage.css:1557` for `aggregate-config`. That explains the flush error.
- The new class is `flex column; gap: var(--space-5)`.
- I measured it in the running app myself, dark theme: root `rowGap` is 20px for all three editors, and the gap between the InlineError and its previous sibling is 20px in fillnull, window and pivot.
- Light theme: same layout, from a real `helio-theme=light` reload through ThemeProvider, not a dataset hack.
- Screenshots:
  - `/home/matt/Development/helio/.concertino/runs/HEL-1422/evidence/.concertino/runs/HEL-1422/evidence/skeptic-final-1-fillnull-422-dark.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1422/evidence/.concertino/runs/HEL-1422/evidence/skeptic-final-1-fillnull-422-light.png`
  - `/home/matt/Development/helio/.concertino/runs/HEL-1422/evidence/.concertino/runs/HEL-1422/evidence/skeptic-final-1-422-dark.png` (pivot)
- Fillnull now has the same section rhythm as window and pivot (Columns, then Strategy, then the error, 20px each). It reads as a sibling of those two editors and introduces no new CSS.

**AC2: keep and mark invalid.** The 422 here was INJECTED: I patched XHR in the page so a step PATCH returned 422 `{message}`.
- All three editors kept the chosen value (fillnull `mean`, window `rank`, pivot `first`).
- Each control had `aria-invalid="true"`, and its `aria-describedby` (`_r_a_`, `_r_c_`, `_r_e_`, unique per instance through `useId`) resolved to the InlineError holding the message.
- After I turned off the injection and made a real successful PATCH (fillnull `median` to `mean`), `aria-invalid` and `aria-describedby` were both null and no `.inline-error` remained.
- Code path: `useStepCardState.ts`. The flag is set only inside the `captureErrors && requestTokenRef.current === token` branch, together with `saveError`, as `isAxiosError(err) && err.response?.status === 422`. Both are reset together at the start of each attempt.
- The three editors gate the mark on `Boolean(saveError) && saveErrorIsValidation`.

**AC3: comment parity.**
- The `PivotStep.validateRawConfig` doc now matches `FillNullStep.scala:217-219` clause for clause.
- `validatePivot`'s inline comment matches `validateWindow`'s (`StepConfigValidation.scala:99`).
- The diff touches comments only.

**AC4: run-time order.** `WindowStep.apply` now checks an unsupported function, then the empty draft, then a missing field, then `enumProblems` (offset). That matches analyze (`fieldProblem.toVector ++ enumProblems`). I re-ran the tests: `sbt -J-Xmx3g "testOnly StepEnumWriteValidationSpec WindowStep*"` reported 18 succeeded, 0 failed, including the block `WindowStep.apply error order (HEL-1422)`.

**AC5: spec deltas.** All three op specs gain write-time and draft scenarios and the rejected-save scenario. Window also gets the two run-time order scenarios.

**Frontend tests.** I re-ran `npm --prefix frontend test -- --testPathPatterns="StepCard.enumSaveError|InlineError.test|FillNullConfig|WindowConfig|PivotConfig"`: 6 suites and 73 tests passed. For the full-suite, lint and typecheck gates I relied on the evaluator's run, which is explicit and per-gate in `evaluation-1.md`. The evaluator's red reproduction matches the committed red transcripts.

**Console.** The only error is the pre-existing 404 on `GET /api/pipelines/:id/schedule` for a pipeline with no schedule. It is unrelated to this diff.

**Reachability of the offset 422.** I checked whether a window 422 on `offset` could mark the wrong control (the function Select). `handleOffsetChange` only emits `parsed > 0`, so the editor cannot produce that 422 today. This agrees with design D2.

### Rulings on the evaluator's two deferred points

1. **`Select` has no visual invalid style. Acceptable for this ticket; not a REFUTE.**
   - AC2 specifies exactly `aria-invalid` plus `aria-describedby`, and both are delivered.
   - The visible signal is the intent-error InlineError directly under the control, 20px away. That satisfies DESIGN.md §7 ("visible, human-readable, intent-error styled").
   - The missing `[aria-invalid]` border is a gap in the shared `Select` component, not in this ticket. `.ui-input`/`.ui-textarea` have one (`inputs.css:55`) but `.ui-select` does not.
   - That gap already exists on every `ariaInvalid` Select caller: `FormFieldControl.tsx` ×4 and `FormFieldRow.tsx`, from HEL-1084.
   - Fixing it inside this ticket would change form-panel visuals, which is out of scope. It belongs in a follow-up that adds a `.ui-select__trigger[aria-invalid="true"]` rule mirroring the `inputs.css` recipe, in both themes.
2. **The "clears the mark" test passes without the flag reset. Not a defect.**
   - The mark is derived from `Boolean(saveError) && flag`, and both values are written in the same branch, so a stale `true` flag can never surface. The reset is redundant by construction, and the test correctly guards the observable AC behaviour.
   - If `setSaveError(null)` were dropped, the test would go red, because nothing on the success path clears the error.
   - A test isolating the flag reset would be testing unobservable state.

### Verdict: CONFIRM

### Non-blocking notes
- **Follow-up (recommended): shared `Select` invalid visual state.** Add it as described in ruling 1, and cover the form panel callers in the same change.
- **Follow-up (found during this review, pre-existing, unrelated to this diff): `POST /api/pipelines` leaks the inline root source when step validation fails.**
  - My first create attempt returned 422: `Step 's1': Invalid 'fillnull' config: 'value' must be a string`.
  - It still left the `data_sources` row `9557317c-81ae-4b60-ae77-d79e49b0db4c` ("hel1422 skeptic src", created 20:59:39 local) with no pipeline.
  - The single-call create is documented as transactional, so this is worth a bug ticket.
- **`WindowStep.scala:117-120`.** The unsupported-function and empty-function throws could merge into one check (the evaluator also noted this).
- **Executor test users.** The orchestrator should confirm the executor's two throwaway users (`hel1422-shots-1791602185640@…`, `hel1422-shots-1791602161697@…`) were deleted.
- **Persisted-ref layout.** `persist-evidence.sh` produces refs with a doubled path (`evidence/.concertino/runs/HEL-1422/evidence/...`). The files exist, but the layout looks like a Concertino path-join quirk worth an upstream look.

### Dev DB hygiene (this review)
- I created throwaway user `48d8106e-6fbf-4c53-949b-fd26032824a1` (`hel1422-skeptic-1791604778795@example.test`), pipeline `e2396a31-f4c5-43e7-9e80-2743e67fb81f` (steps `8f7d90a8-…`, `b167bd02-…`, `874de75d-…`), source `e7555cdf-9966-4487-9e85-d8608dfceea1`, and the leaked source `9557317c-81ae-4b60-ae77-d79e49b0db4c`.
- I deleted the pipeline and source `e7555cdf` through the API (204). I deleted the leaked source and the user by exact id in one transaction.
- A post-check count of all four ids returned 0.
