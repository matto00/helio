## Skeptic Report — final gate (round 1, skeptic-final-1.md)

Reviewed HEAD: `89074429ddcb30c877add28d1f413546cf105c93`. Base (resolve-review-base.sh, live): `cd64409ad828d9024074f907a7ea32800ab71ff3`. origin/main has since gained 60086f02b (HEL-1605); `git merge-tree` against it is CLEAN, and it adds no CSS files (so the 141-file pin in the elevation and motion guards still holds).

### What I verified (with evidence)

**Spawn guard:** `assert-cwd.sh` printed READY (ambient /home/matt/Development/helio, branch feature/pipeline-detail-step-spine/HEL-1579).

**Owner rulings and the accepted defect (read from the events.jsonl files myself)**
- `.concertino/runs/HEL-1579/events.jsonl` line 5: `escalation.answered` with these five answers: "sub-spine + label" (owner free-form), persist-last-run-counts, spine-output-section, spine-row-menu and header-owns-name. `answer_source: human`.
- Line 73 (t=1792049647476): `escalation.answered` with `proceed-with-followup` (human). Line 74 records `ticket.filed` HEL-1608. In Linear, HEL-1608 exists in Backlog, relatedTo HEL-1579, and its scope is the 769–1100px spine-title truncation (`clamp(180px, 22vw, 340px)`). The accepted defect is therefore genuine and filed.
- `.concertino/runs/HEL-1574/events.jsonl` line 72: the owner's free-form ruling on Delete: "it should only be on overview rows. not in detail pages."

**Gates (fresh runs, this worktree)**
- `npm --prefix frontend run lint` exited 0. `typecheck` exited 0. `check:openspec`, `check:schemas` and `format:check` each exited 0.
- Jest (3 workers), scoped to `features/pipelines`, CommandBar, App.test, hidesBreadcrumb, DataGrid, ActionsMenu and theme: **166 suites, 2364 tests passed, 0 failed.**
- sbt `testOnly` on PipelineRunStepRowCountsRlsSpec, OutputRoutesSpec and PipelineRunRoutesSpec: **162 succeeded, 0 failed.** The logged ERROR lines come from the failure-path tests and are expected.
  - The RLS spec runs as `helio_app_test` (NOSUPERUSER NOBYPASSRLS) through `SET ROLE`, so C8 holds.
  - It includes "clear the pipeline's counts when a later terminal write records none".
- Playwright (DEV_PORT=7011, 2 workers) on `hel1579-pipeline-spine-layout`, `hel908-step-card-split` and `hel1007-multi-root-reorder`: **11 passed.** This includes the accent audit, 1280x800 no-scroll with ≥8 rows, lanes, the flush and the 769–1100 sweep.

**Acceptance criteria**
1. **Every step kind editable; tests migrated.**
   - `StepCardFocused.tsx:136` renders the same `StepOpEditor` with the same props as `StepCard.tsx:203`, so the if-ladder for every kind is reused unchanged.
   - Live check: Filter, Sort, Limit (lane) and Compute editors all rendered and could be edited.
   - `test-migration.md` ledger: e2e `it`/`expect` counts kept or grew (for example, hel908-trunk-reorder-drag is 1/23 before and after).
2. **Row counts, and selection drives editor + preview.**
   - `GET /api/pipelines` returns persisted `lastRunStepRowCounts` (4 ids).
   - The spine shows 14/14/3/14.
   - Clicking Sort, Limit and Compute rows updated `?step=`, the editor heading ("Step 3 Compute column") and the preview header ("Rows after step 3 · 14 rows", plus the `+ duration_min` diff chip).
   - The backend writes counts in the same statement as `row_count`/`last_run_row_count`. Failure and reaper paths write NULL (`PipelineRunRepository` reaper SQL, the `updateLastRun*` defaults).
3. **Lanes visible and selectable.** The label "Lane 1 · from 2 Sort rows" appears in muted mono, and the lane's row is indented under step 2. Selecting it gets the accent wash and loads its 3-row preview (`sk-dark-1280-lane-selected-hover.png`).
4. **1280x800: spine, editor and ≥8 rows with no scroll.**
   - Measured with the context list at its 400px maximum: `scrollHeight` 800 = `innerHeight` 800.
   - The spine is 281.6px wide and the table shows 10 rows fully in the viewport.
   - Holds in light (`sk-light-1280.png`) and dark (`sk-dark-1280b.png`).
