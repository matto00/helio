## Skeptic Report — design gate (round 3, skeptic-design-3.md)

Reviewed HEAD 50993f49. The planning artifacts are untracked under `openspec/changes/dataset-row-grid-ui/`.
I re-read `ticket.md`, `workflow-state.md` (C1), `proposal.md`, `design.md`, `tasks.md` and both spec deltas cold.
I checked them against the real code:
- `frontend/src/shared/ui/DataGrid.tsx`
- `DatasetRowValidator.scala`
- `DataSourceRepository.scala` (`appendRows`, `patchRow`, `listRows`)
- `DataSourceService.scala`
- `DataSourceProtocol.scala`

The owner ruling (C1) is taken as given. I checked only whether it is applied soundly.

### What I verified (with evidence)

**C1 / Decision 0 structure: applied.**
- Decision 0 now extends `DataGrid.tsx` with default-off `gridMode`/`activeCell`/`onActiveCellChange`/`rowId` props (design.md:121-135).
- `role="grid"/"row"/"gridcell"` and the roving tabindex are rendered by DataGrid itself (design.md:137-140).
- The regression check is DOM/attribute-level, not "tests pass" (design.md:156-161, task 2.3).
- tasks.md section 2 matches.

**Cursor stack / Prev: fixed.**
- design.md:179-188 and task 3.1 give `cursorStack` semantics: push on Next, pop plus re-fetch on Prev, and Refresh/conflict re-fetch from the top of the stack.
- This is consistent with the API: `listRows` filters `seq > cursor` (DataSourceRepository.scala:606-607), and the response carries only `nextCursor` (DataSourceProtocol.scala:297).

**Add-row landing page: fixed.**
- design.md:190-194 and task 3.6 say to walk `nextCursor` to the end.
- The walk is bounded: `staticMaxRows = 500` (DataSourceService.scala:64) means at most 5 pages of 100.

**400 templates: fixed, and verified verbatim.**
- `renderRowFailures` at DatasetRowValidator.scala:27-36 produces:
  - `row N: expected X fields, got Y`
  - `row N: field 'x' is required`
  - `row N: field 'x' — <reason>`
- Decision 3a (design.md:253-265) and task 3.5 now match these.

**Required-with-default in the design: correct against code.**
- `validateRow` treats only `JsNull` or an absent position as missing, then substitutes `default` before the required check (DatasetRowValidator.scala:122-135).
- `patchRow` persists the validated (default-filled) row (DataSourceRepository.scala:499-503).
- So Decision 3a (design.md:267-273) is true to the server.

**Stale Risks paragraph: removed.** The Risks section (design.md:341-358) no longer claims existing extension points suffice.

**proposal.md wording: fixed.**
- The 409 path is now "follow-up fetch" (proposal.md:21-23).
- The location is concrete: `features/sources/`, `SourceDetailPanel` (proposal.md:46-49).

**Delete/Backspace guard: fixed in design and tasks.** It is in design.md:145-148 and task 4.2. It is NOT in the spec (see CR 3).

**DataGrid facts I checked that bear on the remaining items:**
- `VIRTUALIZATION_ROW_THRESHOLD` is exported (DataGrid.tsx:196).
- Virtualization engages only for `variant === "full"` (DataGrid.tsx:598).
- `resizable = variant === "full"` regardless of callbacks (DataGrid.tsx:402).
- Each resize handle is a `role="separator"` with `tabIndex={0}` (DataGrid.tsx:1000-1008).
- `pinnable = variant === "full"` (DataGrid.tsx:407).
- There are 5 real consumers (grep of `frontend/src`): TableRenderer, SourceDetailPanel (`variant="preview"`, :289-290), SqlTab, ConnectorsPage, StepCard.

### Verdict: REFUTE

The core C1 restructure is sound, and most of the round-2 items are genuinely fixed. Six issues remain. Two of them would produce shipped defects if the artifacts are followed literally:
- **CR 1:** extra tab stops inside `role="grid"` break the stated Tab contract.
- **CR 2:** the spec and design disagree on emptying a required field, and the empty-value encoding is unspecified, so the "revert to default" behaviour can silently fail.

The rest are unresolved remnants of round-2 CR 7 and the regression-check spec.

### Change Requests

1. **Name the `DataGrid` variant and neutralize header focusables in `gridMode`.**
   - Nothing states which `variant` DatasetRowGrid uses. With `"full"`, DataGrid always renders a `tabIndex={0}` resize separator per column (DataGrid.tsx:402, :1000-1008) and pin toggles (:407), whether or not any callback is passed.
   - Those are extra tab stops inside the `role="grid"` table. Shift+Tab from the active cell lands on a header resize handle, not outside the grid. That contradicts Decision 0's "`Tab`/`Shift+Tab` exits the grid" (design.md:149-150) and the spec's keyboard requirement (spec.md:118-120).
   - Choose one and add it to Decision 0 plus tasks 2.1/4.1:
     - **(a)** Use `variant="preview"`. Note that this also means virtualization can never engage (DataGrid.tsx:598).
     - **(b)** Make `gridMode` suppress or remove the tab stops of resize, pin, sort and filter controls.
   - Add a test asserting that exactly one element inside the grid has `tabindex="0"`.

