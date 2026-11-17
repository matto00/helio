## Evaluation Report — Cycle 1 (evaluation-1.md)

Reviewed HEAD `60177b7353f36d2a34667ae09443eb65eab1e986` against live-resolved base `e0443c24d0c02b41cdda105a410cea0b6bdf2b33` (origin/main merge-base).

### Fresh gate runs (this evaluator, in WORKTREE_PATH)
- `npm run lint`: exit 0. `npm run format:check`: exit 0. `npm --prefix frontend run typecheck`: exit 0. `npm --prefix frontend run build`: exit 0.
- `npm test` (`HELIO_JEST_MAX_WORKERS=3`): root 66 suites / 579 tests passed; frontend 786 suites / 9619 tests passed; exit 0.
- `sbt -J-Xmx3g testFull`: `Tests: succeeded 9588, failed 0, canceled 5`, "All tests passed.", exit 0 (I read the summary).
- e2e (`DEV_PORT=7165 BACKEND_PORT=10072`, `--project=dev --workers=2`): `hel1733-draft-outputs-shapes.spec.ts` + `hel1631-draft-mode.spec.ts`: 35 passed, 0 failed, 0 flaky.

### Red-first evidence check (C2, C3)
- `evidence/e2e-red.txt` is real. 19 of 19 tests fail on main with `locator.click: Timeout`, and each call log shows the control resolved as `disabled` with `title="Save or discard your draft first"`: step menu "Add output" (11), "Open hel1733 saved chart output" (4), "New output" (2), and "Add Outputs from a shape" (button and phone menu item). All eight actions are red in both desktop-light and phone-dark, plus the desktop-dark and phone-light smokes. The red run uses an earlier revision of the spec (line 403/443, green run 404/447). The six later desktop tests (kept/v2/stale/undo/sheet/stubbed-expand) have no red transcript and no green transcript of their own. My fresh run shows them passing.
- `evidence/backend-red.txt` is real: `*** 3 TESTS FAILED ***` (DraftDiffSpec a and c, plus the DraftSaveApiSpec route rename) and `succeeded 47, failed 3`. `backend-green.txt`: `succeeded 50, failed 0`.
- Readiness waits: the actions wait on `Draft · unsaved changes`, the step-1 row count, and `.spine-row__count`. `sheetReady` waits on the Name field plus `toHaveCount(0)` of "Checking column types". A count of 0 can pass before the projection request starts; Save's auto-wait for enabled covers this in practice. Two fixed `waitForTimeout(800/1200)` calls are quiet windows for "no request sent" assertions, not readiness waits.

