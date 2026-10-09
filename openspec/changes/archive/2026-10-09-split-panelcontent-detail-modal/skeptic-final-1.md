## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD `036fa3ff405726c002713463cc5e9ba13b3d9482`. The base was resolved live with `resolve-review-base.sh` as `bcde936d5e09f22fc0150fba603f70c3065866f6`, which is also the merge-base. Three commits: `321528c5` (pure move), `4ac632b7` (comments), `036fa3ff` (D5 test nits).
Skeptic evidence is in `/home/matt/Development/helio/.concertino/runs/HEL-1399/evidence/skeptic-final-1/`. It sits outside the worktree, so it survives cleanup.

### What I verified (with evidence)

**Byte identity (AC2, C1).** This is my own check, separate from the executor's `d3.py` and the evaluator's `bytecheck.js`. Two methods, both reading git objects:
- *Line multiset* (`line-multiset-check.txt`). I compared base `PanelContent.tsx` and `PanelDetailModal.tsx` against all 8 files at `321528c5`, with whitespace stripped and blank lines dropped.
  - Every line that left the base is either an import, a `function X(` line that gained `export`, or the old `renderSubtypeEditor()` wrapper and call.
  - Every line that is new is either an import, an `export function` signature, a hook `return {…}` list, a host destructure, or the `renderSubtypeEditor({…})` argument list and type.
  - Nothing else was added or removed.
- *Order-preserving sequence match* (`ordered-sequence-check.txt`, difflib on each new file against its base). Each moved file matches base in order. The only unmatched lines are the D3-permitted set above.
  - `PanelContent.tsx` 0 unmatched, `OutputPanelContent.tsx` 0, `panelDetailChartState.ts` 0, `OutputPanelSection.tsx` 0.
  - The hooks have only their signature and `return` unmatched, and `renderSubtypeEditor.tsx` only its signature.
  - Base lines left uncovered: one `}` (base L87) and the old `renderSubtypeEditor(){` wrapper and `renderSubtypeEditor()` call. No code was dropped.
- Commit 2 (`4ac632b7`): `git diff --word-diff 321528c5 4ac632b7` shows 7 changed hunks. Every one is text inside a `//` or `/** */` comment that repoints file names.

**Hook order and render tree (C2).** I read the host at HEAD. The order is `useAppDispatch`, `useTheme`, then `usePanelDetailData(panel)` (base L166-217 verbatim, see above), then `useNavigate`, then `usePanelDetailEditState(panel, initialMode)` (base L220-314, including the keydown `useEffect`). That is the base slot order, and no hook moves across another. The evaluator's 30-call sequence agrees.
- `OutputPanelSection` is still a component mounted at the same JSX spot.
- `renderSubtypeEditor` is a plain function call, not a component. No tree layer was added.
- The moved keydown effect closes over only `modalMode` and `setModalMode`, which are both local to the hook. No host function is referenced, so nothing is stale.

**Tests changed only in the D5 nits (AC3, C3).** `git diff --name-only bcde936d...HEAD` touches one test file. Its diff is exactly the 2 named mocks plus the `<actual.AppearanceEditor {...props} />` change. The executor's mutation evidence holds up: `D5-mutation-red.txt` shows "1 failed, 2 passed" and `D5-mutation-reverted-green.txt` shows "3 passed".

**Size (AC1).** From `wc -l` at HEAD: 254, 293, 336, 85, 25, 95, 143 and 76 lines. All 8 files are under 400.

**HEL-1378/1395 overlap (AC5).** This is recorded in design.md (Risks, C7). The diff has no `showChartSection` or `ChartAppearanceEditor` removals.

**Gates, re-run fresh by me** (nice 19, `--maxWorkers=3`):
- `npm run lint`, `typecheck` and `format:check` all exited 0.
- `tsc --noUnusedLocals`, filtered to the 8 files, returned zero hits.
- The jest suites `src/features/panels` and `src/features/dashboards` passed: 194 suites, 1798 tests.

