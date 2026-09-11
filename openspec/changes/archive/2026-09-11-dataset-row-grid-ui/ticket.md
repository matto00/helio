# HEL-1080: Dataset management UI: view, edit and delete rows in a grid

## Description

An editable grid over the dataset's rows, reusing the existing data-grid components rather than a new one. Inline edit, row delete, and add-row.

Design spec: `docs/superpowers/specs/2026-09-10-interactive-data-writeback-design.md` (PR #627)

## Acceptance Criteria (HEL-1080)

- Edits persist through the row API.
- The grid reflects a concurrent change on refresh.
- Keyboard-operable including cell navigation.
- (Driver brief, binding for this run) Stale edit (per HEL-1078's precondition status) surfaces a clear, recoverable UX — show the current value, allow retry — never a silent overwrite or generic toast.
- Field-level validation errors surface on the offending cell; declared schema types (`DatasetFieldDeclaration`) drive editors; required fields can't be emptied.
- Shared state in Redux (`createAsyncThunk`); presentational components; reusable hooks/selectors.
- Optimistic vs. pessimistic update strategy is decided and justified in design.md; if optimistic, rollback is tested.
- Large datasets use the paged row-listing endpoint (HEL-1121); no naive full-dataset render — measured, not assumed.
- a11y is an inline AC: full keyboard navigation per a recognized grid pattern, conforming visible focus (scanned by `e2e/focus-presence-guard.spec.ts`), SR names/roles, error announcements.
- `DESIGN.md` token compliance AND visual cohesion against the running app in both themes, next to existing surfaces (sources list/detail) — no new visual dialect without an escalation.
- Tests drive real UI input (typing/keyboard), not fixture-injected state.

## Folded-in scope: HEL-1122 — Expose a dataset source's declared schema via API

This ticket was folded into this same delivery by explicit driver instruction (2026-09-11): no route currently exposes a dataset source's declared schema (columns/types), and HEL-1080's grid needs it to render columns/types/editors rather than inferring shape from row data. One PR covers both tickets; both are set Done at delivery.

### Acceptance Criteria (HEL-1122)

- A route (new, or additive on the existing dataset source GET response) returns the dataset source's declared schema (column name/type/required/default — `DatasetFieldDeclaration`) in a shape HEL-1080's grid can consume directly.
- Additive only — does not break existing consumers of the source GET response (including the MCP server / any other client reading that shape).
- Reuses existing ACL / HEL-1002 not-found conventions.
- Contract change (schemas/, OpenAPI, frontend service types) lands in the same PR.
- spray-json Option=None (field absent, not null) test coverage for the new field.
- If the read path touches `data_sources` differently than existing reads, verify under a non-superuser, non-BYPASSRLS role (see `project_rls_testing_parity_gap` — RLS never runs under the default superuser dev/CI connection).

## Notes

- Backend prerequisites confirmed merged on main: HEL-1074 (migration), HEL-1073 (rename/registration), HEL-1076 (declared-schema model + write-time validation), HEL-1077 (row write append/replace), HEL-1078 (row edit/delete with `updatedAt` precondition), HEL-1121 (paged row listing with id/seq/updatedAt).
- Archived design docs for those: `openspec/changes/archive/2026-09-10-migration-a-dataset-rows`, `2026-09-11-dataset-source-kind-model`, `2026-09-11-declared-schema-model-validation`, `2026-09-11-row-write-api`, `2026-09-11-row-listing-api`.
- Known CI flake: `e2e/focus-presence-guard.spec.ts:163` duplicate "HEL-520 Guard Dashboard" (HEL-1119) — if that exact failure is the only red on this PR, report it as the known flake; any other assertion in that spec tripped by new UI is a real finding to fix.
