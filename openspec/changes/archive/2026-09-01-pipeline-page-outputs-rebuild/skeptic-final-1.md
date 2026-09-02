## Skeptic Report — final gate (round 1, skeptic-final-1.md)

**Axis:** ticket-scope completeness + honesty of every "out of scope"/"blocked"/"not
reproducible" disposition; regression safety of named historical invariants.

Ground truth: HEAD `649baa21`, tree clean (`git status --porcelain` empty). Backend
`{"status":"ok"}` on :9247, frontend HTTP 200 on :6340 — both live, not restarted.

### What I verified (with evidence)

**Gates (re-run fresh by me, not cited):**
- `npm run typecheck` → exit 0. `npm run lint` (`--max-warnings=0`) → exit 0.
- `npx jest` → **282 suites / 3009 tests passed**, exit 0.
- `npm run check:openspec` → "openspec/ is clean".

**Dispositions I independently probed:**

1. **HEL-676 (mobile 375px OUTPUT bar overlap) — genuinely not reproducible. Confirmed,
   with a *stronger* reason than the executor gave.** I read HEL-676 in Linear: the repro
   is "the **fixed** OUTPUT bar overlaps step-card content **when a step card is
   expanded**" — and "step card expanded" is a condition task 3.6's list of tried
   combinations (long names, gallery tab, Output sheet, 375x812/375x667) does *not*
   name. I ran it myself: 375x812, `/pipelines/3e535ac8…`, first step card expanded.
   - The OUTPUT bar still exists (`.pipeline-detail-page__footer-output-label`) — the
     HEL-676 cancellation note's "the OUTPUT bar is replaced by the Outputs rail" is
     inaccurate. But its entire ancestor chain (`__footer-left` → `__footer` →
     `__footer-region`) computes `position: static`, `z-index: auto`. The only
     `fixed`/`sticky` elements on the page are the offscreen skip-link and `bottom-nav`
     (top 744, below the river's bottom 568). A static, in-normal-flow bar cannot
     overlap; the bug's premise is structurally void on the rebuilt page.
   - `elementFromPoint` occlusion sweep over every visible control inside all 28
     step-card elements: **0 occluded**.
   Verdict: honest disposition, and it can now be closed with a mechanism, not a
   "couldn't find it".

2. **Tasks 2.5 / 5.9 / 6.4 (PanelDetailModal blocker) — blocker is real and current, not
   stale.** Re-grepped against current code: `PanelDetailModal.tsx` live-imports
   `BindingEditor` (:35), `CollectionEditor` (:36), `MarkdownEditor` (:39),
   `TimelineEditor` (:41); `PanelCreationModal.tsx` live-imports `ShapeInstantiateStep`;
   `MetricEditorForm.tsx` + `PanelCreationModal.tsx` are live
   `selectPipelineOutputDataTypes` consumers. **HEL-937 exists**, is Backlog, and its
   description is accurate — it even names `MetricEditorForm.tsx` as the second live
   importer, which my grep independently confirms. Correctly excused.

3. **Task 4.3 (place-on-dashboard) — citation checked at source, not on faith.** I read
   ticket.md's own "Out of scope" section: *"Dashboard picker and panel sheet (P1.6)."*
   The disposition is literally correct. (ticket.md contradicts itself — its Scope
   section lists "Place on dashboard (dashboard picker; `POST /api/panels`)" — but the
   explicit Out-of-scope section and design.md's matching Non-Goal both win, and P1.6
   /HEL-909 owns it as ticketed scope. Non-blocking note only.)

4. **F-105 and F-146 both still hold on current code.** F-105: `skipNextAnalyzeRef` is
   set during the `persistedSteps` seeding render (`usePipelineDetailPage.ts:196`) and
   consumed/cleared in the debounce effect (:248-249); guarded by a real fake-timer
   regression test (`PipelineDetailPage.test.tsx:355`) that asserts `analyzePipeline`
   called exactly once and *still* once after `advanceTimersByTime(500)` — a test that
   would actually go red on a double-fire. F-146: stable-reference discipline intact
   across `usePipelineDetailPage.ts` (`stepsRef`, module-level empty arrays),
   `PipelineRiverView.tsx` (hoisted per-item callbacks), `StepCard.tsx` (id-keyed props),
   plus a CR5-added shared module-level empty-array guard in `outputsSlice.ts:319` with
   its own selector-identity test. Both survived the CR1–CR11 churn.

5. **HEL-878 / HEL-681 / HEL-629 regression guards present:** `resetRunScopedState` is
   the single reset path called from both the Redux and SSE arms (8 references);
   `outputsSlice.ts:155` implements the per-dispatch `previewRequestToken` with a direct
   test (`outputsSlice.test.ts:101` — "a slower, earlier preview response never
   overwrites a faster, later one"); HEL-629 remount key at `OutputPreviewPane.tsx:98`
   with a pie↔bar live-switch suite (`OutputEditorSheet.test.tsx:119`).

6. **Interaction-budget justification (task 9.3) is sound, not scope-creep laundering.**
   I read the cited spec line myself (`2026-08-30-pipelines-outputs-remodel-design.md:256`):
   it budgets ≤12 interactions for *source → pipeline → three Outputs → **placed on a
   dashboard***, no filter step, no aggregate-tail. The shipped spec's 25 clicks covers a
   materially different, wider flow and *cannot* include placement (P1.6). Recording the
   count without asserting it against line 256 is the honest call.

7. **HEL-936 share is exactly as claimed.** Live console on the rebuilt detail page shows
   exactly **2** `GET /api/types` 404s, both from `SidebarBody.tsx` — matching task
   10.6's "taken = PipelineDetailPage only; left = the other ~18 files" claim precisely.
   (Third console error is a benign `/schedule` 404 for a no-schedule pipeline.)

8. **Backend waiver regression guard exists:** `PipelineStepRepositorySpliceSpec.scala`
   is present, guarding `spliceInsertAtInternal`'s preserved trunk-insert behavior.

### Verdict: REFUTE

Two findings, both on my axis, both reproduced. Neither is large; the body of work is
genuinely strong and unusually candid. But CR1 is an in-scope ticket bullet excused by a
claim that is **verifiably false against the live backend**, with a user-visible symptom.

### Change Requests

1. **`features/pipelines` still renders a permanently-empty "Output type" column, and
   task 8.3 excuses it on a false premise.** ticket.md's Scope says: *"Delete
   `PipelinePreviewModal`, `ShapeInstantiateStep`, **every `dataTypeId`/
   `outputDataTypeName` reference in `features/pipelines`**."* That is not done, and the
   stated reason is wrong.
   - `frontend/src/features/pipelines/ui/PipelineListTable.tsx:106` renders
     `{pipeline.outputDataTypeName}` under an "Output type" `<th>`.
   - Task 8.3 justifies keeping it: *"the `PipelineSummary` wire type still mirrors the
     backend's `outputDataTypeId`/`outputDataTypeName` fields, **which the backend itself
     still returns for legacy pipelines**."* **This is false.** Live `GET /api/pipelines`
     returns exactly 8 keys — `id, lastRunAt, lastRunRowCount, lastRunStatus, name,
     ownerId, sourceDataSourceId, sourceDataSourceName` — with **no** `outputDataTypeName`
     / `outputDataTypeId`. Across all **52** pipelines in the dev DB (including ones a
     month old, i.e. the "legacy" case the claim rests on): **0** carry either field.
     `grep` over `backend/src/main` confirms no such field on the summary response.
   - Live symptom I observed at `/pipelines` (375px snapshot): every row's "Output type"
     cell is empty — a dead column shipped to users on a page this ticket owns.
   - Fix: delete the `outputDataTypeName` column + `<th>` from `PipelineListTable.tsx`,
     drop the field from `pipelineService.ts:41` / `pipelinesSlice.ts:272` where it is
     no longer sent or received, and **correct task 8.3's justification** — the current
     wording is the same false-provenance defect class already caught as evaluation-1's
     CR3 and CR8, recurring a third time.

2. **Task 10.4's file-size audit numbers are stale — the files grew across CR9/CR10/CR11
   and Cycle 13 and were never re-measured.** Measured by me at HEAD:
   | file | 10.4 claims | actual |
   |---|---|---|
   | `usePipelineDetailPage.ts` | 955 | **1003** |
   | `PipelineDetailPage.tsx` | 315 (listed "under budget") | **363** |
   | `OutputEditorSheet.tsx` | 569 | 569 (correct) |
   The AC ("no file over ~400 lines without a stated reason") is arguably met — reasons
   *are* stated, and the deferral rationale for `usePipelineDetailPage.ts` (cross-cutting
   F-105/F-146/HEL-878 invariants needing their own verification budget) is legitimate.
   The defect is the audit's accuracy: this is the third recurrence of the
   file-size-claim-vs-reality gap that CR8 already corrected once. Re-measure and update
   10.4 with the true numbers at HEAD.
   Additionally: 10.4 says the split is *"filed as a genuine outstanding item… follow-up
   ticket TBD by the orchestrator/human"*, and design.md decision 13 says a
   `ShapeParamDescriptor` follow-up *"SHALL be filed at delivery time, named in the PR"*.
   **Neither ticket exists** — HEL-937 is the only follow-up filed. File both (or one
   combined) and name them in the PR before merge, so these are tracked rather than
   dropped at the exact moment they were promised.

### Non-blocking notes

- ticket.md contradicts itself on the dashboard picker (Scope includes it; Out of scope
  excludes it). The out-of-scope reading is the right one and design.md agrees — but the
  Scope bullet should be corrected so a future reader doesn't re-litigate it.
- HEL-676 can be closed with the mechanism I found (footer chain is `position: static`;
  nothing fixed/sticky overlaps the river) rather than left "documented-open / not
  reproducible". That is a materially stronger close, and worth putting in the PR in
  place of task 3.6's current wording.
- The spec's ≤12-interaction budget (line 256) remains genuinely unproven for the epic,
  since it requires dashboard placement (P1.6). Worth carrying forward as an explicit
  HEL-909 acceptance item so it isn't lost between the two tickets.
- `PipelineDetailPage.tsx` grew past 400 lines' *spirit* at 363 and is trending upward;
  worth watching in P1.6.
