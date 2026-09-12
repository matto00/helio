## 1. ### Frontend — shared field-declaration editor

- [x] 1.1 Add `CANONICAL_FIELD_TYPES: DatasetFieldType[]` (all 7 canonical types, no `double`, same
      order as the backend's `CanonicalWireValues`) as a single export in
      `frontend/src/features/sources/types/dataSource.ts`; verify with a real cross-check, not a
      hand-copied same-spec twin — either (a) a test that parses
      `backend/src/main/scala/com/helio/domain/model/model.scala`'s `CanonicalWireValues` literal
      (mirroring `scripts/check-schema-drift.mjs`'s approach to reading Scala source from a JS/TS
      test) and asserts it equals `CANONICAL_FIELD_TYPES`, or (b) deriving both from a single
      shared source (e.g. a `schemas/` enum) if one already exists for this type set — pick
      whichever the codebase's existing drift-check precedent supports, and state which was used.
      Also verify a repo-wide grep of `frontend/src` for other canonical-type array literals finds
      none outside this one export.
- [x] 1.2 Extract a `FieldDeclarationTable` component (name, type `Select` from
      `CANONICAL_FIELD_TYPES`, `required` checkbox, `default` input gated on
      `useDatasetFieldEditor`'s editor kind — no `default` input for `binary-ref`, reorder via
      up/down icon buttons, remove button) usable from both create and edit flows; verify with a
      component test covering add/remove/reorder/type-change and the `binary-ref` no-default case.
- [x] 1.3 Wire `FieldDeclarationTable`'s actions per design.md Decision 6: after a reorder, move
      focus to the MOVED row's own name input (never a button that can become disabled) and
      announce its new position via a live region; after a remove, move focus to the NEXT
      remaining field's name input (or the "Add field" control if none remain) and announce the
      removal; verify with a test asserting focus lands correctly for each case (reorder-to-
      boundary, and remove including the zero-fields-remaining case).
- [x] 1.4 Widen `StaticColumn.type` from `StaticColumnType` to `DatasetFieldType` in
      `types/dataSource.ts` (no wire-shape change — the backend already accepts any canonical
      type string in this field); verify `createStaticSource`'s existing tests still pass and a
      new test creates a dataset with a `timestamp`, `string-body`, and `binary-ref` field.
- [x] 1.5 Update `StaticSourceForm.tsx`'s "columns" step to use `FieldDeclarationTable` in place of
      its current name+type-only table, carrying `required`/`default` through on submit (already
      supported by `StaticColumn`); when columns are reordered, permute each already-entered row's
      cells in `rows` to match the new column order (mirroring `removeColumn`'s existing re-slice
      at `StaticSourceForm.tsx:43-46`); verify `StaticSourceForm`'s existing tests still pass, a
      new test asserts a created dataset's declared schema includes `required`/`default`, and a
      test asserts reordering columns after entering row data keeps each row's cells aligned to
      the new column order.
- [x] 1.6 Confirm the "rows" step still accepts zero rows (create-without-data path unaffected);
      verify via existing zero-row create test, extended if needed.

## 2. ### Frontend — schema-edit surface

- [x] 2.1 Add a schema-edit panel to the dataset detail view (`/sources/:id`, alongside
      `DatasetRowGrid`) using `FieldDeclarationTable` pre-populated from `fetchDatasetSchema`;
      verify it renders the current declared fields.
- [x] 2.2 Implement the two predicted-client-side cases (design.md Decision 3's table): disable
      submit with an inline reason when a required field with no default is added to a dataset
      with `datasetRowsSlice.ts`'s row count > 0; require the drop-confirmation dialog (task 2.3)
      whenever any field is removed and the dataset's row count > 0 (never per-field — design.md
      Decision 3a); verify with a test for each predicted case, including that a zero-row dataset
      requires neither.
- [x] 2.3 Add the drop-confirmation dialog: on confirm, submit with `confirmDrop: true`; on cancel,
      return focus to the field editor's remove-button-triggering row; verify with a test that
      confirming sends `confirmDrop: true` and cancelling leaves the field undropped with focus
      restored.
- [x] 2.4 Wire submit for the two attempt-then-surface cases (retype, tighten-to-required) and for
      rename/reorder (sent directly, no prediction) to `updateDatasetSchema`; on `200` apply and
      toast a message reflecting `rowsMigrated` (state explicitly: "No rows affected" for `0`,
      "`<n>` rows updated" otherwise); on `409` (`SchemaUpdateConflictResponse`) keep the editor
      open with the in-progress edit intact and show each `rejectedFields[].reason` inline next to
      its field; on a structural `400` (not `SchemaUpdateConflictResponse`-shaped, e.g. a
      rename/drop name collision) show a single non-field-specific inline error banner in the same
      editor; verify with a test for each of: 200, 409, and 400.
- [x] 2.5 Add a parser (extend `parseDatasetRowValidationError.ts`'s pattern, or a sibling) that
      distinguishes a `409` `SchemaUpdateConflictResponse` body (per-field `rejectedFields`) from a
      structural `400` body (no `rejectedFields`) and returns the right shape for task 2.4's
      rendering; verify with unit tests covering both response shapes.

## 3. ### Frontend — accessibility & keyboard operability

- [x] 3.1 Ensure every new control (type `Select`, `required` checkbox, `default` input, reorder
      buttons, remove button, confirm-drop dialog's confirm/cancel buttons, error banner's
      dismiss control if any) has a computed accessible name; verify via
      `e2e/focus-presence-guard.spec.ts` (HEL-520) passing with the new controls present.
- [x] 3.2 Verify the entire create-dataset flow (open modal → dataset tab → name → add fields →
      set type/required/default → reorder → remove → submit) is completable using only keyboard
      navigation (Tab/Shift+Tab/Enter/Space/Arrow as appropriate) — manual keyboard-only pass plus
      an e2e assertion of focus landing correctly after each async step, per task 1.3's focus
      contract (HEL-1080 lesson: watch for `.focus()` on a still-disabled control).
- [x] 3.3 Verify the same for a schema edit, including the confirm-drop dialog and both the
      client-predicted and attempt-then-surface paths, keyboard-only.

## 4. ### Tests — real-backend e2e

- [x] 4.1 Add `e2e/hel1079-dataset-management-ui-live.spec.ts` (template:
      `e2e/hel1080-dataset-row-grid-live.spec.ts`) covering: create a dataset with 3+ fields
      (including one `required` field with a `default`, and one non-default-bearing field of a
      non-legacy canonical type such as `timestamp`) via real keyboard input against the live
      backend, and verify the created source's schema via `GET .../schema`.
- [x] 4.2 In the same spec, add a rejected schema-edit case against the live backend: retype an
      existing field to a type incompatible with at least one already-stored row value, and verify
      the UI surfaces the `409` reason inline without closing the editor or losing the
      in-progress edit.
- [x] 4.3 Add a real-backend case for the drop-with-data confirmation path: drop a field on a
      dataset with existing rows, confirm the dialog, and verify (a) the request carried
      `confirmDrop: true`, and (b) the row's value for that field is gone via a follow-up row
      fetch.
- [x] 4.4 Add a real-backend case for the add-required-without-default predicted-block path:
      attempt to add a required field with no default to a non-empty dataset via the UI, and
      verify submit is disabled with an inline reason and NO request is sent (assert via network
      log / request count).

## 5. ### Tests — visual cohesion

- [x] 5.1 Screenshot the new create-flow field editor and the schema-edit panel (including the
      confirm-drop dialog and a rendered 409 rejection state) in both light and dark theme, next
      to an existing Sources surface (e.g. `AddSourceModal`'s CSV tab or `DatasetRowGrid`), saved
      to the run's evidence dir; verify DESIGN.md token compliance and visual cohesion with
      neighboring Sources UI in both themes.
