# HEL-1258: Sources "Used by" and the delete warning count only pipeline roots, so a join/lookup/upsert/form-bound source shows "Unused" and then refuses to delete

## Description

origin_kind: followup — origin_ticket: HEL-1252

HEL-1252 makes `DELETE /api/data-sources/:id` return 409 for every reference kind:

* R1: pipeline root.
* R2: a join, lookup or union step whose secondary input is the source.
* R3: an upsert step targeting the existing source.
* R4: a form panel bound via `panels.form_config`.

The HEL-1252 lane reports that the Sources page "Used by" column and the sidebar delete warning still count only
pipeline roots (R1). A source referenced only by R2–R4 therefore shows as "Unused", and the delete is then refused with
409. The UI contradicts the server.

This was reported by the HEL-1252 lane and has not been verified by the driver. Confirm it against the code first.
(Confirmed at Setup: `SourceListTable.tsx` via `selectPipelineNamesBySourceId`, `SidebarBody.tsx:99`, and a third site
`EmptySchemaAffordance.tsx:40` all derive counts from `pipeline.roots[]` only.)

## Acceptance Criteria

* "Used by" and the delete warning reflect the same reference kinds as the 409 guard, from one shared source of truth
  on the server rather than a parallel client-side count.
* Visibility follows HEL-1252: name only the references the caller can see, and give hidden ones as counts only.

## Driver constraints (from the dispatch brief)

* Reuse HEL-1252's reference finder (`DataSourceReferenceRepository`), not a parallel count.
* Prove visibility with a non-BYPASSRLS proof (pattern: `DataSourceReferenceGuardNonSuperuserSpec`); a superuser test proves nothing about RLS.
* The list endpoint must not be N+1 per source.
* UI change needs a live check in light and dark themes against the running app.
* Do not touch HEL-1254 (REST connector / fetchUrl pooling) or HEL-1230 (layout undo/redo, CommandBar, PanelGrid) areas. V115 reserved if a migration is needed (none expected).
