# Files modified — HEL-1079

- `frontend/src/features/sources/types/dataSource.ts` — added `CANONICAL_FIELD_TYPES` (all 7
  canonical types, backend order); widened `StaticColumn.type` from `StaticColumnType` to
  `DatasetFieldType` (design.md Decision 4).
- `frontend/src/features/sources/types/canonicalFieldTypesDriftGuard.test.ts` — new: cross-checks
  `CANONICAL_FIELD_TYPES` against the backend's `CanonicalWireValues` literal directly (reads
  `model.scala`, mirrors `scripts/check-schema-drift.mjs`'s approach) and greps `frontend/src` for
  any other canonical-type array literal.
- `frontend/src/features/sources/ui/FieldDeclarationTable.tsx` — new: shared name/type/required/
  default/reorder/remove field editor used by both the create flow and the schema-edit surface;
  owns the design.md Decision 6 focus contract (reorder → moved row's name input + live-region
  announcement; remove → next remaining row's name input, or "Add field" if none remain) and the
  `onBeforeRemove` interception point the schema-edit surface uses for the drop-confirmation flow.
- `frontend/src/features/sources/ui/FieldDeclarationTable.test.tsx` — new: add/remove/reorder/
  type-change, the `binary-ref` no-default case, and the full focus-contract matrix (reorder to
  top/bottom boundary, remove with/without remaining fields).
- `frontend/src/features/sources/ui/forms/StaticSourceForm.tsx` — "columns" step now renders
  `FieldDeclarationTable` in place of the old name+type-only table; carries `required`/`default`
  through to `StaticColumn` on submit; permutes already-entered row cells on a field reorder
  (mirroring the existing `removeColumn` re-slice).
- `frontend/src/features/sources/ui/forms/StaticSourceForm.test.tsx` — updated existing tests for
  the new "Field N ..." labels; added tests for the full canonical type set (timestamp/
  string-body/binary-ref) with required/default, reorder-then-row-alignment, and the
  zero-row create path.
- `frontend/src/features/sources/ui/AddSourceModal.test.tsx` — updated one label reference
  ("Column 1 name" → "Field 1 name") and the expected `createStaticSource` payload (`required:
  false` now always present).
- `frontend/src/features/sources/ui/DatasetSchemaEditor.tsx` — new: the schema-edit panel mounted
  on `/sources/:id` alongside `DatasetRowGrid`. Implements design.md Decision 3/3a: blocks submit
  client-side (with an inline reason) for a newly-added required-no-default field on a non-empty
  dataset; intercepts a field removal via `FieldDeclarationTable`'s `onBeforeRemove` to show an
  explicit confirm dialog before applying+submitting a drop with `confirmDrop: true` on a
  non-empty dataset (no confirmation on a zero-row dataset); submits rename/reorder/retype/
  tighten-to-required directly and renders the API's 200/409/400 response inline without losing
  the in-progress edit.
  **Cycle 2 (evaluation-1.md CR1/CR2):**
  - **CR1 root cause (confirmed via code-level probe, not a guess-patch):** on a successful PATCH,
    the old code reset `seededSchemaRef`/`rows` to `null` and relied on the seeding `useEffect`
    to re-populate `rows` once the separately-dispatched `fetchDatasetSchemaThunk` resolved. That
    dispatch is fire-and-forget (`void dispatch(...)`) — on the very next render, before the
    thunk's promise settled, `schema` in Redux was still the STALE pre-drop object, which already
    satisfied the effect's `schema !== seededSchemaRef.current && rows === null` guard and
    re-seeded `rows` from the stale data. That guard fires at most once per null-window, so once
    the thunk's genuinely fresh `schema` later arrived, `rows` was no longer `null` and the effect
    never re-seeded — the dropped field stayed on screen until a hard reload. Fixed by building
    `rows` directly from the PATCH response's own authoritative `fields` (new `schemaFieldsToRows`
    helper, shared with the initial seeding effect) instead of waiting on any later Redux update —
    eliminates the race by construction.
  - **CR2:** `handleConfirmDrop` now replicates `FieldDeclarationTable.removeRow`'s own on-remove
    focus targeting (which `onBeforeRemove` bypasses for this path) — focus moves to the next
    remaining field's name input (by 1-based position), or "Add field" if none remain, applied via
    a `pendingConfirmFocusRef` + `useEffect` once `rows` has actually re-rendered without the
    dropped field.

  **Cycle 3 (skeptic-final-1.md CR1/CR2 — REFUTE round 1):**
  - **CR1 (genuine functional defect, not a follow-on of cycle 2's fix):** `handleConfirmDrop`
    called `setRows(nextRows)` **before** `submitSchema` ever ran, so a 409/400 on the confirmed
    drop left the field visually gone even though the server had rejected the whole request and
    kept it — worse, the field's own Remove button no longer existed to re-trigger the confirm
    dialog, a genuine dead end recoverable only by a reload. `submitSchema` now returns
    `Promise<boolean>` and is the **only** place `rows` is ever advanced to reflect a
    server-confirmed edit — no caller (plain save, confirmed drop) advances `rows` before a `200`.
    `handleConfirmDrop` no longer touches `rows` itself at all; on success, `submitSchema`
    (passed a caller-computed `onSuccessFocus` target, set synchronously in the SAME turn as its
    own `setRows` call — not via a `.then()`, to avoid any doubt about ordering against the
    `[rows]`-keyed focus effect) handles both the state update and focus; on failure, the field is
    already still present (since `rows` was never touched) and focus returns to that field's own
    Remove button (the same target `handleCancelDrop` already uses). The stale, now-corrected
    comment claiming rows are "never advanced past this point on failure" is fixed to state the
    invariant that's now actually true for every path, not just describe the old (buggy) one.
  - **CR2 (styling):** added co-located `DatasetSchemaEditor.css` (root/`__actions` rhythm via
    `--space-*`) and routed the field-rejection and predicted-block messages through the already-
    imported shared `InlineError` primitive (banner/error kind) instead of hand-rolled `<p>` tags,
    so they pick up `--app-error` for free. `SourceDetailPanel.css`'s existing
    `.source-detail-panel__schema/__preview/__rows` selector groups were extended to include the
    new `.source-detail-panel__schema-edit` section so it inherits the same margin/border/padding
    rhythm as its sibling sections, rather than shipping with none.
- `frontend/src/features/sources/ui/FieldDeclarationTable.css` — new (cycle 3, skeptic-final-1.md
  CR2): `--space-*`-based layout for the field-declaration table's root and its reorder/remove
  action cell, which previously had no rules of its own (only borrowed `add-source-modal__*`
  classes), so the three icon buttons stacked cramped with no spacing.
- `frontend/src/features/sources/ui/DatasetSchemaEditor.css` — new (cycle 3, see above).
- `frontend/src/features/sources/ui/SourceDetailPanel.css` — extended (cycle 3, see above) to give
  the new "Schema" section the same spacing rhythm as its sibling sections.
- `frontend/src/theme/motionTokenGuard.css.test.ts` / `elevationTokenGuard.css.test.ts` — cycle 3:
  bumped the pinned "every CSS file in frontend/src" count from 111 to 113 to reflect the two new
  CSS files above (both are genuinely walked and found to add zero motion/elevation declarations,
  as expected for pure layout/spacing rules).
- `frontend/src/features/sources/ui/DatasetSchemaEditor.test.tsx` — new: covers the loaded-schema
  render, add-optional (no confirm), block-on-required-no-default (non-empty vs. zero-row),
  drop-confirm (show/confirm/cancel, confirmDrop true/omitted by row count), 409 conflict
  (per-field reason, editor stays open), structural 400 (banner), and 200 (toast wording).
  **Cycle 2:** added regression tests for CR1 (dropped field disappears from the on-screen table
  immediately on success, no reload) and CR2 (focus lands on the next remaining field's name
  input, or "Add field" when the last field is dropped).
  **Cycle 3:** added a regression test for a REJECTED confirmed drop (the field stays on screen
  with its rejection reason, its Remove button still exists, and focus returns to it) — the exact
  gap the skeptic named as "the test gap that let this ship"; the two existing focus-after-confirm
  tests were updated to `await waitFor(...)` since focus now applies only once the (mocked, async)
  PATCH resolves, not synchronously on click.
- `frontend/src/features/sources/ui/SourceDetailPanel.tsx` — mounts `DatasetSchemaEditor` in a new
  "Schema" section above the existing "Rows" section for a dataset-kind source.
- `frontend/src/features/sources/utils/parseSchemaUpdateError.ts` — new: distinguishes a `409`
  `SchemaUpdateConflictResponse` body from a structural `400` (no `rejectedFields`) from any other
  axios/non-axios error.
- `frontend/src/features/sources/utils/parseSchemaUpdateError.test.ts` — new: covers all three
  shapes plus the message-fallback path.
- `e2e/hel1079-dataset-management-ui-live.spec.ts` — new: real-backend Playwright coverage for
  create-with-3-fields (incl. a required+default field and `timestamp`), a rejected retype (409,
  editor stays open), a confirmed drop-with-data (`confirmDrop: true` verified on the wire, row
  value gone via follow-up fetch), and the required-no-default block (no PATCH sent).
  **Cycle 2:** the create test's "Add source" selector was scoped to `#app-main-content` (a
  brand-new test user has zero sources, so `SourcesPage` renders the empty-state's own "Add
  source" CTA instead of the post-first-source toolbar button — both share the same accessible
  name, so an unscoped locator was ambiguous); added CR1 (on-screen table reflects the drop
  immediately, no reload) and CR2 (focus lands on the next remaining field's name input) real-
  backend assertions to the drop-confirm test.
- `openspec/changes/dataset-management-ui/tasks.md` — all 19 tasks marked complete.

## Verification evidence

- `e2e/focus-presence-guard.spec.ts` (HEL-520) run fresh against this change, both themes,
  including `/sources/:id` for a dataset source carrying the new schema-edit controls: **1
  passed**, 246 elements measured across 10 views, 0 findings.
- Visual-cohesion screenshots (create-flow field editor next to `AddSourceModal`'s CSV tab;
  schema-edit panel with a rendered 409 rejection; the confirm-drop dialog — light + dark) saved
  to `.concertino/runs/HEL-1079/evidence/hel1079-*.png`. Reviewed for DESIGN.md token compliance
  (surface/border/accent/spacing tokens, no ad-hoc styling) and cohesion with the existing
  create-source modal and dataset detail view in both themes — the one-off screenshot spec used
  to generate them was not committed (hardcoded local host path, not a portable regression test).

## Known pre-existing issue (not introduced by this change)

- `e2e/focus-presence-guard.spec.ts:163`'s duplicate "HEL-520 Guard Dashboard" flake (HEL-1119) —
  not observed in this run's execution (the run passed clean), noted here per the driver's
  standing guidance in case it appears on a re-run.

## Scope note

- No backend/migration work was needed or added — the full contract
  (`GET`/`PATCH /api/data-sources/:id/schema`, dataset-kind `POST /api/data-sources`) already
  existed per `openspec/specs/dataset-schema-api/spec.md`, confirming the design's premise.
