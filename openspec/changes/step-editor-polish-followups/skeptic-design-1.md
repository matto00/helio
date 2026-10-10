## Skeptic Report — design gate (round 1, skeptic-design-1.md)

Reviewed tree: worktree HEAD 428e1d2d4a61eca7d4d64bb57fe37fe0b21dc1c8 (= origin/main; change dir untracked).

### What I verified (with evidence)

- **D1 (item 1), CONFIRMED.** `pipeline-detail-page__dedupe-config` has no CSS rule anywhere under `frontend/`. The only hits are the className uses at `FillNullConfig.tsx:62` and `DedupeConfig.tsx:35`, and no test selects on it. `PipelineDetailPage.css:1557-1561` is `.pipeline-detail-page__aggregate-config { display:flex; flex-direction:column; gap: var(--space-5) }`. WindowConfig and PivotConfig both use that root class. Swapping the class is the minimal tokenized fix, and it leaves DedupeConfig untouched.
- **D4 (item 4), CONFIRMED.** At `ce6991111^:WindowStep.scala` the order was: unsupported function, then the `FieldRequired` field `getOrElse(throw ...)`, then `offset <= 0`. Today `WindowStep.scala:114` throws `enumProblems` (including the offset) before the field check at :118-122. `StepConfigValidation.validateWindow` (:102-106) is `fieldProblem.toVector ++ WindowStep.enumProblems(cfg)`, so it reports field first. The planned reorder is correct and stays inside the ticket. Note: the comment at `WindowStep.scala:126` ("Non-positive offsets were refused by `enumProblems` above") must stay true after the reorder.
- **D3 (item 3), CONFIRMED.** The FillNullStep doc at :217-219 includes the decode-failure and short-circuit clauses, while the PivotStep doc at :164-165 omits them. `StepConfigValidation:124` (pivot) is worded differently from :88 and :99. The task correctly requires each clause to be verified against the code.
- **D2 precedent (item 2): it decides the question, so no escalation is needed.** The ticket itself hands the choice to the implementer ("pick one per DESIGN.md form-error pattern"). The keep-intent behaviour exists at `useStepCardState.ts:311-312`. AggregateConfig uses `FormField errorId` with `aria-invalid`/`aria-describedby` on the field (`AggregateConfig.tsx:267-283`). `Select` exposes `ariaInvalid`/`ariaDescribedBy` (`Select.tsx:25-35,178-179`). DESIGN.md §6 names `FormField` (which carries `errorId`) as "the one form-row recipe". Together these clearly favour keeping the value and marking it invalid; a revert would be the outlier. The 422-only marking is sound: a network error or 5xx says nothing about the value.
- **Reachability of a 422 from these editors (checked from ground truth):**
  - The frontend and backend enum lists are identical:
    - `FILL_NULL_STRATEGIES` = `FillNullStep.SupportedStrategies` (:82)
    - `PIVOT_AGG_FNS` = `PivotStep.SupportedAggs` (:78)
    - `WINDOW_FUNCTIONS` = `WindowStep.SupportedFunctions` (:95)
  - The narrowing functions coerce any stored invalid value to a valid default on read: `fillNullConfigOf` :661, `pivotConfigOf` :621, and `windowConfigOf` :708 and :717 (offset becomes 1 when it is not > 0).
  - `WindowConfig.handleOffsetChange` only emits `parsed > 0`.
  - `onWindowChange` persists `newConfig.offset`, which is therefore always >= 1.
  - Write-time `validateRawConfig` checks only strict-decode type mismatches plus these enums. `requiredConfigProblems` (pivot column/values, window outputColumn) is run-time and analyze only (`InProcessPipelineEngine.scala:269`, `StepConfigValidation.scala:62`), not write-time.
  - **Conclusion:** none of the three editors can produce a 422 today. The rejected-save path is reachable only if the frontend and backend enum lists drift apart. On top of that, the **window offset branch can never be reached, even in a drift scenario.**
- **Scope:** the ACs in ticket.md were written by the planner. Linear has no ACs, only the five items. AC1–AC5 map one-to-one onto items 1–5 with no drift. No API, schema or wire change is involved, so no contract delta is needed. The spec deltas are ADDED-only, and none contradicts the existing `pipeline-{window,fillnull,pivot}-op` requirements.

### Verdict: REFUTE

### Change Requests

1. **Remove the window offset-marking branch. It is unreachable.** As written, it is speculative code backed by a SHALL that cannot be tested honestly.
   - `windowConfigOf` (`stepNarrowing.ts:717`) clamps a stored offset that is not > 0 to 1.
   - `WindowConfig.handleOffsetChange` drops any value <= 0.
   - `onWindowChange` persists `newConfig.offset`.
   - So the editor's `config.offset` is never <= 0 and the client never sends one. The spec wording "keeps the entered offset" describes something the input cannot do.
   - The only way to satisfy task 2.4's "offset ≤ 0 marks the offset input" is to render WindowConfig with a state the app never produces. That is evidence-shaped non-evidence.

   Revise:
   - design.md D2: window marks the function `Select`, the same as the other two.
   - The pipeline-window-op delta: drop the "offset input SHALL be marked..." sentence in the requirement and drop the scenario "Rejected offset marks the offset input invalid". Replace them with a function-control scenario.
   - tasks.md 2.3 and 2.4: drop the offset-TextField marking and the "offset ≤ 0 marks the offset input" assertion.

   If you believe a real path exists where the client sends `offset <= 0`, cite it with file:line instead.

2. **Say how a rejected save is provoked, and say what the marking actually guards.** As established above, the running app cannot produce this 422 today, yet AC1 ("verified in the running app in both themes") and task 3.2 ("before/after screenshots ... showing a rejected-save error") both need the error to be on screen. Without a named method, the executor and evaluator have no honest acceptance signal. Revise:
   - Design: add a sentence stating that a 422 from these three editors is reachable only through frontend/backend enum drift (the lists are identical today, and narrowing coerces stored values), so the marking is a drift guard.
   - Task 3.2 and AC1's verification note: name the mechanism used to provoke the error in the running app. For example, Playwright `page.route` intercepting the step-config PATCH and returning `422 {"message": ...}`. Require the evidence to disclose that the response was injected.
   - The jest tests (2.4) already mock `updatePipelineStep`, which is fine.

### Non-blocking notes

- D2 says "DESIGN.md has no form-error section". DESIGN.md §6 does name `FormField` (label, control, help and error, with `errorId`) as the one form-row recipe. Cite it as further support. The conclusion does not change, and moving the trailing InlineError into a per-control `FormField` is not required here.
- D4 implementation: `enumProblems` checks the unsupported function first and the offset second. After the reorder, `apply` needs either an explicit unsupported-function check before the field check, or `enumProblems` called after it. Either way, keep test 1.1(c) (unsupported function with no field gives the unsupported error), as already planned.
- The `saveError` state is shared by the upsertsource call site (`StepOpEditor.tsx:322`). The new validation flag only needs to be consumed by the three editors.
