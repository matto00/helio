## Context

`PipelineDetailPage` (`frontend/src/features/pipelines/ui/PipelineDetailPage.tsx`) renders a
read-only `BoundSourceBar` above the river view. It already dropped the old togglable-chip /
"+ Connect source" scaffolding (see the file's header comment and `openspec/specs/pipeline-editor-page`)
— that part of HEL-260's Definition of Done is already satisfied on `main`. What's missing: a way to
actually reach the source or output type, and permission gating on that access.

Two existing detail pages are the natural navigation targets: `SourcesPage` (`/sources`, source list
+ `SourceDetailPanel`) and `TypeRegistryPage` (`/registry`, `TypeRegistryBrowser` + `TypeDetailPanel`).
Both already support a Redux-driven "selected item" pattern (`sourcesSlice.selectedSourceId`,
`dataTypesSlice.selectedTypeId`) used by their sidebars — the same mechanism doubles as a navigation
target selector.

Pipeline sharing (`openspec/specs/pipeline-sharing`) grants `viewer`/`editor` roles scoped to the
*pipeline* resource only. It has no bearing on the underlying `DataSource`/`DataType` — those are
separately owned resources with their own `ownerId` (RLS-enforced, HEL-272 epic). A pipeline `editor`
grantee can mutate steps but has no standing to edit the bound source or type.

## Goals / Non-Goals

**Goals:**
- Add "Edit Source" / "Edit Type" buttons that navigate (no inline edit UI on this page).
- Gate both buttons on actual DataSource/DataType ownership, independent of pipeline ownership or
  pipeline-sharing role.

**Non-Goals:**
- New backend endpoints or schema changes — ownership data and navigation targets already exist.
- Building out `SourceDetailPanel` rename/config-edit UI (pre-existing gap, out of scope here).
- Multi-source pipelines.

## Decisions

**Ownership check via already-fetched, owner-scoped lists, not a new API call.**
`GET /api/data-sources` / `GET /api/types` already filter to the current user's own resources
(`DataSourceRepository.findAll(ownerId, ...)`, `DataTypeRepository.findAll(ownerId, ...)`, RLS-backed).
`PipelineDetailPage` already fetches `sources.items` for the kind badge; this change adds the same
`fetchDataTypes()`-on-mount pattern already used by `SourcesPage`/`SidebarBody`. Ownership is then:
`canEditSource = boundSource !== undefined` (already computed), `canEditType = dataTypes.items.some(dt
=> dt.id === currentPipeline.outputDataTypeId)`. No new endpoint, no denormalized owner-id field to
thread through `PipelineSummary`.
- *Alternative considered*: add `sourceOwnerId`/`outputTypeOwnerId` to the pipeline API response and
  compare against `currentUser.id` directly. Rejected — duplicates data already available client-side
  from existing fetches and would require a backend + schema change for a purely presentational gate;
  the existing lists are already the authoritative "do I own this" signal used elsewhere on this page.

**Hide, don't disable, when not permitted.** Matches the existing `isOwner && <Share button>` pattern
on this same page — no precedent here for a disabled-with-tooltip affordance.

**New `BoundTypeBar` component, not an expanded `BoundSourceBar`.** Keeps the well-named,
already-tested `BoundSourceBar` honest (source-only) and mirrors its existing CSS recipe rather than
merging two concerns into one component. Rendered as a second bar directly below the source bar,
same visual treatment (label + value + right-aligned Edit button).
- *Alternative considered*: one combined "contract bar" with both source and type side by side.
  Rejected as a larger, riskier restructure of a component the existing spec names explicitly
  (`pipeline-editor-page` §"Source selector bar") for a purely cosmetic gain; two stacked bars reads
  clearly and keeps the diff additive.

**Navigation wiring**: `handleEditSource` dispatches `setSelectedSourceId(boundSource.id)` then
`navigate("/sources")`; `handleEditType` dispatches `setSelectedTypeId(outputDataTypeId)` then
`navigate("/registry")`. Both selection actions are non-resetting on refetch (verified in
`sourcesSlice`/`dataTypesSlice`), so the destination page opens with the right item selected.

## Risks / Trade-offs

- [Owner-scoped list may be paginated/incomplete for users with very large source/type counts, causing
  a false "not owned" negative] → Pre-existing characteristic of `boundSource` lookup already relied on
  for the kind badge; not a regression introduced by this change. Follow-up ticket if it becomes a real
  problem.
- [Two stacked bars add ~40px of vertical chrome above the river view] → Consistent with the page's
  existing bar-stack pattern (source bar → river → footer → share bar → meta bar); acceptable.

## Planner Notes

- Self-approved: hide-not-disable for the permission gate (matches existing Share-button precedent on
  this page — no new interaction pattern introduced).
- Self-approved: new `BoundTypeBar` component rather than expanding `BoundSourceBar` (keeps blast
  radius additive; see Decisions).
