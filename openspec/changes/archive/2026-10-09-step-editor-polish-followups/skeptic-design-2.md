## Skeptic Report — design gate (round 2, skeptic-design-2.md)

Reviewed at HEAD 428e1d2d4a61eca7d4d64bb57fe37fe0b21dc1c8 (equal to origin/main; no implementation commits yet). The spawn-cwd guard printed READY.

### What I verified (with evidence)

**Prior CR1 (dead window offset-marking branch): fixed in substance, not just reworded.**
- design.md D2 now says window marks the function `Select` and states "There is no offset branch". The reason it gives is correct.
- Checked against ground truth:
  - `stepNarrowing.ts:717` reads `offset: typeof cfg.offset === "number" && cfg.offset > 0 ? cfg.offset : 1`.
  - `WindowConfig.handleOffsetChange` (:97-102) emits only when `parsed > 0`.
- The pipeline-window-op delta has no offset-marking requirement or scenario left. The requirement and the scenario both name the function control.
- tasks.md 2.3 and 2.4 mark only the enum Select for each kind. The only remaining offset work is the backend run-order tests (1.1).

**Prior CR2 (how the 422 is provoked, and what the marking guards): fixed.**
- D2 adds a subsection saying no 422 is reachable today, and gives three reasons. I checked each one:
  1. The enum lists are identical. FE `FILL_NULL_STRATEGIES` matches `FillNullStep.SupportedStrategies` (:82). `PIVOT_AGG_FNS` matches `PivotStep.SupportedAggs` (:78). `WINDOW_FUNCTIONS` matches `WindowStep.SupportedFunctions`.
  2. Narrowing coerces invalid stored values.
  3. Write-time checks are enum, offset and the `super.validateRawConfig` shape check only.
- D2 calls the marking drift defence-in-depth and says the PR must state this.
- Risks and task 3.2 name Playwright `page.route` on the step PATCH returning 422 `{message}`, and require the evidence to say the 422 was injected.

**The rest of the design, checked on its own merits:**
- **D1:** `pipeline-detail-page__dedupe-config` has no CSS rule; only DedupeConfig and FillNullConfig reference it. `.pipeline-detail-page__aggregate-config` at `PipelineDetailPage.css:1557` is `flex column; gap: var(--space-5)`, and Window and Pivot already use it. Switching FillNullConfig's root class is the smallest token-compliant fix, and it leaves DedupeConfig untouched as a declared non-goal.
- **D2 precedent:**
  - The keep-intent comment exists at `hooks/useStepCardState.ts:311-312`. The design cites it without the `hooks/` directory, which is harmless.
  - `persist` clears `saveError` at the start of each attempt (:289), so "the mark clears on the next save attempt" has a real reset point. The rejection path is guarded by `requestTokenRef` (:303).
  - `Select` exposes `ariaInvalid`/`ariaDescribedBy` (Select.tsx:28-33, 178-179). AggregateConfig uses the `useId` `idBase` pattern (:93).
  - `InlineError`'s text variant currently renders a bare `<p className="inline-error">` with no `id`. The optional-`id` addition is needed, and it is additive.
  - Marking only on a 422 (not on network/5xx errors) is a sound distinction.
- **D4:**
  - Current `WindowStep.apply` runs `enumProblems` first, so offset is checked before field.
  - The pre-HEL-1416 version (`ce6991111^`) checked unsupported function, then field, then offset.
  - Analyze (`StepConfigValidation.validateWindow`) returns `fieldProblem.toVector ++ enumProblems`.
  - The reorder is therefore restoring the original order, matches analyze, and keeps `enumProblems` unchanged for write time and analyze.
  - Task 1.1(c) pins unsupported-function-first. 1.1(d) pins that the offset error still fires.
- **D3:** comment-only. `PivotStep.validateRawConfig` is at :166-167, and `validatePivot`'s inline comment differs in form from `validateWindow`'s (:99). The premise holds.
- **Spec deltas:** the "draft stays saveable" claims match the code. Each `*Problem` rule rejects only a non-empty unsupported value. FillNull's `constant` with no value is a run-time error only. Window's missing field is not in `enumProblems`.
- **AC coverage:** AC1 maps to 3.1/3.2, AC2 to 2.1-2.4, AC3 to 1.3, AC4 to 1.1/1.2, AC5 to the spec deltas. I found no scope drift and no contract/schema change, so no schema delta is needed. Red-first (C4) is required for the new behaviour tests.
- **Placeholders:** none blocking. "(name may vary)" for the `saveErrorIsValidation` flag is a naming latitude, not a deferred decision.

### Verdict: CONFIRM

### Non-blocking notes
- `WindowStep.apply`'s inline comment "Non-positive offsets were refused by `enumProblems` above" and the `enumProblems` doc "Shared by ... `apply`" both stay true after the reorder, as long as `enumProblems` still runs (after the field check). The executor should make sure the comments still describe the new order.
- Only the fillnull delta has the "non-validation failure does not mark invalid" scenario. Task 2.4 already requires the non-422 assertion. Adding it to window and pivot is optional symmetry.
- `useStepCardState.ts` lives under `features/pipelines/hooks/`, not `ui/`. The design's path citations omit the directory.
- `saveError` is also used by UpsertSourceConfig. The new 422 flag should be additive and leave upsertsource's rendering unchanged.
