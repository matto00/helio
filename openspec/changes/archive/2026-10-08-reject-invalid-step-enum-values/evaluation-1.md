## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `11fcd5614aba724c2db121f4a3b115959fb29ff8`. Diff base resolved live: `3d63a1751bcfd09595943ce390f8f10678e44e49`.
origin/main is one commit ahead (96f2ae97, HEL-1413: e2e and DesktopPanelGrid only, no migration), so it does not overlap this change and the dev DB stays at V118.

### Phase 1: Spec Review — FAIL

- All AC behaviors are implemented, and I confirmed each one against the live backend (BACKEND_PORT 9755):
  - REST step create returns 422 for `average`, `ntile`, `lead` with offset -2, and `median`, each with the exact run/analyze message.
  - The four drafts return 201: constant with no value, lag with no field, row_number with offset 0, and pivot with no agg.
  - Patch-set pipeline-create edits return 422 for fillnull, window and pivot, on both `/patch-sets/preview` and `/patch-sets/apply`. Each message is `edit 0: Step 's1': <message>` and no pipeline is created.
  - A legacy row set to `strategy:"average"` through SQL still lists, and analyze reports it exactly once.
- helio-news read-only grep: no fillnull, window or pivot step anywhere. Nothing is newly rejected, so no escalation.
- The 2 rewritten fixtures are a design-accepted behavior change, not a defect being hidden:
  - The fixtures are `PipelineAnalyzeRoutesSpec` (around line 528) and `PipelineStepRequiredConfigSpec` (around line 259).
  - design.md Risks (bullet 4) explicitly accepts that analyze shows only the enum problem and hides siblings, as HEL-1310 did. Both now use 2 draft failures, so the HEL-860 multi-failure join is still tested.
  - The new short-circuit behavior is pinned positively by a new test: "report only the enum failure (once) … (HEL-1416)", which asserts `bogus_fn` is present and `outputColumn` is absent.
  - My full `sbt testFull` run is green, including both rewritten specs.
- CON C1 (red-first, source-mutation guards): honored where I could check.
  - In a throwaway detached worktree, base-commit frontend source plus the new `StepCard.enumSaveError.test.tsx` gave 4 of 4 failing; HEAD source gave 4 of 4 passing.
  - Adding `"average"` to `FILL_NULL_STRATEGIES` in FillNullConfig.tsx (source) made the new GUARD fail (1 failed of 10).
  - The window and pivot option guards and the `parsed > 0` offset guard already existed (WindowConfig.test.tsx:66 and :261, PivotConfig.test.tsx:63).
  - Backend red-first was checked by reasoning, not by a mutation run. At base, none of the three companions overrides `validateRawConfig`, and the shared shape check accepts any string enum, so every "reject" case in `StepEnumWriteValidationSpec` would return None and fail.
- **Issue P1-1: task 3.4 is marked [x] but is not fully implemented.**
  - 3.4 requires "patch-set step-update **and pipeline-create edits**: 422/rejection for **one invalid case per kind**".
  - The diff adds no pipeline-create-edit case. `PatchSetPipelineCreateStepConfigSpec` was not touched.
  - The patch-set step-update case covers only `pivot`. fillnull and window are not covered.
  - The behavior itself is correct (shown live above). The test coverage and the checked-off task do not match. See CR1.
- **Issue P1-2: design D1 / proposal "Each rule is ONE shared function per kind, called by validateRawConfig, the analyze validator and apply" is only met in name for the enum membership check.** See CR2.

### Phase 2: Code Review — FAIL

Gates, run fresh by me in WORKTREE_PATH:
- `npm run lint`: clean, 0 warnings.
- `npm run format:check`: all files formatted.
- `npm run typecheck`: clean.
- `npm test`: 477 suites and 5023 tests passed, plus the helio-mcp 42 suites and 407 tests.
- `npm --prefix frontend run build`: OK.
- `cd backend && nice -n 19 sbt testFull`: **6343 succeeded, 0 failed, 4 canceled** (the report-only perf measurements gated on HELIO_MEASURE). `StepEnumWriteValidationSpec`, `CreateStepConfigNonRegressionSpec`, `PipelineStepRequiredConfigSpec`, `PipelineAnalyzeRoutesSpec` and `PatchSetPipelineCreateStepConfigSpec` all ran and passed. This is the full re-run the executor did not do after its fixture rewrite.

Issues:
- **CR2 (readability and DRY, a design D1 divergence):** in `apply` and in analyze, the call to the "shared rule" is redundant. A second, full membership check sits right after it and catches every unsupported value, not only the empty draft. Its `// empty draft` comment is therefore wrong. The membership rule still lives in three places, so a change to `strategyProblem`, `enumProblems` or `aggProblem` would not affect run or analyze for a non-empty unknown value.
  - `FillNullStep.scala` (apply): `strategyProblem(cfg).foreach(throw)` is followed by `if (!SupportedStrategies.contains(cfg.strategy)) // empty draft`. The second check is not empty-only.
  - `PivotStep.scala` (apply): same pattern with `aggProblem` and `!SupportedAggs.contains(cfg.agg) // empty draft`.
  - `WindowStep.scala` (apply): same pattern for the function check after `enumProblems(...).headOption`.
  - `PipelineAnalyzeService.scala` validateFillNull (around line 410): `FillNullStep.strategyProblem(cfg).getOrElse(FillNullStep.unsupportedStrategyMessage(cfg.strategy))` always equals `unsupportedStrategyMessage(cfg.strategy)`.
  - `PipelineAnalyzeService.scala` validatePivot (around line 446): same pattern.
  - The rest looks good. The overrides follow the HEL-1310 `super.validateRawConfig(raw).orElse(Try(decode)...)` pattern. Messages are shared through the new `unsupported*Message` helpers. Moving the offset check into `enumProblems` really did remove the duplicated offset rule from `apply` and from analyze.
