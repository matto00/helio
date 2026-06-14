## Skeptic Report — design gate (round 1)

### What I verified (with evidence)

1. **Ticket AC vs. artifacts** — Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, and `specs/panel-data-freshness/spec.md` in full. Cross-checked each AC against the design decisions and task list.

2. **Actual `PanelResponse` shape** — Read `backend/src/main/scala/com/helio/api/protocols/PanelProtocol.scala`. The current `PanelResponse` case class has 8 fields: `id`, `dashboardId`, `title`, `type`, `meta`, `appearance`, `ownerId`, `config`. The JSON format is `jsonFormat8(PanelResponse.apply)`. This confirms the field-count premise in design D5 is accurate: `jsonFormat8` → `jsonFormat9` after adding `dataAsOf: Option[String]`.

3. **`PanelResponse.fromDomain` signature** — Confirmed it is currently `def fromDomain(panel: Panel): PanelResponse` (single argument). Task 1.3 and 1.8 correctly identify that this must change to accept `dataAsOf` and that all existing call sites must pass `None`.

4. **All `PanelResponse.fromDomain` call sites** — Enumerated via grep:
   - `PublicDashboardRoutes.scala` line 41: `panels.map(PanelResponse.fromDomain)` — this is the only call site that will pass `dataAsOf`; needs modification to pass the fetched value.
   - `PanelRoutes.scala` lines 33, 42, 54, 75 — 4 call sites that must pass `None`.
   - `DashboardRoutes.scala` line 50: `panels.map(PanelResponse.fromDomain)` — 1 call site that must pass `None`. This is the dashboard-duplicate response.
   
   Task 1.8 says "PanelRoutes.scala — batch, create, patch, duplicate; DashboardRoutes.scala — duplicate" — correct and complete.

5. **`PipelineRepository` — `withSystemContext` pattern** — Confirmed it exists in `PipelineRepository.scala` (used by `findByIdInternal` and `updateLastRunInternal`). Design D2 is well-grounded.

6. **No `GET /api/panels/:id` endpoint** — Confirmed: `PanelRoutes.scala` only exposes batch, create, PATCH, query, and duplicate. The design note that AC #2 is satisfied by the panels-list endpoint alone is accurate.

7. **`PublicDashboardRoutes` wiring** — Read `ApiRoutes.scala`. `PublicDashboardRoutes` is constructed at line 94 as `new PublicDashboardRoutes(panelRepo, panelService, aclDirective, userOpt)`. `pipelineRepo` is available in `ApiRoutes` scope (constructor param, line 33). Task 1.6 (inject `pipelineRepo`) is implementable without structural changes.

8. **Schema** — Read `schemas/panel.schema.json`. The `dataAsOf` property is already present in the schema on disk — this appears to be pre-populated by the proposer. `additionalProperties: false` is set, confirming the schema must declare the field (which it now does). The schema change is consistent with the design.

9. **Frontend `PanelBase` interface** — Read `frontend/src/features/panels/types/panel.ts`. `PanelBase` (line 116) does not yet have `dataAsOf`. Task 2.1 is correctly targeting this interface.

10. **`PanelCard.tsx` title area** — Read `frontend/src/features/panels/ui/PanelCard.tsx`. The `panel-grid-card__title-area` div (line 208) contains the `<h3>` title (line 224). Design D7 correctly identifies the insertion point.

11. **`formatRelativeTime` utility** — Read `frontend/src/utils/formatRelativeTime.ts`. Exists, takes `iso: string` and returns a human-readable string. The design reference is accurate; the import path for task 2.3 is `../../../utils/formatRelativeTime` from `PanelCard.tsx`'s location.

12. **`dataAsOf` in `PanelBase` vs. discriminated union** — The design adds `dataAsOf?: string | null` to `PanelBase` so all variants inherit it. However, `PanelBase` is a private interface (lowercase `interface PanelBase`) not exported, and all panel variants extend it. This is valid TypeScript — the field propagates correctly to all union members.

13. **N+1 query concern** — Design acknowledges it and proposes `Future.sequence` of concurrent lookups, deferring batching to a follow-up. This is acceptable for typical dashboard sizes and matches the stated risk mitigation.

14. **Multiple-pipeline tie-break** — Ticket states "most recent successful run". Design D3 says `MAX(last_run_at)` across all pipelines with matching `output_data_type_id`. The "successful" qualifier from the ticket (`lastRunStatus = 'success'`) is **absent** from design D3 — the design takes `MAX(last_run_at)` across all pipelines regardless of run status.

15. **`dataAsOf` binding detection** — Design states `dataAsOf` is populated "for panels with a bound DataType". The mechanism by which the route layer knows a panel has a bound DataType is not specified in the design. Looking at the actual `Panel` ADT (CS2c-3c), binding is encoded in `config.dataTypeId` being non-empty, not in a top-level `typeId` field. The design says `findLastRunAtByOutputDataTypeId` is called "for each panel with a bound DataType" — but the tasks (1.7) say "for each panel with a bound DataType before calling `PanelResponse.fromDomain`". The mechanism for detecting binding (how to read `config.dataTypeId` from a domain `Panel` in the route layer) is left unspecified.

---

### Verdict: REFUTE

### Change Requests

1. **Tie-break semantics mismatch (ticket vs. design)** — The ticket says "most recent *successful* run is the natural choice" for the multi-pipeline timestamp. Design D3 specifies `MAX(last_run_at)` with no status filter. The spec (`specs/panel-data-freshness/spec.md` "Returns latest last_run_at") also omits the status filter. Either (a) the design must explicitly justify ignoring run status (with a recorded decision), or (b) the SQL must filter `WHERE last_run_status = 'success'` and the spec must reflect this. As written, a panel could show a "Data as of" timestamp from a *failed* run, which misrepresents freshness. Resolve the ambiguity before implementation.

2. **Binding detection mechanism unspecified** — `design.md` and `tasks.md` task 1.7 say "for each panel with a bound DataType" but do not specify how the route layer (which receives typed `Panel` domain objects from the CS2c-3c ADT) extracts the `dataTypeId` to pass to `findLastRunAtByOutputDataTypeId`. The `Panel` ADT has per-subtype `config` shapes (e.g. `MetricPanel.config.dataTypeId`); the route must pattern-match or use a helper (e.g. `getDataTypeId` from `panelNarrowing`) to extract this. The implementation task must name the extraction mechanism. Without this, implementers may pattern-match incorrectly (e.g., only handling `MetricPanel`) or call `findLastRunAtByOutputDataTypeId` for panels with an empty `dataTypeId: ""`, causing unnecessary DB queries. Add the extraction method to the task (e.g., "use `PanelConfigCodec` or a domain helper to extract `Option[DataTypeId]` from the panel's config before calling the repository").

### Non-blocking notes

- The schema file `schemas/panel.schema.json` already contains the `dataAsOf` property on disk. If this was pre-populated by the proposer rather than checked in by a prior task, the executor should be aware it does not need to add it (task 1.5 may be a no-op). Verify before executing.
- `formatRelativeTime` takes a `string` (non-nullable). The frontend guard in task 2.2 ("when `dataAsOf` is non-null and non-empty") correctly protects the call. Ensure the CSS class name follows the existing BEM pattern (`panel-grid-card__freshness` or similar) per `DESIGN.md`.
- Task 3.2/3.3 reference "a bound panel whose pipeline has run" and "an unbound panel" — these require seed data or test fixtures that exercise the pipeline lookup path. Ensure the test task explicitly requires seeding a pipeline row with `output_data_type_id` matching the panel's DataType, or the test will not exercise the new repository method.