2. **Fix the spec's required-field scenario and specify empty-value encoding.**
   - spec.md:73-75 ("clears a cell for a field declared `required` → error, not submitted") contradicts Decision 3a (design.md:267-273, a required field with a default may be cleared).
   - Split it into two scenarios: required with no default is blocked; required with a default is allowed and reverts to the default after save.
   - Also state that an emptied editor is sent as JSON `null`, never `""`.
     - The server treats only `JsNull` as missing (DatasetRowValidator.scala:122-123).
     - `""` passes a `StringType` field (:67). A required string field would then persist empty, and a defaulted field would never revert.
   - Add this to Decision 3a, task 3.5 and a 5.1 test.

3. **Finish the keyboard contract, in the spec too.**
   - Specify what happens to an in-progress edit on `Tab`/`Shift+Tab` and on blur: commit, cancel, or keep pending. Right now focus leaves the grid from inside an editor with undefined edit state.
   - Specify what ArrowDown/ArrowUp do at the last/first row of a page: stop, or cross pages.
   - Round-2 CR 7 asked for these in the spec, and the spec's "Full keyboard operability" requirement (spec.md:117-134) still omits both:
     - "`Enter` while editing commits and moves down";
     - "`Delete`/`Backspace` delete a row only in navigation mode".
   - Add both, plus a scenario for "Backspace inside an editor never deletes the row".

4. **Make the measurement task concrete and reconcile it with the 500-row cap.**
   - Decision 9 (design.md:320-321) still says "navigating 100+ pages". That is impossible, since dataset rows are capped at `staticMaxRows = 500` (DataSourceService.scala:64), which is at most 5 pages of 100.
   - Task 5.7 still says only "a multi-page dataset … many pages". Round-2 CR 7 required:
     - a stated seed count (e.g. 300 to 500 rows, at least 3 pages);
     - an assertion that every rows request carries `limit=100`, plus `cursor` after page 0, and never omits `limit`;
     - the mounted DOM row count recorded as a number on each page visited.
   - Rewrite Decision 9 and task 5.7 accordingly.

5. **Make the owner-mandated regression check (task 2.3) unambiguous.**
   - Design.md:157 lists the consumers as "table panels, sources list, etc.". The sources list is not a consumer.
   - Enumerate the actual five: `TableRenderer.tsx`, `SourceDetailPanel.tsx`, `SqlTab.tsx`, `ConnectorsPage.tsx`, `StepCard.tsx`.
   - Specify how "before" is captured. Two acceptable options:
     - the per-consumer snapshot/role test is committed first, against unmodified `DataGrid.tsx`, and its snapshot files show zero diff after the DataGrid change;
     - or an equivalent self-authenticating mechanism.

     "Run before and after" with no mechanism can be satisfied by generating the snapshot only after the change, which proves nothing.

6. **Put the virtualization-vs-focus guarantee in `DataGrid`, as C1 states, and fix the Risks vs 5.8 contradiction.**
   - C1 lists "cell-level focus surviving virtualization" as a property of the new DataGrid props. The design relies only on a wrapper constant, `DATASET_GRID_PAGE_SIZE = 100`. As a result, `gridMode` combined with more than 150 rows in `"full"` is left broken inside DataGrid for any future consumer.
   - The cheapest faithful fix is: `gridMode` disables windowing inside DataGrid (or CR 1(a) makes it moot), with a unit test of `gridMode` at more than 150 rows.
   - Separately, Risks (design.md:355-358) says task 5.8 "catches a regression only in this grid's own constant", while task 5.8 says it fails if "either constant" changes. `VIRTUALIZATION_ROW_THRESHOLD` is exported (DataGrid.tsx:196), so 5.8 can import it. Make both say the same thing.

### Non-blocking notes

- Decision 6 / task 3.3 still say BinaryRefType is "excluded from the tab order's editable cells, but still a focus stop". Rephrase it as "navigable; Enter/F2 is a no-op".
- The APG grid pattern also defines Home/End and Ctrl+Home/End. Consider listing them, or explicitly deferring them.
- The walk-to-last-page on add is O(pages). That is fine at the 500-row cap, but note the coupling in Risks.
- The spec's "Explicit refresh" scenario is still filed under the keyboard requirement.
- The backend half (Decisions 1, 2, 10; tasks 1.x) remains sound.
