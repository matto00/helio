## Skeptic Report — design gate (round 1, skeptic-design-1.md)

### What I verified (with evidence)

- Read `ticket.md`, `proposal.md`, `design.md`, `tasks.md`, both spec deltas
  (`specs/metric-authoring-ui/spec.md`, `specs/panel-datatype-binding/spec.md`),
  and `workflow-state.md` (this is design round 1 — `SKEPTIC_CYCLE: 0`).
- Confirmed the backend wire contract the design leans on is fully shipped and
  matches the design's description, so "no backend changes" is sound:
  - `backend/src/main/scala/com/helio/domain/panels/MetricPanel.scala` — `metricId: Option[MetricId]`
    on `MetricPanelConfig`, and `PanelServiceHelpers.withMaterializedMetric` (lines 269-287) confirms
    the "raw fields win when both present" semantics D5 relies on.
  - `ChartPanel.scala`/`TablePanel.scala` both carry `metricId` too; `CollectionPanel.scala`/
    `TimelinePanel.scala` grep for `metricId` returns nothing — confirms the Non-Goal ("Collection/Timeline
    panel metric binding... HEL-500 never added metricId there either").
  - `backend/src/main/scala/com/helio/domain/model.scala:820` — `MetricAggregation.values = Set("sum",
    "avg", "min", "max", "count", "countDistinct")` matches the spec's aggregation list exactly.
  - `backend/src/main/scala/com/helio/services/MetricService.scala` — confirmed 400 (`BadRequest`) on
    empty name, 422 (`UnprocessableEntity`) on binding-shape errors, matching the spec's error-surfacing
    requirement.
  - `grep -rn "metricId" frontend/src` → **zero hits** — confirms "the frontend has zero metricId
    awareness" is accurate, not stale.
- Confirmed the frontend reuse claims:
  - `frontend/src/shared/ui/` listing (`ls`) — no `Toggle`/`Switch` exists; D4's premise is accurate.
  - `frontend/src/features/panels/ui/editors/fieldOptions.ts` and `DataTypePicker.tsx` are generic
    (take a `DataType`/callback props), so reusing them verbatim in the metric editor (D3) is sound.
  - `frontend/src/shared/ui/Select.tsx` uses `usePortalPopover` — the new multi-select's "matching
    Select's existing portal pattern" (D3/Risk) has a real hook to build on.
  - `frontend/src/store/store.ts` and `pipelinesSlice.ts`'s `export const pipelinesReducer =
    pipelinesSlice.reducer` confirm the named-export slice-registration convention D2 describes.
  - `PipelineEmptyState.tsx` wraps the shared `EmptyState` — confirms the list-page empty-state
    convention the spec cites.
- Found two substantive gaps (below) and two minor inaccuracies (non-blocking notes).

### Verdict: REFUTE

### Change Requests

1. **D1's nav precedent is self-contradictory, and as scoped ships an unreachable/mismatched `/metrics`
   page.** `design.md` D1 says Metrics should follow "the Pipelines precedent," explicitly *not* becoming
   "a sidebar-navigable content type woven into the app shell's dashboard/sources/pipelines/registry
   rotation," and claims "Following Pipelines avoids `navDestinations.ts`/`SidebarBody.tsx`/`App.tsx`
   mobile-sheet cross-cutting nav wiring the Sources precedent would require." This is factually wrong:
   Pipelines **is** one of the four items in that exact rotation. Verified:
   `frontend/src/shared/chrome/navDestinations.ts:16-21` lists `/`, `/sources`, `/pipelines`, `/registry`
   — Pipelines has a top-nav entry identically to Sources. `frontend/src/shared/chrome/SidebarBody.tsx`
   has a `section === "pipelines"` branch (lines ~97-114) rendering a full `SidebarItemList`, identically
   structured to the `section === "sources"` branch. `frontend/src/app/App.tsx` also handles `pipelines`
   in `breadcrumbLabel()` (line 76) and the mobile `breadcrumbItemName`/`mobileSection` logic (lines
   ~111-121). So "following Pipelines" actually *requires* exactly the wiring the design claims to avoid
   — and `tasks.md` task 2.6 only says "Register `/metrics` and `/metrics/:id` routes in
   `frontend/src/app/App.tsx`," with no task touching `navDestinations.ts`, `SidebarBody.tsx`,
   `breadcrumbLabel()`, or `sectionFromPathname()`.
   Concretely worse than a missing nice-to-have: `sectionFromPathname()`
   (`frontend/src/shared/chrome/SidebarBody.tsx:172-179`) falls through to `"dashboards"` for any
   unmatched path, so navigating to `/metrics` as currently scoped renders the **Dashboard list** in the
   left sidebar while the Metrics page renders in the main pane — a broken, disorienting shell state, not
   a discoverability nit. And there is no click path into `/metrics` anywhere in the app at all (verified
   `grep -rln "proposals" frontend/src` / no metrics equivalent exists yet, and no link is planned). The
   one existing route with no nav-destination entry, `/proposals/review`, is a deliberate agent-handoff
   deep link (reached via an out-of-band shared URL, per HEL-148's agent-native layer), not a precedent
   for a human-facing CRUD surface — the opposite of this ticket's own stated goal ("Humans need... an
   in-app way to define, edit, deprecate, and delete a metric").
   **Required revision:** `design.md` D1 must pick and document one of: (a) genuinely mirror Pipelines —
   add a `navDestinations.ts` entry, a `SidebarBody.tsx` "metrics" section, and
   `breadcrumbLabel()`/`sectionFromPathname()` handling, with matching `tasks.md` items; or (b) design an
   explicit alternative discovery path (e.g., a "Manage metrics →" link from `BindingEditor`'s new
   metric-picker, mirroring `DataTypePicker.tsx`'s existing "Create a pipeline →" link) and add it to
   `tasks.md`. Either way, `/metrics` must not ship reachable only by manually typing the URL with a
   mismatched sidebar.

2. **`BindingEditor.tsx` is already over this codebase's own file-size threshold, and the design doesn't
   address it.** `wc -l frontend/src/features/panels/ui/editors/BindingEditor.tsx` → **493 lines**, already
   past `CONTRIBUTING.md:24`'s "If a file you're editing crosses ~400 lines, propose a split in the PR
   description rather than adding to it." This exact file has already been split apart multiple times for
   exactly this reason — `MetricBindingFields.tsx`, `ChartAggregationFields.tsx`, `TableDisplayFields.tsx`,
   `FieldMappingSlots.tsx`, `DataTypePicker.tsx` (components) and `useBoundOrLiteralState`,
   `useChartDisplayState`, `useTableDisplayState` (hooks) were all extracted from `BindingEditor.tsx`
   specifically to stay under budget — `MetricBindingFields.tsx`'s own header comment cites "the
   CONTRIBUTING.md 400-line split threshold" by name. `design.md` D5/D6 and `tasks.md` task 3.4 describe
   adding a third bind-to-metric mode's state (mode toggle, metrics fetch via `metricsSlice`, selected
   `metricId`, dirty tracking) and JSX (the metric-selector control) straight onto `BindingEditor.tsx`
   with no mention of extraction, continuing this file's growth past a threshold the design is otherwise
   evidently aware of (it explicitly reuses `MetricBindingFields.tsx`, one of the prior extractions).
   **Required revision:** `tasks.md` 3.4 (and `design.md` D5) should specify extracting the new mode's
   state into a hook (e.g. `useMetricBindingState.ts`, mirroring `useBoundOrLiteralState.ts`) and its
   picker UI into a component (extending `MetricBindingFields.tsx` or a new `MetricPicker.tsx`),
   consistent with this file's own established pattern — or explicitly justify why this addition is small
   enough to skip extraction.

### Non-blocking notes

- `tasks.md` task 3.3 says the `updatePanelBinding` thunk lives in
  `frontend/src/features/panels/state/panelsSlice.ts`; it's actually defined in
  `frontend/src/features/panels/state/panelThunks.ts:165` and only re-exported/consumed by
  `panelsSlice.ts`. Unambiguous target either way (only one `updatePanelBinding` thunk exists), so not
  blocking, but worth correcting for precision.
- `design.md` D2 calls `metricsSlice`/`metricService` a "byte-for-byte structural mirror of
  `pipelinesSlice`/`pipelineService`," but `GET /api/metrics` returns a paginated
  `PagedResult<MetricResponse>` (`backend/src/main/scala/com/helio/api/routes/MetricRoutes.scala:26-44`),
  unlike `GET /api/pipelines`'s flat array (`pipelineService.ts:17-19`). The unwrap-`.items` pattern this
  needs already exists precedent in `frontend/src/features/dataTypes/services/dataTypeService.ts:17-19`
  (`fetchDataTypes`) — worth citing that precedent explicitly in D2 rather than the imprecise
  "byte-for-byte" framing, though this doesn't block implementation (the wire contract is unambiguous).
