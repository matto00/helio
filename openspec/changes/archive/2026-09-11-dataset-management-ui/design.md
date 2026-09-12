## Context

`AddSourceModal.tsx` already has a `"dataset"` `SourceType` backed by `StaticSourceForm.tsx`
(HEL-1073 renamed `StaticSource`→`dataset`/`static` wire alias). That form already supports:
naming, declaring columns (name + type only, `COLUMN_TYPES = [string, integer, float, boolean]`),
removing a column, entering rows inline, and creating with zero rows. It does **not** support:
`required`/`default` per field, reordering, or the full canonical type set (`timestamp`,
`string-body`, `binary-ref`).

The full HEL-1124 contract (`fetchDatasetSchema`, `updateDatasetSchema`,
`DatasetFieldDeclarationPayload`, `DatasetSchemaUpdateResponse`, `SchemaUpdateConflictResponse`)
already exists in `frontend/src/features/sources/services/dataSourceService.ts` and
`types/dataSource.ts` — HEL-1124 shipped the frontend contract alongside the backend route. There
is no separate dry-run/preview endpoint; `PATCH /api/data-sources/:id/schema` is the only way to
learn whether an edit is accepted.

See proposal.md for motivation; `openspec/specs/dataset-schema-api/spec.md` for the full backend
policy this UI must surface honestly.

## Goals / Non-Goals

**Goals:**
- Extend the existing dataset create path (not fork it) to declare full field schemas
  (name/type/required/default), with reorder, using the canonical type set.
- Add a schema-edit surface on an existing dataset source, reusing HEL-1080's row-grid feature
  area (`/sources/:id`).
- Make every allowed/blocked/confirm-required outcome from the backend policy visible in the UI
  before or immediately upon commit — never a bare, unexplained 409 the user has to guess at.

**Non-Goals:**
- No true "dry-run" endpoint — see Decision 3 for the two-mechanism split that satisfies the AC
  without one.
- No change to `StaticColumnType`'s legacy 4-type set beyond what's needed for the new field
  editor — `StaticColumnType` is superseded by `DatasetFieldType` for anything this change adds.
- No changes to `DatasetRowGrid.tsx` row-editing behavior itself (HEL-1080 territory).

## Decisions

