# HEL-1079: Dataset management UI: create a dataset and declare its schema

## Description

A dataset must be creatable and editable **without a dashboard**. Add the create flow to Sources: name the dataset, declare fields (name, type, required, default), reorder and remove them.

Schema edits on a dataset with existing rows need an explicit answer in the UI (block, warn, or migrate) — pick one and make it visible rather than failing at write time later.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria

- Keyboard-only completion of the whole flow (create a dataset, declare fields including reorder/remove, and edit its schema later).
- Every control involved has a computed accessibility name (scanned by `e2e/focus-presence-guard.spec.ts`, HEL-520).
- Dataset creation: name the dataset; declare fields with name, type (canonical types only: string/integer/float/boolean/timestamp/string-body/binary-ref — NOT "double", see HEL-891), required flag, and default value; reorder and remove fields before submit.
- Schema editing on an existing dataset surfaces the `PATCH /api/data-sources/:id/schema` policy honestly and safely, before commit:
  - add optional field → allowed
  - add required field to non-empty dataset → requires a default, else blocked with a clear reason (409 from the API)
  - rename → metadata-only, safe
  - retype → checked against existing values; if any are incompatible, blocked with the incompatible-row count shown (409)
  - drop a field holding data → requires an explicit, clearly-labelled confirmation (never a silent flag) — `confirmDrop: true`
  - reorder → rows rewritten, allowed
  - tightening a kept field to required → needs a default for existing null/missing values, else blocked (409)
- Preview the effect of an edit before commit where the API supports it (incompatible-row counts, rowsMigrated) rather than only reacting to the resulting error after the fact.
- Never let the user reach a state where the app's own rows would fail `DatasetRowValidator` — every schema edit path routes through the declared-schema update API's validation, never a client-side assumption.

## Context: existing surfaces to reuse, not fork

- `frontend/src/features/sources/ui/AddSourceModal.tsx` (+ `SourceTypeToggle.tsx`, `useAddSourceAction.tsx`) — existing Sources add-source flow; the dataset create flow is added here.
- HEL-1080's dataset row-grid feature (`DatasetRowGrid.tsx`, `datasetRowsSlice.ts`, `useDatasetFieldEditor.ts`, `parseDatasetRowValidationError.ts`, `e2e/hel1080-dataset-row-grid-live.spec.ts`) at `/sources/:id` — reuse its slice/hook/error-parsing patterns and the DataGrid `gridMode` extension rather than forking them.
- Backend contract: `openspec/specs/dataset-schema-api/spec.md` (GET/PATCH `/api/data-sources/:id/schema`), `DatasetFieldDeclaration`/`DatasetRowValidator` (HEL-1076), dataset kind + `static` wire alias (HEL-1073).

## Hard-won lessons from HEL-1080 (apply here)

- Test with real UI input (typing/keyboard), not fixture-injected state.
- Add real-backend Playwright e2e for: create-with-fields, and at least one rejected schema edit (409 path).
- Watch focus after async actions — a `.focus()` on a still-disabled control silently no-ops.
- Where timing matters, test with injected latency, not just localhost speed.

## Design

`DESIGN.md` is binding. Visual cohesion gate: compare against the running app in both light and dark themes next to existing Sources surfaces — token compliance alone is not cohesion. Escalate rather than invent a new visual dialect.