**The residual console errors in the D5 test.** I judged this myself.
- Re-running the suite gives 3/3 passed, with 2 `AggregateError` errors and 2 `act()` warnings from `OutputPanelContent`.
- I attributed the errors with an XHR-URL logger passed in via `--setupFiles` from scratch. No repo file was changed.
- Every XHR the suite makes is `GET /api/outputs/output-1/filter-capabilities`. That is `getFilterCapabilities`, called from `OutputControlsEditor.tsx:56` in edit mode. The executor's attribution is correct; the evaluator had left it unconfirmed.
- My judgement is that this is not blocking, and should be a follow-up:
  - The ticket's folded-in scope names exactly two mocks.
  - AC3 and C3 forbid any other test change.
  - "Expect 0" appears only in design.md's evidence prediction, not in an AC.
  - The residual is pre-existing noise that this split did not cause.
  - The suite still catches the HEL-1378 regression (mutation evidence above).
- The ticket's stated motive ("they log ECONNREFUSED console errors") is only partly met. A one-line `getFilterCapabilities` mock in a small follow-up would finish the job.

**The running app** (UI judgement). `start-servers.sh` reused healthy servers, and `assert-phase.sh servers` printed PASS. I confirmed the frontend serves this worktree: `GET /src/features/panels/ui/detailModal/usePanelDetailEditState.ts` returned 200, and that file exists only on the branch.

I used my own throwaway user `hel1399-skeptic-1791574558667@example.test`. Ids and cleanup are in `evidence/skeptic-final-1-dev-db-ids.txt`. The dashboard, both outputs, the pipeline and the source were deleted by exact id. The user row remains, because there is no user-delete API.

What I checked, at 1440 px:
- *Narrow chart with the HEL-1398 footnote.* In light (`dashboard-light-1440.png`) and dark (`dashboard-dark-1440-b.png`) the card shows the annotation, truncated, and "200 of 500 rows."
  - My first dark capture (`dashboard-dark-1440.png`) caught the chart mid-layout: legend shown, no bars. A re-shoot 3 s later had settled, so that was a measurement artefact, not a defect.
- *Modal view mode.* Light and dark (`chart-modal-view-*.png`) show the full footnote "Based on the first 200 of 500 rows." The dark surfaces and text are correct.
- *Modal edit mode.* Light and dark (`chart-modal-edit-*.png`) show Appearance, then the Output section (link, provenance, Swap output, and "Used on 1 dashboard" from `listOutputPanels`), then Controls.
  - I entered edit mode with the **E key**, which exercises the keydown effect that moved into `usePanelDetailEditState`.
  - Escape with no edits went straight back to view.
  - A dirty title plus Escape showed the "Unsaved changes" pill and the discard banner (`chart-modal-discard-light.png`). Discard went back to view.
- *Text panel in dark* (`text-modal-edit-dark.png`, `text-modal-discard-dark.png`). `renderSubtypeEditor` renders the CONTENT editor.
  - Editing the content and pressing Cancel showed the discard banner, which exercises the `subtypeDirty` path.
  - After Discard and re-entering edit, the textarea was back to "Hello text", which exercises `resetFormToPanel` and `activeEditorRef`.
- The design is consistent with the executor's before captures: same layout, spacing, tokens and light/dark parity. No markup or CSS changed in the diff.
- Console:
  - 2 ECharts "Can't get DOM width or height" warnings when the modal opens.
  - Two `502` errors on `/api/pipelines/:id/run-events`, an SSE stream through the Vite proxy. That code (`usePipelineRunEvents.ts`, `pipelineRunFanout.ts`) is untouched by the diff (zero diff hits for `run-events`/`EventSource`), so it is environmental, not this change.
  - The executor's 4→4 before/after browser console counts are identical.

**Executor pixel comparison.** I used it as supporting evidence only. `screenshot-comparison*.txt` gives PNG content diffs: 20 of 22 pairs are pixel-identical, and the small diffs move between runs (5–37 px, caret or hover). These are content diffs, so there is no mtime dependency.

### Verdict: CONFIRM

### Non-blocking notes
- Follow-up: mock `getFilterCapabilities` in `PanelDetailModal.chartTypeDefault.test.tsx`. That removes the last 2 AggregateErrors (attribution confirmed above). Optionally also fix the 2 pre-existing `act()` warnings from `OutputPanelContent`'s `useOutputMeta`.
- Pre-existing, not introduced here: in the output-panel edit modal the Controls body ("No controls yet" / Add control) sits below the modal body fold with no visible scroll affordance at 1440×900. It looks identical in the before captures.
- The stale comment pointers the evaluator listed (`ChartRenderer.tsx:14`, `PanelContent.css:213`, and the two test files) stay follow-ups.
- Gate-defect check: no report I drilled into discloses unsound evidence mtimes, and nothing here relies on mtime ordering.