### Phase 1: Spec Review — FAIL
Issues:
1. **Spec scenario "Edit an Output in a draft" is not tested.** The spec says "renames an Output and changes its chart type ... after a reload the Output has the new name and chart type and its other config keys unchanged". D13 A4 says "rename + chart type". `e2e/hel1733-draft-outputs-shapes.spec.ts:292` only renames. No test exercises the D4 whole-config merge end to end. I confirmed by hand in the running app that rename plus Line to Bar saves `chartType: "bar"` with `fieldMapping` kept, but nothing in the repo would catch a regression.
2. **The Live Output column is a ticket scope bullet and part of the spec ("a created Output rendered from its node's draft rows"), and nothing tests it.** No e2e or jest test renders a created (`draft-`) Output in the Live Output column or checks that `useSavedOutputRows`/`useLiveOutputBaseline` make no request for its client id. `LiveOutputColumn.test.tsx` only gained a `draftOutputs` fixture key. D13 also requires "the spine ... and the Live Output column show the draft Output"; the e2e reads spine card names only. It works in the running app: I picked a created root Output in "Displayed Output" and it rendered 14 rows "from the cached sample", with no `draft-` request.
3. **Discard is under-covered.** The spec scenario "Discard drops draft Outputs" is "creates, edits and deletes Outputs ... discards ... saved Outputs shown exactly and no request". D13 asks for "One Discard variant per action (desktop)". There is one Discard test, and it covers create only.
4. **D5 typed-schema seam (executor gap 3).** No test reaches the real `analyze-proposal` with a draft type change. I checked the premise: the sheet's field pickers list every column (`outputConfigTypes.ts:199-202`), so D13's literal "offers date for a timeline time slot" would pass vacuously on this UI. The executor was right not to write it as specified, but no real-backend substitute was added. The only real-backend sheet test checks "Group by field" (an `Any` slot), which is type-blind. The jest suite also lacks D5 cases (c) unedited saved step below an edited cast, (d) rename carries type, the 404 half of (e) (only one failure is mocked), and the D5 wiring test (picker changed to a draft-new step, so the requested node ids include it and the columns are that step's). Tasks 7.2 lists all of these as done.
   I ran the type seam by hand: real `POST /api/pipelines/analyze-proposal` with a draft `cast {date: timestamp}` returns `date: timestamp` at the cast node and below. The behaviour is correct; the repo does not guard it.
5. **D3 consumer table (executor gap 5).** Task 6.3 ("one unit assertion per row, draft and no-draft") is ticked `[x]`, but there are no per-row tests. Rows with no assertion: the phone header "Add Outputs from a shape" (`MobilePipelineHeader.tsx`), the shape anchor skipping temp steps and the button disabled when root 0's trunk is all temp (`PipelineSpine.tsx`), step-menu "Add output" disabled on a temp `step-N` but enabled on a saved step (`useSpineStepActions.tsx`), and the "Outputs are still loading"/"could not be loaded" reason on these controls. `PipelineDetailPage.draftMode.test.tsx` covers only the desktop shape button, "+ Output", step "Add output" on a saved step, and "Add source".
6. **Planning artifacts do not match the implementation.** tasks.md 6.2 is ticked while noting the deviation, but its text still says "`useOutputImmediateActions` holds the moved immediate thunks unchanged". 6.3 and 7.2 are ticked with sub-items not done (items 4 and 5 above). design.md D3 and D5 still describe the un-implemented routing and footer placement.
7. **Executor deviation 1 (no `useOutputImmediateActions`; the sheet picks draft vs immediate).** See Phase 2 item 1. The `hasDraft` condition is functionally the same, so this is not a behaviour bug. But it puts the draft-or-immediate decision in `PipelineDetailDialogs.tsx:34` and `OutputEditorSheet.tsx:242,309`, outside `usePipelineDraftRouting` (HEL-1704 D2, "the single place an action becomes a draft op or an immediate write"). It is also why the sheet is over budget.

Accepted on their merits:
- Executor gap 6: `SchemaField.scala:27-32` `require`s a canonical `DataFieldType`, so the server cannot be fed `number`/`double`/`long`/unknown types and the shared fixture cannot carry them. The TS-only defensive test is the right call.
- Executor gap 2: footer hint in the sheet body rather than the footer. This is a placement/visual call, so I defer it to the skeptic; it is non-blocking here.
- Constraints: C1 holds (two-click "Confirm delete (removes from 1 dashboard)" records the op; at Save & run the existing dialog lists "Output: eval renamed chart" and "1 panel bound to those Outputs"; I verified this live). C3 holds (backend red then green). C4 holds (one PR covers Outputs and shapes). C2 holds for the eight actions (red then green, desktop-light and phone-dark, plus both smokes). Its "real readiness waits" part is mostly met (see above).
- AC "kept-draft restore and stale-base path still work": covered by the kept/v2/stale/undo e2e (green in my run) and D15 unit tests (1)-(8).
- No root routing in the diff (HEL-1734); add/remove source stays blocked.

### Phase 2: Code Review — FAIL
Issues:
1. **File-size budget (CONTRIBUTING.md General: "If a file you're editing crosses ~400 lines, propose a split in the PR description rather than adding to it"; this is executor gap 4).**
   - `frontend/src/features/pipelines/ui/outputEditor/OutputEditorSheet.tsx`: 395 lines on main, now 491. It crosses the threshold by adding 96 lines. Design D3 had already planned the extraction (`useOutputImmediateActions`) that would have kept it under.
   - `frontend/src/features/pipelines/state/pipelineDraft.ts`: 287 on main, now 414. It crosses the threshold in this diff.
2. **Dead code / DRY.** `ui/outputEditor/outputSheetDraft.ts:16` exports `HISTORY_AFTER_SAVE`, which nothing imports. `ui/spine/SpineOutputs.tsx:94` hard-codes the same string.
3. **Untyped escape hatch.** `hooks/usePipelineDraftRouting.ts:234`: `aggregateConfig as unknown as PipelineStepConfig`. `AggregateConfig` is already a member of the `PipelineStepConfig` union (`types/pipelineStep.ts:391-404`), so the double cast is unnecessary and hides real type errors.
4. **Committed evidence bloat.** `openspec/changes/draft-outputs-and-shapes/evidence/backend-testFull.txt` is 15.5 MB (114,075 lines) of raw sbt log. Nothing else under `openspec/` outside this change exceeds 1 MB. A squash-merge keeps it in history permanently, and the claim it supports is one summary line.

Checked and fine:
- The backend D12 fix is minimal and correct: `DraftDiff.scala` uses `validateConfig(kind, config, cur.config, writePolicy)` with `RestorePriorStored` only under `allowExplicitIds`.
- `buildNodeCapabilities` is moved verbatim to the companion, with the instance method delegating.
- The parity fixture is asserted by both suites.
- Interleaved replay (`draftOutputs.ts`) matches D1: cascade not counted, rebase drops counted.
- The D15 readiness and one-shot judgement are implemented as designed, with tests (1)-(8).
- `LiveOutputColumn` skips server reads for client ids.
- No inline FQNs. No new CSS or tokens; the new copy reuses `output-editor-sheet__field-hint` and the existing card meta.

### Phase 3: UI Review — PASS (objective checks)
I ran this in the running app (servers via `start-servers.sh`, ports 7165/10072) with a throwaway user, at 1440 dark and light, 1100 light, 768 light, and 375 dark.
- Happy paths all worked in a draft. Desktop: create on root, edit (rename + chart type), Live Output render of a created Output, delete of a bound Output with the two-click confirm, the cascade dialog, Keep editing, then Discard restoring the saved list. Phone 375 dark: step sheet > "Add output" > "Add as tail with aggregate" (lane step + Output, "Chart · New · not saved"), and header menu > "Add Outputs from a shape" (Pivot: 2 steps after the last trunk step). Save & run saved everything atomically; the definition and Outputs I read back afterwards matched.
- No `/api` request named a `draft-` id. No Output or step writes before Save & run. The sheet issues `analyze-proposal` (twice per open under dev StrictMode).
- Console: only the pre-existing `GET .../schedule` 404 and the designed 422 from `draft/save` that opens the cascade dialog. No unhandled exceptions.
- Accessibility: the new controls are existing labelled buttons and menu items. A disabled "Add source" exposes its reason via its title/description.
- Breakpoints 1440/1100/768/375: no horizontal overflow (scrollWidth equals clientWidth at 768), and the cards render "New · not saved" / "Edited".
- Pre-existing, not this diff: at 375px the sheet footer's "Add as tail with aggregate" wraps to three lines.
- Screenshots (scratch, not load-bearing for the FAIL): `/home/matt/Development/helio/.concertino/scratch/HEL-1733/eval-*.png`.

### Overall: FAIL

### Change Requests
1. **Bring `OutputEditorSheet.tsx` (491 lines) back under ~400 by implementing D3 as designed.** Move the immediate `createOutput`/`updateOutput`/`deleteOutput` dispatches (and the post-create `previewOutput`) out of the sheet into `hooks/useOutputImmediateActions.ts`. Add `handleCreateOutput`/`handleUpdateOutput`/`handleDeleteOutput` to `usePipelineDraftRouting`, each falling back to the immediate handler when `!draft.hasDraft`, and have the sheet call only those page handlers. This makes `usePipelineDraftRouting` the single routing point again, and `PipelineDetailDialogs.tsx:34-57` no longer needs to decide. If the executor judges this infeasible, escalate with evidence; do not leave the file over budget without the PR-description split proposal CONTRIBUTING requires.
2. **For `state/pipelineDraft.ts` (414 lines):** either move the Output-specific prune rules (D2) into `state/draftOutputs.ts`, or put the split proposal in the PR description, as CONTRIBUTING requires for a file crossing ~400.
3. **Extend e2e A4 (`e2e/hel1733-draft-outputs-shapes.spec.ts:292`)** to also change the chart type (e.g. Line to Bar). `verifyBody` should assert that the body's `config.chartType` is `"bar"` and that `config.fieldMapping` equals the seeded mapping. After reload, read `GET /api/pipelines/:id/outputs` and assert the same, matching the spec scenario "Edit an Output in a draft".
4. **Assert the Live Output column for a created Output.** Add this to the desktop e2e, e.g. A1/A3, or a dedicated test: pick the created Output in "Displayed Output" and assert the column renders its rows from the draft. Assert no request named its client id while it was displayed. Add a `LiveOutputColumn.test.tsx` case with a `draft-` Output that asserts `useSavedOutputRows`/history make no call.
5. **Add the spec's combined Discard scenario.** In a draft, create one Output, edit one saved Output, delete another (or the same saved one), apply a shape and an aggregate tail, then Discard. Assert the spine equals the saved Outputs and steps exactly and that no request is sent. This covers D13's "Discard per action" in one test.
6. **Add a real-backend type-seam e2e (desktop) in place of D5(a).** The time-slot picker lists every column, so use a type-sensitive control. In a draft, add a cast of a string column to `float` (or `integer`) above a node. Open "Add output" there and choose Chart > Histogram (whose field list is `eligibleColumns.yAxis`). Assert the cast column is offered and was not offered before the cast, with the real `analyze-proposal`. Record the red run (on main the control is disabled). Also add the missing jest cases: D5 (c), (d), the 404 half of (e), and the picker-change wiring test (D5 "Wiring").
7. **Add the D3 consumer-table assertions task 6.3 claims, draft and no-draft.** Cover: the phone header "Add Outputs from a shape"; shape-anchor temp skip and the all-temp-trunk disable; step "Add output" disabled on a temp step and enabled on a saved one; the "Outputs are still loading" / "Outputs could not be loaded" reason on "+ Output", "Add output", the shape button and the aggregate tail; and "Add source" still blocked on phone.
8. **Remove the dead export.** Delete `HISTORY_AFTER_SAVE` from `ui/outputEditor/outputSheetDraft.ts:16`, or import it in `ui/spine/SpineOutputs.tsx:94` in place of the hard-coded string. One of the two, not both.
9. **Remove the double cast in `hooks/usePipelineDraftRouting.ts:234`.** Pass `config: aggregateConfig` (`AggregateConfig` is a `PipelineStepConfig` member).
10. **Replace `evidence/backend-testFull.txt` (15.5 MB) with a short excerpt.** Keep the command, the `Tests: succeeded 9588, failed 0, canceled 5` line and "All tests passed.", and drop the raw log from the commit.
11. **Update tasks.md (6.2, 6.3, 7.2) and design.md (D3, D5 footer-hint placement, D13 D5(a) substitution)** so they describe what is actually implemented and tested after items 1-7.

### Non-blocking Suggestions
- `ui/outputEditor/outputSheetDraft.ts` `TYPE_RESTRICTED_KINDS` duplicates the slot-eligibility table in `state/nodeCapabilities.ts` `SPECS`. Derive it (kinds with any `numeric`/`orderable` slot) so the two cannot drift.
- `useDraftNodeCapabilities` drops stale responses but does not hold "at most one in flight" (D5 Timing). One extra `analyze-proposal` was sent as the sheet closed after "Add as tail with aggregate". This is harmless, but D5 says never while no sheet is open.
- `e2e-green-alongside.txt` is only the final 3 lines. Keep the per-test list so the 86-pass claim is checkable.
- `SpineOutputs.tsx` card-meta expression (`... && ... || ""`) would read more clearly as a small helper returning the meta suffix.
- `sheetReady` could also wait for a populated field picker (D13's named readiness signal) rather than only the absence of "Checking column types".

Dev-DB residue I created (user `a4ad92a8-1f8f-4120-acdc-61e616d75530`) was removed by exact id and email through `e2e/support/userCleanupCore.cjs`'s guarded transaction. `GET /api/auth/me` now returns 401. Servers stopped with `stop-servers.sh`.