- Other checklist items are fine:
  - Type safety: `saveError?: string | null` is typed, with no escape hatches.
  - Security and error handling: the error message is rendered as React text, not HTML. The staleness token still guards rejections.
  - No dead imports. No TODO or FIXME.
  - No over-engineering. The InlineError element is the same one UpsertSourceConfig.tsx:192 uses, with no new styling.
  - The fallback text is now neutral ("Failed to save this step's configuration …") and its test was updated.
- One small behavior shift: `WindowStep.apply` now raises a lag/lead `offset <= 0` error before the `requires 'field'` error. Before, it was after. This affects only the order of run-time errors for a config that is already invalid. Acceptable.

### Phase 3: UI Review — PASS

Servers were started with `start-servers.sh` and passed `assert-phase.sh servers`.
- **Login:** I used a fresh user, `eval-hel1416@example.test`, through `/api/auth/login`. The shared Playwright browser was already holding a leftover cookie for another eval user (HEL-1402); I replaced it.
- **Happy path:** I opened the sample pipeline. The fillnull, window and pivot editors render, and draft steps show their analyze problems.
- **The legacy fillnull row (`average`) self-heals:** the editor narrows an unknown strategy to `constant`, so toggling a column PATCHed and got 200. This is pre-existing editor behavior, not introduced here.
- **Rejected save, all three editors:**
  - Setup: I rewrote outgoing PATCH bodies in the page (XHR send hook) to send an invalid enum, so the real server returned real 422s.
  - fillnull showed "Unsupported fillnull strategy: 'average'. …".
  - window showed "Unsupported window function: 'ntile'. …", triggered by editing the Output column text.
  - pivot showed "Unsupported pivot aggregation function: 'median'. …", triggered from the keyboard (ArrowDown then Enter on the combobox).
  - Each message appears through `p.inline-error`, under the editor fields.
  - Screenshot evidence: `/home/matt/Development/helio/.concertino/runs/HEL-1416/evidence/eval-hel1416-fillnull-422.png`.
- **Clearing:** `persist` clears `saveError` at the start of each new attempt (useStepCardState.ts, the `if (captureErrors) setSaveError(null)` line), and the code read confirms this.
- **Console:** 2 kinds of error entries. One is the deliberately induced 422 resource log. The other is a pre-existing 404 on `/api/pipelines/:id/schedule` for a pipeline with no schedule. There were no app exceptions.
- **Breakpoints:** at 1440, 1100 and 768, the error paragraphs do not overflow (`scrollWidth <= clientWidth`) and the document is no wider than the viewport. At 375, the step card's content box extends to x=402 for both the new error and the existing help paragraph ("Only null cells …"), so this is pre-existing card geometry and not caused by this change. The document scrollWidth is still 375.

### Overall: FAIL

### Change Requests
1. **Back up task 3.4 with tests, or correct it.**
   - In `backend/src/test/scala/com/helio/services/patchsets/PatchSetPipelineCreateStepConfigSpec.scala`, add one invalid case per kind on the `pipeline`/`create` edit, on both apply and preview, asserting 422 and that no pipeline is created. Configs: fillnull `strategy:"average"`, window `lag` with `offset:0`, pivot `agg:"median"`.
   - In the HEL-1416 block of `PatchSetApplyServiceSpec.scala` (around lines 573-598), extend the step-update case beyond pivot to cover fillnull and window, as 3.4 says ("one invalid case per kind").
   - Otherwise, reword task 3.4 to what was actually tested. Leaving it [x] as written is an untrue claim.
2. **Make the "one shared rule per kind" real (design D1), and remove the misleading `// empty draft` comments.** In `FillNullStep.apply`, `PivotStep.apply` and `WindowStep.apply`, change the fallback branch to cover only the empty draft: `if (cfg.strategy.isEmpty)`, `if (cfg.agg.isEmpty)`, `if (cfg.function.isEmpty)`. It keeps throwing `unsupported*Message("")`. Then the shared function is the only place that rejects a non-empty unknown value. Apply the same change in `PipelineAnalyzeService.validateFillNull` and `validatePivot`: report `strategyProblem(cfg)` / `aggProblem(cfg)`, plus `unsupported*Message("")` only when the value is empty, and drop the `getOrElse` that does nothing. (`validateWindow` already does this correctly, since it calls `enumProblems`.) Existing tests keep the behavior the same. To show the rule is now single, mutate `strategyProblem` (for example, drop its `nonEmpty` guard) and confirm a run/analyze test changes.

### Non-blocking Suggestions
- The window `validateRawConfig` override joins `enumProblems` with `"; "`, but `enumProblems` returns at most one message. `.headOption` would be more honest. Purely cosmetic.

### Evaluator side effects (dev DB residue, by exact id)
- User `ac8e597d-b9f7-4509-ba73-74ebc90aabca` (`eval-hel1416@example.test`).
- `ops` template instance: dashboard `d31a64a0-fa09-45c8-aa6f-70b8c0121640`, pipeline `3421dc1a-8385-409a-b437-746bfa4876b4`, source `2f8ee5b0-3538-473d-a80d-977ca215aec4`.
- Steps on that pipeline: `e2e70dd5-9bf4-4d37-b4d5-85cb2e46abc2` (fillnull, config set by SQL to `strategy:"average"` and then healed to `constant` with columns [date, service] by the editor), `9b28bfec-2f6a-46a1-a00b-3e59185a1f62`, `25f73d4f-e066-4f80-bd4f-9da215aced01`, `1f30a950-69db-4d4b-a82a-34a336f669c8`.
- No pipeline was created by the patch-set probes (all returned 422).