**Decision 1 — Extend `StaticSourceForm`, don't fork it.** The "columns" step becomes a full
field-declaration editor (name, `DatasetFieldType` via `Select`, `required` checkbox, `default`
text input gated by `useDatasetFieldEditor`'s editor-kind mapping, reorder via up/down buttons —
no drag-and-drop, since drag-and-drop is not keyboard-operable without extra ARIA machinery this
ticket doesn't need). Rationale: reuse the modal's existing name/step/error/toast plumbing in
`AddSourceModal.tsx` (F-008 `finishCreate`) rather than duplicating it; the alternative (a
standalone dataset-creation route) would fork `finishCreate`, `useToast`, and `fetchSources`
wiring for no benefit.

**Decision 2 — Reorder is up/down buttons, not drag-and-drop.** A "Move up" / "Move down" icon
button per field row is keyboard-operable by construction (a real focusable `<button>`) and needs
no new ARIA live-region work; drag-and-drop reordering requires one to make keyboard-operable
(HEL-465's pin-toggle history shows this class of control is easy to ship visually-only). Given
the keyboard-only AC is non-negotiable, up/down buttons are the correct default; a future
enhancement ticket can add drag-and-drop with a keyboard fallback if wanted.

**Decision 3 — Schema-edit "preview" is split into two explicit mechanisms per case (skeptic
design-gate round 1, CR1/CR2). There is no dry-run route — `dataSourceService.ts` exposes only
`fetchDatasetSchema` (GET) and `updateDatasetSchema` (PATCH), confirmed against
`dataset-schema-api/spec.md`. So "preview before commit" (ticket AC) is satisfied by exactly one
of two mechanisms per rejection case, chosen by whether the outcome is knowable from data the UI
already holds, never by a single blanket rule:

| Case | Mechanism | Why |
|---|---|---|
| Add a `required` field with no `default` to a non-empty dataset | **Predicted, blocked client-side** | Fully determined by the dataset's own row count (`datasetRowsSlice.ts`'s `total`, already fetched for the same source) — no per-value check needed. The "Save" control is disabled with an inline reason the moment this state is reached, before any request is sent. |
| Drop a field with the dataset having ≥1 row | **Predicted, confirmed client-side** | Same reasoning — see Decision 3a. |
| Retype a field | **Attempt-then-surface** | Requires the server's per-value check against every existing row (`DatasetRowValidator.validateValue`) — not reproducible client-side without fetching every row across every page. |
| Tighten a kept field to `required` | **Attempt-then-surface** | Requires per-field null coverage across the *entire* row set; `DatasetRowGrid` is paged, so the client does not reliably hold this. |
| Rename, reorder | No client-side *prediction* or confirmation needed — neither can be rejected for data-loss/compatibility reasons — submit directly. They CAN still fail structurally with a `400` (e.g. a rename target colliding with a field being dropped in the same request, per `dataset-schema-api/spec.md`'s malformed-identity-mapping rule); that `400` lands in the same non-field-specific inline error banner as any other structural `400` (see below). |

For the two attempt-then-surface cases: the edit is composed in an inline editor identical in
shape to the create-flow's field editor, and submitting it calls `updateDatasetSchema` directly. A
`200` applies immediately (field editor closes, `rowsMigrated` toasted — exact wording per case is
specified in task 2.4: "No rows affected" for `rowsMigrated: 0`, "`<n>` rows updated" otherwise). A
`409`
(`SchemaUpdateConflictResponse`) re-renders the SAME editor with each rejected field's reason
inline (never a bare toast/alert) and does **not** close it — the user edits and resubmits without
losing their in-progress declaration. A structural `400` (not `SchemaUpdateConflictResponse`-
shaped — e.g. the rename/drop-collision case, spec.md's new "malformed identity mapping" scenario)
is shown as a single non-field-specific inline error banner in the same editor, since it has no
`rejectedFields` to attach per-field. This satisfies "make it visible rather than failing at write
time later" because every failure surfaces in the same schema-edit UI flow, before the user ever
leaves it to write a row — never deferred to some future `DatasetRowGrid` write hitting
`DatasetRowValidator`. **The whole request is rejected atomically** (backend: "no partial
application of a multi-field request") — the UI never shows some fields as applied and others
rejected; a `409`/`400` means nothing in the request was applied, full stop.

**Decision 3a — drop-with-data confirmation triggers on the DATASET's row count, not the field's.**
Corrected from round 1 (CR3): the backend rule is *the dataset has ≥1 existing row*, unconditionally
— "regardless of whether the field's existing values happen to all be null" — not whether the
specific field being dropped holds non-null data. The UI reuses `datasetRowsSlice.ts`'s row-count
`total` for the current source (already fetched for `DatasetRowGrid`) — **not**
`fetchDatasetSchema`'s response, which carries no row count at all
(`DatasetSchemaResponse = { fields: [...] }`, `types/dataSource.ts:249-258`). Trigger:
`datasetRowCount > 0` for ANY field removed from the declaration, full stop — never per-field.
When true, the UI shows an explicit confirmation dialog ("This will permanently delete `<field>`'s
data from N rows.") before ever sending the request, requiring an explicit confirm action before
`confirmDrop: true` is included in the PATCH body. Dropping a field on a zero-row dataset sends
the request directly with no confirmation and no `confirmDrop` field, matching
`dataset-schema-api/spec.md`'s "Drop field from an empty dataset" scenario.

**Decision 4 — Widen `StaticColumn.type` to `DatasetFieldType`; canonical types only.** Corrected
from round 1 (CR4): the create path structurally cannot carry `timestamp`/`string-body`/
`binary-ref` today — `StaticColumn.type: StaticColumnType` (`types/dataSource.ts:159,164`) is a
4-type subset, even though `StaticColumn` already carries optional `required`/`default`
(HEL-1076) and the backend (`DataSourceService.createStatic`) already validates every column
against the full 7-type `CanonicalWireValues` and builds `DatasetFieldDeclaration` with
`validateDefault` enforced. The fix is narrow: widen `StaticColumn.type`'s declared type from
`StaticColumnType` to `DatasetFieldType` (task 1.4 below) — no wire-shape change, since the
backend already accepts any canonical type string in that field; `StaticColumnType` itself is left
in place (still used elsewhere) but no longer used for this field.

The new field editor's type `Select` options come from a single `CANONICAL_FIELD_TYPES:
DatasetFieldType[]` constant (all 7 types, in the same order as the backend's
`CanonicalWireValues`) exported once and reused by both the create-flow editor and the schema-edit
editor — never re-declared per call site. Per round 1 CR5: the HEL-891 hazard is that the backend
*accepts* `"double"` as a legacy synonym and silently canonicalizes it to `"float"`
(`canonicalizeLegacy`) — it will never reject a UI mistake here, so the guard must be structural
(a test asserting `CANONICAL_FIELD_TYPES` matches the backend's `CanonicalWireValues` exactly, in
content and order), not a grep scoped to the touched files.

**Decision 5 — `binary-ref` fields have no `default` input.** `useDatasetFieldEditor`'s
`"readonly"` editor kind already marks `binary-ref` as non-editable at the row level (HEL-1080);
the same mapping is reused here to suppress the `default` input for a `binary-ref` field in both
the create and edit flows (a `binary-ref` default would need to be a JSON object reference, not a
scalar — out of scope for a text input).

**Decision 6 — Reorder focus target: the moved row's own name input; remove focus target: the next
remaining row (round 1 CR7, corrected round 2 CR3).** Moving a field to position 1 disables its own
"Move up" button — if focus were left on that button, it silently no-ops afterward exactly like the
HEL-1080 still-disabled-`.focus()` lesson tasks.md 3.2 already cites. So after a **reorder**, focus
moves to the moved row's own **name `TextField`** — a control that is never disabled regardless of
position — and a visually-hidden live region announces the field's new 1-based position ("`<name>`
moved to position 2 of 4"). After a **remove**, the affected row no longer exists, so focus instead
moves to the next remaining field's name input, or — if none remain — the "Add field" control; a
live region announces the removal ("`<name>` removed"). The confirm-drop dialog (Decision 3a), on
both confirm and cancel, returns focus to: on cancel, the field editor's remove button that
triggered it (the row still exists); on confirm, the same remove-case target above (the next
remaining field's name input, or "Add field" if none remain), since the row is now gone.

**No dashboard navigation on create (round 1 CR8, spec correction).** `AddSourceModal`'s
`finishCreate` (shared by every source type, HEL-535 D6) only refetches sources, selects the new
source, and toasts — `SourcesPage.tsx` renders `AddSourceModal` with no `onCreated`, so nothing
navigates to `/sources/:id` today for ANY source type. This change does not alter that behavior;
spec.md's create scenario is corrected to match (selected + toasted, not "taken to its detail
view"). Wiring create-time navigation to the detail view is out of scope here — it would be a
behavior change affecting every source type, not just dataset, and is not requested by the ticket.

## Risks / Trade-offs

- [Attempt-then-surface for retype/required-without-default means the first submit of a bad edit
  always makes one real network round-trip before the user sees the reason] → acceptable: the
  reason is still surfaced in-flow, before any row write, and the round-trip is the same cost a
  save button click already implies.
- [Reusing `StaticSourceForm` for a materially larger field-declaration UI increases that file's
  size/complexity] → mitigated by extracting the field-declaration table (name/type/required/
  default/reorder/remove row) into its own component shared by create and edit surfaces, per
  Decision 1's rationale and task 1.2.
- [Reordering fields in the create flow's "columns" step must keep the already-entered "rows" step
  data column-aligned, or a reorder silently scrambles in-progress row data] → `removeColumn`
  already re-slices `rows` on removal (`StaticSourceForm.tsx:42-45`); reorder needs the equivalent
  — permute each existing row's cells to match the new column order, in the same handler that
  reorders `columns` (task 1.5 below covers this explicitly, including its own test).

## Planner Notes

- Self-approved: extending `StaticSourceForm` in place rather than introducing a new
  `DatasetSourceForm` file — this is a much larger diff to that one file, but it avoids
  duplicating `AddSourceModal`'s create-flow plumbing (F-008, HEL-535 D6 toast dedup) a second
  time. Flagged for the design-gate skeptic since it's a judgment call, not a ticket-scoped
  requirement.
- Self-approved: schema-edit surface lives as a new panel/section on the existing `/sources/:id`
  dataset detail view (alongside `DatasetRowGrid`), not a separate route — matches "without a
  dashboard" (still inside Sources) and reuses the existing detail-view shell/layout.
