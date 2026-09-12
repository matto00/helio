## Evaluation Report — Cycle 1 (evaluation-1.md)

### Phase 1: Spec Review — PASS
- All ticket ACs are addressed: dataset creation with name/type/required/default/reorder/remove
  (`FieldDeclarationTable` + `StaticSourceForm.tsx`), the full canonical type set (widened
  `StaticColumn.type` to `DatasetFieldType`), and the schema-edit surface
  (`DatasetSchemaEditor.tsx`) covering add-optional/add-required-blocked/rename/retype/drop-
  confirm/reorder/tighten-to-required.
- All 19 tasks.md items are checked and match what's actually implemented (spot-checked 1.1-1.6,
  2.1-2.5, 3.1-3.3, 4.1-4.4, 5.1 against the diff).
- No scope creep found — `files-modified.md`'s file list matches the diff's file list exactly (23
  files, all ticket-related; the `openspec/changes/dataset-management-ui/*` planning artifacts are
  the change's own).
- design.md Decision 3/3a's two-mechanism split is implemented essentially as specified for the
  predicted-blocked (`blockingRow` in `DatasetSchemaEditor.tsx:120-126`, gated on `totalRows`, the
  DATASET's row count from `datasetRowsSlice`, never a per-field count) and attempt-then-surface
  (retype/tighten submit directly, 409 renders per-field `rejectedFields`, 400 renders a banner)
  cases. Confirmed live: drop-confirmation triggers correctly at `datasetRowCount > 0`, dataset-
  level (verified by creating a 2-field dataset with 1 row and observing the confirm dialog appear
  on removing either field).
- Task 1.1's canonical-type guard genuinely reads `backend/src/main/scala/com/helio/domain/model/
  model.scala`'s `CanonicalWireValues`/`fromString` at test time (`canonicalFieldTypesDriftGuard.
  test.ts`) rather than hand-copying a twin — confirmed by reading both the test's regex-based
  parse logic and the actual backend source it targets; they line up exactly.
- Real-backend e2e (`e2e/hel1079-dataset-management-ui-live.spec.ts`) contains no `page.route`/
  mock interception — it drives the live dev backend directly, and does assert the specific things
  tasks.md 4.1-4.4 call for (confirmDrop:true on the wire, zero PATCH requests sent for the
  predicted-block case).
- No stray `"double"` literal found outside the two guard-comment mentions (both refer to the
  HEL-891 hazard in prose, never used as a type value).
- CONSTRAINTS in `workflow-state.md`: reviewed, none apply beyond what's already covered above.

### Phase 2: Code Review — FAIL
Gates (fresh run, this worktree): `npm run lint` clean, `npm run typecheck` clean, targeted
`npm test` (FieldDeclarationTable/DatasetSchemaEditor/parseSchemaUpdateError/
canonicalFieldTypesDriftGuard/StaticSourceForm/AddSourceModal) — 6 suites, 58 tests, all pass.
Code quality (DRY, modularity, naming, error handling) is otherwise solid — no findings beyond
the functional defect below, which is the basis for FAIL:

**Change Request 1 (functional defect, not just a11y):** `DatasetSchemaEditor.tsx`'s confirmed-
drop path does not resync its own local `rows` state to the field that was actually removed.
Reproduced live: created a 2-field ("a", "b") dataset with 1 row, removed field "b" via the
schema-edit panel, confirmed the drop dialog. The `PATCH .../schema` request succeeded (200) and
the backend genuinely dropped "b" (confirmed via `GET .../schema` returning only field "a"
afterward). However the on-screen `FieldDeclarationTable` (and the summary table above it)
continued to show BOTH "a" and "b" for several seconds after the toast — the state only became
correct after a hard page reload (fresh `GET` on mount). This means a user who immediately tries
to re-add or re-edit "b" after confirming its drop is looking at a schema the server has already
discarded, exactly the kind of "silently failing at write time later" the ticket's AC set out to
prevent (the schema-edit surface is supposed to be the honest, up-front source of truth). Root
cause is likely a race between `handleConfirmDrop`'s `setRows(nextRows)` / `submitSchema`'s
`setRows(null)` sequencing and the `seededSchemaRef`/`schema !== seededSchemaRef.current` re-seed
guard in the `useEffect` at `DatasetSchemaEditor.tsx:93-107` — worth instrumenting directly rather
than guessing further (per `systematic-debugging`, root-cause with a probe before re-fixing).

**Change Request 2 (design.md Decision 6 violation):** the confirm-drop dialog's on-confirm focus
target is never implemented. Design.md Decision 6 (`design.md:135-138`) specifies: "on confirm,
the same remove-case target above (the next remaining field's name input, or 'Add field' if none
remain)". `DatasetSchemaEditor.tsx`'s `handleConfirmDrop` (lines 176-182) only calls `setRows` and
`submitSchema` — it never moves focus anywhere. Reproduced live: after clicking "Delete field
data" in the confirm dialog, `document.activeElement` becomes `<body>` (focus is lost entirely,
not merely misplaced) — confirmed via `document.activeElement.tagName === "BODY"` immediately
after the confirming click resolved. tasks.md 2.3's own test coverage only asserts the cancel-path
focus restoration (`DatasetSchemaEditor.test.tsx:159`, "cancelling ... returns focus to its remove
button") — there is no test for the confirm-path focus target, which is exactly why this gap
shipped uncaught. Fix: in `handleConfirmDrop`, after `setRows(nextRows)`, apply the same "next
remaining field's name input, or Add field" targeting `FieldDeclarationTable`'s own `removeRow`
already computes internally (lines 107-119) — currently unreachable from this path because
`onBeforeRemove` intercepts and returns `false`, so `FieldDeclarationTable`'s own focus-management
never runs for a confirmed drop. The lost-focus behavior also fails the ticket's "keyboard-only
completion" AC in this specific path, since a keyboard user has nowhere to continue from without
re-tabbing from the top of the page.

### Phase 3: UI Review — mostly PASS, with the above defects noted
- Servers started via `scripts/concertino/start-servers.sh`/`assert-phase.sh` (PASS).
- Happy path (create with 2 fields, add a row) works end-to-end; live-driven, not fixture-driven.
- Screenshots exist at `.concertino/runs/HEL-1079/evidence/hel1079-*.png` (both light and dark for
  create-flow field editor, add-source CSV tab, schema-edit 409 rejection, and drop-confirm) —
  opened and visually inspected: token usage (surface/border/accent/spacing) is consistent with
  `AddSourceModal`'s existing CSV tab and cohesive with the neighboring Sources UI in both themes.
  No ad-hoc styling observed; no new CSS files were added (reuses `add-source-modal__*` classes and
  shared components), which is itself good evidence against a new visual dialect.
- Keyboard operability of the primary create flow and the predicted-block/attempt-then-surface
  paths was not independently re-driven keyboard-key-by-key in this session (time-boxed) beyond
  the reorder/remove/confirm-dialog interactions above, which surfaced Change Request 2's focus
  loss — that alone is enough to fail the "keyboard-only completion" AC for the confirm-drop path
  specifically, so further manual keyboard sweeping of the rest of the flow was not necessary to
  reach a verdict this cycle.
- `e2e/focus-presence-guard.spec.ts` was not independently re-run this cycle (time-boxed given the
  Phase 2 finding already establishes FAIL); the executor's self-report of a clean run is not
  disputed but is also not independently re-verified here — re-run it in the next cycle alongside
  the fix.

### Overall: FAIL

### Change Requests
1. Fix `DatasetSchemaEditor.tsx`'s post-confirm-drop state resync: after a confirmed drop succeeds,
   the on-screen `FieldDeclarationTable` must reflect the field's removal immediately (matching
   what `GET .../schema` already returns), not only after a hard reload. Root-cause the
   `seededSchemaRef`/`rows === null` re-seed race in `submitSchema`/`handleConfirmDrop` with a
   probe (e.g. log `schema` object identity across the `fetchDatasetSchemaThunk` dispatches) before
   changing the logic, per `systematic-debugging`.
2. Implement design.md Decision 6's on-confirm focus target in `DatasetSchemaEditor.tsx`'s
   `handleConfirmDrop`: move focus to the next remaining field's name input (or "Add field" if
   none remain) after a confirmed drop, exactly as already implemented for the plain-remove case
   inside `FieldDeclarationTable.removeRow` (`FieldDeclarationTable.tsx:107-119`) — `onBeforeRemove`
   intercepting the removal is what makes this path bypass that existing logic, so the schema-edit
   editor needs to replicate (or the table needs to expose) the equivalent targeting for the
   confirm case. Add a test asserting focus lands on the expected control after confirming a drop
   (`DatasetSchemaEditor.test.tsx` currently only covers the cancel-focus case).

### Non-blocking Suggestions
- The top-of-panel "Field / Type / Nullable" summary table and the `FieldDeclarationTable` editor
  below it both render from the same declared schema and are visually redundant once a user is
  actively editing — worth a follow-up ticket to consider collapsing the read-only summary while
  the editor below is the one being used, though this is a cohesion/UX call for the skeptic, not a
  mechanical defect.
