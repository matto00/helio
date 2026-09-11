## Skeptic Report — design gate (round 4, skeptic-design-4.md)

Reviewed HEAD 50993f49 (planning artifacts untracked under `openspec/changes/dataset-row-grid-ui/`).
Re-read cold: ticket.md, workflow-state.md (C1), proposal.md, design.md, tasks.md, both spec deltas.
Checked against `frontend/src/shared/ui/DataGrid.tsx` and `DatasetRowValidator.scala`.

### What I verified (with evidence)

- **R3 CR1 (variant / tab stops): FIXED.** design.md:99-106 and task 4.1 mandate `variant="preview"`.
  Code confirms `resizable`/`pinnable` = `variant === "full"` (DataGrid.tsx:402, :407), sort/filter
  likewise (:403-404), resize separator `tabIndex={0}` only under `resizable` (:999-1005),
  virtualization only for `"full"` (:598). Exactly-one-`tabindex="0"` test is in task 4.1
  (design.md:106 says "Task 4.2" — trivial misreference).
- **R3 CR2 (required/empty): PARTIALLY FIXED.** Spec split into two scenarios (spec.md:25-33),
  JSON `null` for explicit clear (design.md:245-252, task 3.5). But see CR 1 below — the fix
  introduced a new hole against the AC.
- **R3 CR3 (keyboard contract): MOSTLY FIXED.** Enter-commits-and-advances, Tab-commits,
  Delete/Backspace-only-when-not-editing, page-boundary hold are all in spec.md:76-110,
  tasks 4.2 and 5.6. Shift+Tab and blur remain gaps (CR 3).
- **R3 CR4 (measurement): FIXED.** Decision 9 (design.md:296-307) and task 5.7: 500-row seed,
  explicit `limit=100` + `cursor` assertions, literal DOM row count `<= 100` on all 5 pages.
- **R3 CR5 (regression check): FIXED.** Five consumers named with paths (design.md:108-119,
  task 2.3); all four non-SourceDetailPanel paths exist on disk. "Before" captured from `main`.
- **R3 CR6 (virtualization scope): first half FIXED** (design.md:154-164, C1 text in
  workflow-state.md matches). **Second half NOT fixed** — see CR 2.
- Backend half (Decisions 1, 2, 10; tasks 1.x) and schema-api spec: still sound.

### Verdict: REFUTE

One blocking defect against a literal AC ("required fields can't be emptied"), introduced by
round 3's fix, plus two small unresolved remnants. All three are wording-level fixes.

### Change Requests

1. **A required, no-default `StringType`/`StringBodyType` field can be emptied and persisted as `""`.**
   (Blocking — violates AC "required fields can't be emptied".)
   - design.md:246-252 says a typed empty string "is validated as a string value like any other".
   - The server accepts it: `(StringType, _: JsString) => Right(())` (DatasetRowValidator.scala:67).
     Only `JsNull` counts as missing (:122-123).
   - The "clear" affordance exists only "for fields with a default" (design.md:250-251), so a
     required no-default field is never nulled. The only way to empty it is backspacing to `""`,
     which the design explicitly lets through.
   - The result: the spec's "Required field with no default cannot be emptied" scenario
     (spec.md:25-27) can't fire for string fields. It is also ambiguous about what "clears" means.
   - Required fixes, in Decision 3a, task 3.5, spec.md, and a 5.1 test:
     - (a) **Client-side:** for a `required` field with no `default`, an empty editor value counts
       as emptied and is blocked, including `""` for string types. The error goes on the cell and
       nothing is submitted. Say this explicitly, and scope the "empty string is an ordinary value"
       sentence to non-required fields (or drop it).
     - (b) **Clear availability:** state which fields offer the explicit clear action. At minimum:
       required-with-default fields (revert to default) and optional (non-required) fields (set to
       `null`). Right now an optional no-default Integer/Timestamp field has no way to be nulled.
     - (c) **Empty non-string editors:** state what is submitted when a numeric or timestamp editor
       is emptied — presumably the same as clear (`null`), never `""`. Otherwise it produces an
       "expected integer, got string" 400.
     - (d) **Test:** add a 5.1 case that backspaces a required no-default string cell to empty via
       real keyboard input, then asserts a cell error and that no PATCH was sent.

2. **The Risks paragraph still contradicts task 5.8.** (R3 CR6 second half; unchanged.)
   - design.md:340-345 says 5.8 "catches a regression only in this grid's own constant, not in
     `DataGrid`'s threshold moving".
   - Task 5.8 says it "fails loudly if either constant is changed".
   - design.md:132-134 hardcodes "raised to 150 or above".
   - `VIRTUALIZATION_ROW_THRESHOLD` is exported (DataGrid.tsx:196). Make 5.8 import it and
     assert `DATASET_GRID_PAGE_SIZE < VIRTUALIZATION_ROW_THRESHOLD`, then make Decision 0a and
     Risks say that same thing (and drop the "follow-up if threshold needs to be discoverable"
     clause — it already is).

3. **Shift+Tab from an in-cell editor, and blur, are unspecified or untested.**
   - With the editor rendered inside the `tabindex="0"` gridcell, a native Shift+Tab from the
     `<input>` lands on the containing `<td>`, not outside the grid. That breaks spec.md:79-80
     ("`Tab`/`Shift+Tab` commits … then moves focus out of the grid").
     - Task 4.2 must say the wrapper intercepts Shift+Tab (and Tab) while editing: commit, then
       move focus out.
     - Task 5.6 must add a Shift+Tab-while-editing test, not only Tab.
   - Round 3 CR3 also asked about blur (pointer click elsewhere while editing), and it is still
     undefined. Pick one — commit, the recommended choice since it is consistent with Tab — and
     state it in Decision 0, spec.md and task 4.2.

### Non-blocking notes

- design.md:106 "Task 4.2 adds a test" → the test is in task 4.1.
- Decision 6 / task 3.3 still say BinaryRefType is "excluded from the tab order's editable cells, but
  still a focus stop". Clearer: "navigable; Enter/F2 is a no-op".
- Enter-while-editing on the last row of a page: say it commits and holds, matching the
  ArrowDown boundary rule.
- Task 5.7 seeds exactly 500 rows (the cap). Any add-row test must use a separate, non-full
  dataset, or append will be rejected.
- The "Explicit refresh" scenario is still filed under the keyboard requirement.
