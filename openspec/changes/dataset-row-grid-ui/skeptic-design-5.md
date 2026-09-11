## Skeptic Report — design gate (round 5, skeptic-design-5.md)

Reviewed HEAD 50993f491f5efbe1875cf06451e08ac44be6c1a9. The planning artifacts are untracked under
`openspec/changes/dataset-row-grid-ui/`. I read these fresh: ticket.md, proposal.md, design.md, tasks.md,
both spec deltas, the workflow-state.md C1 constraint, and skeptic-design-4.md (read as claims only). I
checked them against `frontend/src/shared/ui/DataGrid.tsx`,
`backend/.../domain/engine/DatasetRowValidator.scala`, `DataSourceRepository.patchRow` (:478-518) and
`DataSourceService.patchRow` (:810-830).

### What I verified (with evidence)

**R4 CR1 (null vs. empty string): FIXED, for every field type.**
- Server semantics are confirmed in DatasetRowValidator.scala:
  - `""` is accepted for String and StringBody (:67-68).
  - Only `JsNull` counts as missing (:122-123).
  - A missing value falls back to the default (:131); with no default it fails as required (:133) or becomes null (:134).
- PATCH replaces the full row. `patchRow` runs `DatasetRowValidator.validate(declaration, Vector(data))` (Repository:499), so a submitted `null` goes through exactly those default-fill rules.
- Design Decision 3a, task 3.5 and the spec requirement plus both scenarios now agree:
  - For String, StringBody, Integer, Float and Timestamp, an emptied editor always submits `null`, never `""`.
  - A required field with no default is blocked on the client.
  - A required field with a default, or any non-required field, submits `null`.
  - Boolean is excluded, because it always has a value.
  - BinaryRef is read-only (Decision 6) and cannot be emptied from the grid.
- Every editable type therefore maps onto a server branch. No path is left that lets `""` reach a required field with no default.
- Task 5.6a adds a per-type matrix driven by real keyboard input. It asserts that no PATCH is sent and that the body carries `null`, not `""`. This covers R4 CR1(d).

**R4 CR2 (virtualization framing): FIXED in substance.**
- DataGrid.tsx:598 reads `const virtualized = variant === "full" && rows.length > VIRTUALIZATION_ROW_THRESHOLD;`.
- DataGrid.tsx:196 reads `export const VIRTUALIZATION_ROW_THRESHOLD = 150;`.
- The row slice is only windowed when `virtualized` is true (:625). `resizable` and `pinnable` are `variant === "full"` (:402, :407).
- So `variant="preview"` means this grid never virtualizes, whatever the row count. That claim is correct.
- Decision 0a, the scope paragraph, Risks, task 5.8 and C1 (in both tasks.md and workflow-state.md:32) all say the same thing. The round-4 contradiction between Risks and 5.8 is gone.

**R4 CR3 (Shift+Tab and blur): FIXED.**
- design.md:99-112, task 4.2a, two new spec scenarios (spec.md:102-113) and task 5.6 cover interception on the editor element for both Tab directions, then a programmatic `.focus()` outside the grid, plus commit on blur.
- It can be built: a keydown handler with `preventDefault` plus a query for tabbable elements in document order outside the grid container.
- No focus trap: the handler always sends focus out of the grid and never back into it.
- No infinite loop: the programmatic focus fires one blur on the editor, and the commit does not move focus again.
- One real double-commit hazard remains. I rate it as something execution must guard, not a design defect. See note 1.

**Final sweep across artifacts:**
- Every ticket AC (HEL-1080 and HEL-1122) still traces to a task: edits persist (3.1, 4.4), refresh (4.8, 5.1), keyboard (4.2, 4.2a, 5.6), stale UX (3.4, 4.6), field errors, editors and required (3.3, 3.5, 4.5, 5.6a), Redux (3.1), optimistic update plus rollback (Decision 4, 5.2), paging measured (5.7), a11y (5.3, 5.4), visual cohesion (5.5), real UI input (5.1). HEL-1122 is covered by 1.1-1.6.
- Decision 0 says "native Tab once no cell holds the roving target" for the non-editing state. The new paragraph covers the editing state. They are complementary, not contradictory.
- The round-4 note "Task 4.2 adds a test" is fixed. design.md:121 now says Task 4.1, which matches tasks.md:31.
- I found no TODOs or TBDs.

### Verdict: CONFIRM

All three round-4 change requests are resolved and check out against the actual code. The remaining items
below are implementation details or leftover wording. None of them blocks the design, and none would lead
an implementer to build the wrong thing.

### Non-blocking notes (the orchestrator should give note 1 to the executor as a binding implementation detail)

1. **Guard against a double commit on Tab, Enter and Escape.**
   - As written, both the Tab handler and the blur handler commit. The Tab handler's own `.focus()` fires the editor's blur synchronously, before React re-renders, so a naive implementation commits twice.
   - The second PATCH carries the old `updatedAt`, which triggers a false 409 conflict on the user's own edit.
   - Enter has the same problem: it commits and advances, and the focus move blurs the editor.
   - Escape is worse: cancelling and returning focus to the `<td>` blurs the editor, which could commit the discarded value. That contradicts "Escape cancels and restores". spec.md:110 excludes Escape from the blur rule, but design.md:109-112 and task 4.2a say "any other focus-loss cause" without naming a mechanism.
   - Implement the edit session as ended by the first terminal action, whether commit or cancel, using a synchronous ref flag. Blur should do nothing once the session has ended.
   - Tests 5.1 and 5.6 should assert exactly one PATCH per Tab or Enter commit, and zero PATCHes on Escape.
2. **Leftover threshold framing.**
   - tasks.md:34 (4.3) and spec.md:128-129 still justify "no unmount" by "page size under the 150-row threshold".
   - The statement is true (100 < 150), but the reason given is not the one Decision 0a states.
   - Reword both to cite `variant="preview"` when archiving.
3. **Tab from the grid with nothing focusable after it.** If no tabbable element exists after the grid (or before it, for Shift+Tab), the handler should commit and then let the browser's default Tab run, rather than calling `.focus()` on nothing.
4. **Committing an unchanged cell.** Existing rows can already hold `""` in a required field with no default, because the server accepts it. Opening such a cell and committing it without a change should do nothing, not raise the "cannot be emptied" error. Only an actual user edit should trigger the check.
5. **`default: null` declarations.** `validateDefault` accepts a declared default of JSON null (Validator:86). A required field declared that way would have a default under the client rule, so a clear is allowed, but the server then stores `null`. For the client check, treat a `default` that is absent or `null` as "no default". Also note that spray writes `Some(JsNull)` as `"default": null`, not as an absent key.
6. **Carried over from round 4, still open:**
   - Enter while editing on the last row of a page should commit and hold.
   - An add-row test must use a dataset that is not full, because 5.7 seeds the 500-row cap.
   - The "Explicit refresh" scenario still sits under the keyboard requirement.
