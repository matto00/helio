## Context

See proposal.md — Why. Ground truth (verified at Setup against 9a57f7aa):
- `DataSourceReferenceRepository.find(sourceIds: Set[String], viewerId)` is HEL-1252's single finder: 3 queries
  (roots, steps, form panels) for ANY number of ids, privileged pool, explicit owner/grantee visibility predicates,
  returns `SourceReferences` (visible pipelines with kinds, visible form panels, hidden pipeline/panel counts).
- The 409 body already serialises it via `DataSourceDeleteConflictPipelineResponse` / `...PanelResponse`
  (`DataSourceProtocol.scala`, `schemas/sources/data-source-delete-conflict-*.schema.json`).
- Client roots-only sites: `selectPipelineNamesBySourceId` (`pipelinesSlice.ts:616`) → `SourceListTable.tsx:79,121`;
  `SidebarBody.tsx:96-102` `deleteWarning`; `EmptySchemaAffordance.tsx:37-44`.
- `GET /api/data-sources` is owner-scoped (`DataSourceRepository.findAll`, `owner_id = caller`, user context); the
  client fetches only page 1 (limit 200).

## Goals / Non-Goals

**Goals:** one server-side truth for "Used by" and both delete warnings; HEL-1252 visibility; constant query count.
**Non-Goals:** changing the guard/finder semantics; helio-mcp; cross-tab live updates; migrations (none needed).

## Decisions

**D1 — A separate read endpoint, not a field on the list response.** `GET /api/data-sources/references`. The list
endpoint is hot (sidebar, MCP, palette) and three privileged queries on every call are cost nobody else needs; a
separate endpoint also lets the client refresh references without refetching sources. Alternative (embed in each
`DataSourceResponse`) rejected for that cost and because the summary's freshness needs differ from the list's.

**D2 — Server picks the id set: every source the caller OWNS; no `ids` parameter.** Read owned ids with a user-context
(RLS-honouring) query on `data_sources` (`owner_id = caller`, same predicate as `findAll`, no paging), then ONE
`referenceRepo.find(ownedIds, caller)`. Total 4 queries regardless of N — no per-source N+1. No `ids` param means a
caller can never probe hidden reference counts on someone else's source (an existence leak). Owned-only matches the
list endpoint and the delete path (`findByIdOwned`), so every row the UI shows is covered.

**D3 — Wire shape reuses the 409 vocabulary.** `{"items": [{"sourceId", "pipelines": [{id, name, references}],
"panels": [{id, title, dashboardId, dashboardName}], "hiddenPipelineCount", "hiddenPanelCount"}]}` — reusing the
existing pipeline/panel response case classes and schema `$ref`s. Only sources with ≥1 reference are listed (absent ⇒
unused). New schema `schemas/sources/data-source-references-response.schema.json`. Service method lives on
`DataSourceService` (`findReferenceSummaries(user)`), the repository adds only the owned-id read.

**D4 — Route placement.** `path("references") { get { ... } }` inside `pathPrefix("data-sources")`, before
`path(DataSourceIdSegment)`, mirroring `csv-limits`. Inherits the existing `/api` auth + rate-limit composition.

**D5 — Client state in `sourcesSlice`.** `references: Record<string, SourceReferenceSummary>` plus
`referencesStatus: "idle"|"loading"|"succeeded"|"failed"`, thunk `fetchSourceReferences`. Triggers (freshness):
SourcesPage mount (every mount, not `idle`-guarded — it is cheap and references change outside this page);
SidebarBody whenever the sources section becomes active; EmptySchemaAffordance mount; and after `deleteSource`
settles (fulfilled: drop the entry; rejected: refetch). A 409 is still the backstop for a reference added in another
tab — the HEL-1252 conflict notice is unchanged.

**D6 — One formatter, no client counting.** `features/sources/utils/sourceReferences.ts` exports
`summarizeSourceUsage(summary | undefined, loaded)` and `sourceDeleteWarning(summary)`. Counts are
`pipelines.length + hiddenPipelineCount` and `panels.length + hiddenPanelCount`. "Used by" renders: not loaded → "—";
loaded and absent → "Unused"; else e.g. "2 pipelines, 1 form panel", with a `title` listing visible pipeline names
(with kind labels), visible panel titles, and "N you cannot access" for hidden. Sort key = total count. Warning copy:
"`<counts>` reference(s) this source, so deleting it will be refused until you remove `that reference|those
references`." (e.g. "1 pipeline and 1 form panel reference this source, …"). Shared by SidebarBody and
EmptySchemaAffordance. The client never derives a name or count from the pipelines slice.

**D7 — Remove the roots-only derivations.** Delete `selectPipelineNamesBySourceId` and the `pipelineNamesBySourceId`
prop; delete the `fetchPipelines` dispatches whose ONLY stated purpose was these warnings (SourcesPage; SidebarBody's
sources-section branch) — the executor must first confirm by grep that nothing else in those branches reads
`pipelines.items`, and keep the dispatch if anything does. EmptySchemaAffordance drops its pipelines selector if
unused after the change.

**D8 — Visibility proof is non-BYPASSRLS.** New cases in `DataSourceReferenceGuardNonSuperuserSpec` (its app pool is
NOSUPERUSER NOBYPASSRLS with FORCE RLS; privileged pool separate) drive `DataSourceService.findReferenceSummaries`
AND the route's serialised body: hidden join pipeline + hidden upsert pipeline + hidden form panel → counts only, and
the serialised body contains none of the hidden ids/names; granted pipeline/dashboard → named; another user's
referenced source never appears in the caller's items; the caller's owned-id read returns the caller's sources under
RLS. Mutation evidence required (recorded in the executor's notes): running the finder in user context instead of the
privileged pool turns the hidden-count case red on the app pool — and the superuser pool would not have caught it.

## Risks / Trade-offs

- [The finder's `strpos` prefilter is an OR of N ids over join/lookup/union/upsert step rows] → bounded by the caller's
  owned-source count; constant query count. Not optimised here (HEL-1252's finder is reused unchanged).
- [Stale summary within one page view] → refetch triggers in D5; the 409 + conflict notice remain the authority.
- [Existing tests assert the roots-only copy] → `SidebarBody.test.tsx:233`, `SourceListTable.test.tsx:26`, the
  `datasource-edit-delete` spec text; all updated in this change. No e2e spec asserts "Used by" or the warning copy
  (grep of `e2e/` at design time: zero hits).

## Planner Notes

- Self-approved: endpoint path/shape (D1–D4), copy (D6), no `ids` param (D2). No new dependency, no breaking change
  (additive endpoint), no migration — V115 NOT claimed.
- Out-of-lane areas (HEL-1254 REST connector pooling; HEL-1230 PanelGrid/CommandBar/undo) are not touched.