5. **Accent only on Run, the selected step and focus.**
   - My own computed-style audit over the `.pipeline-detail-page--spine` subtree, in light and dark, resolving `--app-accent`, `-dim` and `-strong` (excluding hover/soft tokens that resolve to the text colour), found only:
     - the `spine-header__btn--primary` (Run) background;
     - the `spine-row--selected` wash;
     - the `spine-row__number` (selected) background and border.
   - A keyboard-focused editor action shows a `2px solid` accent outline (focus ring, allowed).
   - Hovering the selected row uses `--app-accent-mid` (selected step, allowed).

**Owner rulings held**
- **No Delete:** zero buttons, links or menuitems match /delete/ on the page. The Pipeline actions menu holds Rename, Edit source, Edit schedule, Resume schedule, Run history and Share.
- **header-owns-name:** the CommandBar breadcrumb reads only "Data Pipelines". `hidesBreadcrumbItemName.ts` returns true only for the rail shell on `/pipelines/:id`, and the only CommandBar change is the second conditional.
- **spine-row-menu:** the Sort row menu has Move up / Move down (aria "… in eval-src"), Insert step after, Branch from here and Add output.
- **spine-output-section:** the OUTPUTS card shows "Table · used in 0 panels · off Compute column", plus "+ Output". The tabs are gone on desktop.
- **Persisted counts, V135:** verified above. V135 is the latest migration; origin/main adds none.

**Constraints**
- **C4, phone unchanged:** at 390x844 the old river view, header, tabs and footer render (`sk-dark-390.png`). The git diff touches no phone CSS or components; `PipelineDetailPage.css` is unchanged and the accent overrides live in the spine-scoped `PipelineSpineAccent.css`.
- **C5:** no Save & run, draft or "live" marker was added.
- **C6:** no PipelineListTable, SourceListTable or App.tsx edits.
- **Console:** 0 errors and 0 warnings on the detail page.
- **HEL-1585:** at 1440x900 there is no document scroll (`sk-dark-1440.png`, and the e2e 1440 test passed).
- **Design comparison:** against `PipelineLive.png` (illustration), the region structure, the spine row anatomy (number badge, title, mono summary, right-aligned count) and the "Rows after step N · count" table header match. The differences are intended and draft-mode-free: no live column or Save & run, which is HEL-1581's scope.

**Narrow widths:** at 820 (list at 400) the header fits on one row (Paused chip, icon Dry run, "Run", ⋮). Spine titles truncate to one letter (`sk-dark-820.png`). This is exactly the owner-accepted HEL-1608 defect and is not counted against the branch.

Evidence (persisted):
- /home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.skeptic-evidence/sk-light-1280.png
- /home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.skeptic-evidence/sk-dark-1280b.png
- /home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.skeptic-evidence/sk-dark-1280-lane-selected-hover.png
- /home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.skeptic-evidence/sk-dark-1440.png
- /home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.skeptic-evidence/sk-light-1440-compute.png
- /home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.skeptic-evidence/sk-dark-820.png
- /home/matt/Development/helio/.concertino/runs/HEL-1579/evidence/.skeptic-evidence/sk-dark-390.png

No claim in this report rests on mtime ordering.

### Verdict: CONFIRM

### Non-blocking notes
- **Header meta:** at 1280 with the context list at 400px, the meta truncates to "14 …", which says nothing. Consider hiding it below the width where "N rows written" fits, as the ≤800px container rule already does. Fold into HEL-1608.
- **Row hover wash:** a non-selected row's hover wash covers only the select button, so the ⋮ sits outside it (`sk-dark-1280-lane-selected-hover.png`, Compute row). The selected row's wash includes the ⋮. The asymmetry is minor. Also, `PipelineSpine.css:189-191` (`.spine-row:hover` background) is dead code, overridden by `:344-346`.
- **Lane step numbering:** lane steps are numbered within their lane, so a lane step's editor reads "Step 1 Limit rows" / "Rows after step 1", which collides with trunk step 1. Consider "Lane 1 · step 1" in the editor and preview headings.
- **Raw ids in a tooltip:** spine rows carry `title={nodePath}` (`SpineStepRow.tsx:89`), so hovering shows a raw "root:<uuid> > <uuid>" tooltip. This carries over the old river card behaviour (`LaneColumn.tsx`, HEL-985), not a regression, but it is user-visible.
- **Evaluation-5 doc nits** (paused-chip icon at ≤600px, design D2 `clamp(270px…)`, the stale "1100px block" comment) are still open. They are already in HEL-1608's scope.
- **Merge plan:** whoever merges second between this branch and HEL-1575 must extend `hidesBreadcrumbItemName` (design D3).
